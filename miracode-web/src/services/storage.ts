import { CodeProject, VersionSnapshot } from '../types/project';
import { nativeBridge } from './nativeBridge';

const DB_NAME = 'aethercode_offline_db';
const DB_VERSION = 1;

class OfflineStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private backupTimer: ReturnType<typeof setTimeout> | null = null;

  private initDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        reject(new Error('IndexedDB not supported'));
        return;
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = e => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('snapshots')) {
          const snapshotStore = db.createObjectStore('snapshots', { keyPath: 'id' });
          snapshotStore.createIndex('projectId', 'projectId', { unique: false });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('models')) {
          db.createObjectStore('models', { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  private scheduleNativeBackup() {
    if (!nativeBridge.isRunningInNativeApp()) return;
    if (this.backupTimer) {
      clearTimeout(this.backupTimer);
    }
    this.backupTimer = setTimeout(async () => {
      this.backupTimer = null;
      try {
        const projects = await this.getAllProjectsRaw();
        const lastActiveId = await this.getSetting<string>('last_active_project_id', '');
        nativeBridge.backupStorage(
          JSON.stringify({
            version: 1,
            lastActiveId,
            projects,
          })
        );
      } catch {}
    }, 500);
  }

  private async getAllProjectsRaw(): Promise<CodeProject[]> {
    try {
      const db = await this.initDB();
      return new Promise(resolve => {
        const tx = db.transaction('projects', 'readonly');
        const store = tx.objectStore('projects');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    } catch {
      const projects: CodeProject[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('aether_proj_')) {
          try {
            projects.push(JSON.parse(localStorage.getItem(key) || ''));
          } catch {}
        }
      }
      return projects;
    }
  }

  // --- Projects ---
  async getProject(id: string): Promise<CodeProject | null> {
    try {
      const db = await this.initDB();
      return new Promise(resolve => {
        const tx = db.transaction('projects', 'readonly');
        const store = tx.objectStore('projects');
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      const local = localStorage.getItem(`aether_proj_${id}`);
      return local ? JSON.parse(local) : null;
    }
  }

  async saveProject(project: CodeProject, skipBackup = false): Promise<void> {
    try {
      const db = await this.initDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('projects', 'readwrite');
        const store = tx.objectStore('projects');
        const req = store.put(project);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      try {
        localStorage.setItem(`aether_proj_${project.id}`, JSON.stringify(project));
      } catch (e) {
        console.warn('LocalStorage save failed:', e);
      }
    }
    if (!skipBackup) {
      this.scheduleNativeBackup();
    }
  }

  async getAllProjects(): Promise<CodeProject[]> {
    const existing = await this.getAllProjectsRaw();
    if (existing.length === 0 && nativeBridge.isRunningInNativeApp()) {
      try {
        const rawBackup = await nativeBridge.requestRestoreStorage();
        if (rawBackup) {
          const parsed = JSON.parse(rawBackup) as {
            projects?: CodeProject[];
            lastActiveId?: string;
          };
          if (Array.isArray(parsed.projects) && parsed.projects.length > 0) {
            for (const proj of parsed.projects) {
              await this.saveProject(proj, true);
            }
            if (parsed.lastActiveId) {
              await this.setSetting('last_active_project_id', parsed.lastActiveId, true);
            }
            return parsed.projects;
          }
        }
      } catch {}
    }
    return existing;
  }

  async deleteProject(id: string): Promise<void> {
    try {
      const db = await this.initDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('projects', 'readwrite');
        const store = tx.objectStore('projects');
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      try {
        localStorage.removeItem(`aether_proj_${id}`);
      } catch {}
    }
    this.scheduleNativeBackup();
  }

  // --- Snapshots ---
  async addSnapshot(snapshot: VersionSnapshot): Promise<void> {
    try {
      const db = await this.initDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('snapshots', 'readwrite');
        const store = tx.objectStore('snapshots');
        const req = store.put(snapshot);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn('Snapshot save error:', e);
    }
  }

  // --- Settings (e.g. GitHub Token, Active Model) ---
  async getSetting<T>(key: string, defaultValue: T): Promise<T> {
    try {
      const db = await this.initDB();
      return new Promise(resolve => {
        const tx = db.transaction('settings', 'readonly');
        const store = tx.objectStore('settings');
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : defaultValue);
        req.onerror = () => resolve(defaultValue);
      });
    } catch {
      const val = localStorage.getItem(`aether_setting_${key}`);
      return val ? JSON.parse(val) : defaultValue;
    }
  }

  async setSetting<T>(key: string, value: T, skipBackup = false): Promise<void> {
    try {
      const db = await this.initDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('settings', 'readwrite');
        const store = tx.objectStore('settings');
        const req = store.put({ key, value });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      localStorage.setItem(`aether_setting_${key}`, JSON.stringify(value));
    }
    if (!skipBackup && key === 'last_active_project_id') {
      this.scheduleNativeBackup();
    }
  }
}

export const offlineStorage = new OfflineStorage();

// Blank starter code so pressing New clears old code completely
export const DEFAULT_STARTER_CODE = '';
