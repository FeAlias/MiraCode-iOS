import { CodeProject, VersionSnapshot } from '../types/project';
import { nativeBridge } from './nativeBridge';

const DB_NAME = 'aethercode_offline_db';
const DB_VERSION = 1;

function safeLocalGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalSet(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeLocalRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {}
}

function safeLocalEntriesWithPrefix(prefix: string): Array<[string, string]> {
  const results: Array<[string, string]> = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        const val = window.localStorage.getItem(key);
        if (val !== null) {
          results.push([key, val]);
        }
      }
    }
  } catch {}
  return results;
}

class OfflineStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private backupTimer: ReturnType<typeof setTimeout> | null = null;
  private nativeRestorePromise: Promise<void> | null = null;
  private memoryProjects = new Map<string, CodeProject>();
  private memorySnapshots = new Map<string, VersionSnapshot>();
  private memorySettings = new Map<string, unknown>();

  private initDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      try {
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
        request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
      } catch (err) {
        reject(err instanceof Error ? err : new Error('IndexedDB security error'));
      }
    });

    return this.dbPromise;
  }

  private ensureNativeRestored(): Promise<void> {
    if (!nativeBridge.isRunningInNativeApp()) {
      return Promise.resolve();
    }
    if (this.nativeRestorePromise) {
      return this.nativeRestorePromise;
    }

    this.nativeRestorePromise = (async () => {
      try {
        const existing = await this.getAllProjectsRaw();
        if (existing.length > 0) {
          return;
        }
        const rawBackup = await nativeBridge.requestRestoreStorage();
        if (!rawBackup) {
          return;
        }
        const parsed = JSON.parse(rawBackup) as {
          projects?: CodeProject[];
          lastActiveId?: string;
          settings?: Record<string, unknown>;
        };
        if (parsed.settings && typeof parsed.settings === 'object') {
          for (const [k, v] of Object.entries(parsed.settings)) {
            await this.setSetting(k, v, true);
          }
        }
        if (Array.isArray(parsed.projects) && parsed.projects.length > 0) {
          for (const proj of parsed.projects) {
            await this.saveProject(proj, true);
          }
        }
        if (parsed.lastActiveId) {
          await this.setSetting('last_active_project_id', parsed.lastActiveId, true);
        }
      } catch {}
    })();

    return this.nativeRestorePromise;
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
        const lastActiveId = await this.getSettingRaw<string>('last_active_project_id', '');
        const settingsObj: Record<string, unknown> = {};
        for (const [k, v] of this.memorySettings.entries()) {
          settingsObj[k] = v;
        }
        nativeBridge.backupStorage(
          JSON.stringify({
            version: 2,
            lastActiveId,
            projects,
            settings: settingsObj,
          })
        );
      } catch {}
    }, 400);
  }

  private async getAllProjectsRaw(): Promise<CodeProject[]> {
    try {
      const db = await this.initDB();
      return await new Promise(resolve => {
        const tx = db.transaction('projects', 'readonly');
        const store = tx.objectStore('projects');
        const req = store.getAll();
        req.onsuccess = () => {
          const items: CodeProject[] = req.result || [];
          for (const item of items) {
            this.memoryProjects.set(item.id, item);
          }
          resolve(items);
        };
        req.onerror = () => resolve(Array.from(this.memoryProjects.values()));
      });
    } catch {
      const entries = safeLocalEntriesWithPrefix('aether_proj_');
      if (entries.length > 0) {
        const projects: CodeProject[] = [];
        for (const [, raw] of entries) {
          try {
            const parsed = JSON.parse(raw) as CodeProject;
            this.memoryProjects.set(parsed.id, parsed);
            projects.push(parsed);
          } catch {}
        }
        return projects;
      }
      return Array.from(this.memoryProjects.values());
    }
  }

  // --- Projects ---
  async getProject(id: string): Promise<CodeProject | null> {
    await this.ensureNativeRestored();
    try {
      const db = await this.initDB();
      return await new Promise(resolve => {
        const tx = db.transaction('projects', 'readonly');
        const store = tx.objectStore('projects');
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || this.memoryProjects.get(id) || null);
        req.onerror = () => resolve(this.memoryProjects.get(id) || null);
      });
    } catch {
      const local = safeLocalGet(`aether_proj_${id}`);
      if (local) {
        try {
          return JSON.parse(local) as CodeProject;
        } catch {}
      }
      return this.memoryProjects.get(id) || null;
    }
  }

  async saveProject(project: CodeProject, skipBackup = false): Promise<void> {
    this.memoryProjects.set(project.id, project);
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
      safeLocalSet(`aether_proj_${project.id}`, JSON.stringify(project));
    }
    if (!skipBackup) {
      this.scheduleNativeBackup();
    }
  }

  async getAllProjects(): Promise<CodeProject[]> {
    await this.ensureNativeRestored();
    return this.getAllProjectsRaw();
  }

  async deleteProject(id: string): Promise<void> {
    this.memoryProjects.delete(id);
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
      safeLocalRemove(`aether_proj_${id}`);
    }
    this.scheduleNativeBackup();
  }

  // --- Snapshots ---
  async addSnapshot(snapshot: VersionSnapshot): Promise<void> {
    this.memorySnapshots.set(snapshot.id, snapshot);
    try {
      const db = await this.initDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('snapshots', 'readwrite');
        const store = tx.objectStore('snapshots');
        const req = store.put(snapshot);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {}
  }

  private async getSettingRaw<T>(key: string, defaultValue: T): Promise<T> {
    try {
      const db = await this.initDB();
      return await new Promise(resolve => {
        const tx = db.transaction('settings', 'readonly');
        const store = tx.objectStore('settings');
        const req = store.get(key);
        req.onsuccess = () => {
          if (req.result) {
            this.memorySettings.set(key, req.result.value);
            resolve(req.result.value as T);
          } else if (this.memorySettings.has(key)) {
            resolve(this.memorySettings.get(key) as T);
          } else {
            resolve(defaultValue);
          }
        };
        req.onerror = () =>
          resolve(
            this.memorySettings.has(key) ? (this.memorySettings.get(key) as T) : defaultValue
          );
      });
    } catch {
      const val = safeLocalGet(`aether_setting_${key}`);
      if (val !== null) {
        try {
          const parsed = JSON.parse(val) as T;
          this.memorySettings.set(key, parsed);
          return parsed;
        } catch {}
      }
      if (this.memorySettings.has(key)) {
        return this.memorySettings.get(key) as T;
      }
      return defaultValue;
    }
  }

  // --- Settings (e.g. GitHub Token, Active Model, Uploaded Docs) ---
  async getSetting<T>(key: string, defaultValue: T): Promise<T> {
    await this.ensureNativeRestored();
    return this.getSettingRaw(key, defaultValue);
  }

  async setSetting<T>(key: string, value: T, skipBackup = false): Promise<void> {
    this.memorySettings.set(key, value);
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
      safeLocalSet(`aether_setting_${key}`, JSON.stringify(value));
    }
    if (!skipBackup) {
      this.scheduleNativeBackup();
    }
  }
}

export const offlineStorage = new OfflineStorage();

// Blank starter code so pressing New clears old code completely
export const DEFAULT_STARTER_CODE = '';
