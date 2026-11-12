export interface NativeModelSummary {
  id: string;
  name: string;
  sizeBytes: number;
  isDownloaded: boolean;
  isLoaded: boolean;
}

export interface NativeStatusPayload {
  activeModel: NativeModelSummary | null;
  isContextLoading: boolean;
  loadingModelName: string | null;
  downloadedModels: NativeModelSummary[];
  contextWindow: number;
  totalRamGB: number;
}

export interface NativeChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type NativeInboundMessage =
  | { type: 'NATIVE_STATUS'; payload: NativeStatusPayload }
  | { type: 'GENERATE_STREAM'; requestId: string; accumulatedText: string; token?: string }
  | {
      type: 'GENERATE_DONE';
      requestId: string;
      text: string;
      tokensPredicted?: number;
      modelName?: string;
      aborted?: boolean;
    }
  | { type: 'GENERATE_ERROR'; requestId: string; error: string }
  | { type: 'SELECT_NATIVE_MODEL_RESULT'; requestId?: string; success: boolean; error?: string }
  | { type: 'SHARE_FILE_RESULT'; requestId: string; success: boolean; error?: string }
  | { type: 'RESTORE_STORAGE_RESULT'; requestId: string; payload: string | null };

interface PendingGeneration {
  onProgress?: (accumulatedText: string) => void;
  resolve: (result: { text: string; tokensPredicted?: number; modelName?: string; aborted?: boolean }) => void;
  reject: (err: Error) => void;
  abortedLocally: boolean;
  latestText: string;
}

function createRequestId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

class NativeBridge {
  private latestStatus: NativeStatusPayload | null = null;
  private statusListeners = new Set<(status: NativeStatusPayload) => void>();
  private pendingGenerations = new Map<string, PendingGeneration>();
  private pendingShares = new Map<string, (ok: boolean, err?: string) => void>();
  private pendingRestores = new Map<string, (payload: string | null) => void>();
  private pendingModelSelects = new Map<string, { resolve: () => void; reject: (err: Error) => void }>();
  private initialized = false;

  constructor() {
    this.installGlobalReceiver();
  }

  isRunningInNativeApp(): boolean {
    return (
      typeof window !== 'undefined' &&
      Boolean((window as any).ReactNativeWebView && typeof (window as any).ReactNativeWebView.postMessage === 'function')
    );
  }

  private installGlobalReceiver() {
    if (typeof window === 'undefined' || this.initialized) return;
    this.initialized = true;

    (window as any).__MIRACODE_ON_NATIVE_MESSAGE__ = (rawMsg: NativeInboundMessage | string) => {
      let msg: NativeInboundMessage;
      if (typeof rawMsg === 'string') {
        try {
          msg = JSON.parse(rawMsg) as NativeInboundMessage;
        } catch {
          return;
        }
      } else {
        msg = rawMsg;
      }
      if (!msg || typeof msg !== 'object') return;
      this.handleInboundMessage(msg);
    };
  }

  private handleInboundMessage(msg: NativeInboundMessage) {
    switch (msg.type) {
      case 'NATIVE_STATUS': {
        this.latestStatus = msg.payload;
        for (const cb of this.statusListeners) {
          try {
            cb(msg.payload);
          } catch {}
        }
        break;
      }
      case 'GENERATE_STREAM': {
        const pending = this.pendingGenerations.get(msg.requestId);
        if (!pending) return;
        pending.latestText = msg.accumulatedText;
        pending.onProgress?.(msg.accumulatedText);
        break;
      }
      case 'GENERATE_DONE': {
        const pending = this.pendingGenerations.get(msg.requestId);
        if (!pending) return;
        this.pendingGenerations.delete(msg.requestId);
        pending.resolve({
          text: msg.text || pending.latestText,
          tokensPredicted: msg.tokensPredicted,
          modelName: msg.modelName,
          aborted: msg.aborted || pending.abortedLocally,
        });
        break;
      }
      case 'GENERATE_ERROR': {
        const pending = this.pendingGenerations.get(msg.requestId);
        if (!pending) return;
        this.pendingGenerations.delete(msg.requestId);
        if (pending.abortedLocally && pending.latestText.trim().length > 0) {
          pending.resolve({
            text: pending.latestText,
            aborted: true,
          });
        } else {
          pending.reject(new Error(msg.error || 'Native Metal inference failed.'));
        }
        break;
      }
      case 'SELECT_NATIVE_MODEL_RESULT': {
        if (msg.requestId) {
          const pending = this.pendingModelSelects.get(msg.requestId);
          if (pending) {
            this.pendingModelSelects.delete(msg.requestId);
            if (msg.success) {
              pending.resolve();
            } else {
              pending.reject(new Error(msg.error || 'Could not load selected GGUF model into Metal.'));
            }
          }
        }
        break;
      }
      case 'SHARE_FILE_RESULT': {
        const cb = this.pendingShares.get(msg.requestId);
        if (cb) {
          this.pendingShares.delete(msg.requestId);
          cb(msg.success, msg.error);
        }
        break;
      }
      case 'RESTORE_STORAGE_RESULT': {
        const cb = this.pendingRestores.get(msg.requestId);
        if (cb) {
          this.pendingRestores.delete(msg.requestId);
          cb(msg.payload);
        }
        break;
      }
    }
  }

  private postToNative(payload: Record<string, unknown>): boolean {
    this.installGlobalReceiver();
    if (!this.isRunningInNativeApp()) return false;
    try {
      (window as any).ReactNativeWebView.postMessage(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  notifyWebReady() {
    this.postToNative({ type: 'WEB_READY' });
  }

  getLatestStatus(): NativeStatusPayload | null {
    return this.latestStatus;
  }

  subscribeStatus(cb: (status: NativeStatusPayload) => void): () => void {
    this.statusListeners.add(cb);
    if (this.latestStatus) {
      try {
        cb(this.latestStatus);
      } catch {}
    }
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  openNativeDrawer() {
    this.postToNative({ type: 'OPEN_NATIVE_DRAWER' });
  }

  openModelsScreen() {
    this.postToNative({ type: 'OPEN_MODELS_SCREEN' });
  }

  selectNativeModel(modelId: string): Promise<void> {
    if (!this.isRunningInNativeApp()) {
      return Promise.reject(new Error('Native app bridge unavailable.'));
    }
    const requestId = createRequestId('sel');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingModelSelects.delete(requestId)) {
          reject(new Error('Timed out loading model into Apple Metal memory.'));
        }
      }, 120000);
      this.pendingModelSelects.set(requestId, {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: err => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.postToNative({ type: 'SELECT_NATIVE_MODEL', requestId, modelId });
    });
  }

  unloadNativeModel() {
    this.postToNative({ type: 'UNLOAD_NATIVE_MODEL' });
  }

  generateCode(params: {
    messages: NativeChatMessage[];
    maxTokens: number;
    temperature: number;
    onProgress?: (accumulatedText: string) => void;
  }): {
    requestId: string;
    promise: Promise<{ text: string; tokensPredicted?: number; modelName?: string; aborted?: boolean }>;
    abort: () => void;
  } {
    const requestId = createRequestId('gen');
    let settled = false;

    const promise = new Promise<{
      text: string;
      tokensPredicted?: number;
      modelName?: string;
      aborted?: boolean;
    }>((resolve, reject) => {
      this.pendingGenerations.set(requestId, {
        onProgress: params.onProgress,
        resolve: res => {
          if (settled) return;
          settled = true;
          resolve(res);
        },
        reject: err => {
          if (settled) return;
          settled = true;
          reject(err);
        },
        abortedLocally: false,
        latestText: '',
      });

      const sent = this.postToNative({
        type: 'GENERATE_CODE',
        requestId,
        messages: params.messages,
        maxTokens: params.maxTokens,
        temperature: params.temperature,
      });

      if (!sent) {
        this.pendingGenerations.delete(requestId);
        settled = true;
        reject(new Error('Native Metal inference bridge is not connected.'));
      }
    });

    const abort = () => {
      const pending = this.pendingGenerations.get(requestId);
      if (pending) {
        pending.abortedLocally = true;
      }
      this.postToNative({ type: 'ABORT_GENERATION', requestId });
    };

    return { requestId, promise, abort };
  }

  abortAllGenerations() {
    for (const [requestId, pending] of this.pendingGenerations.entries()) {
      pending.abortedLocally = true;
      this.postToNative({ type: 'ABORT_GENERATION', requestId });
    }
  }

  shareFile(fileName: string, content: string): Promise<boolean> {
    if (!this.isRunningInNativeApp()) {
      return Promise.resolve(false);
    }
    const requestId = createRequestId('share');
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.pendingShares.delete(requestId);
        resolve(false);
      }, 15000);
      this.pendingShares.set(requestId, ok => {
        clearTimeout(timer);
        resolve(ok);
      });
      this.postToNative({ type: 'SHARE_FILE', requestId, fileName, content });
    });
  }

  backupStorage(payload: string) {
    this.postToNative({ type: 'BACKUP_STORAGE', payload });
  }

  requestRestoreStorage(): Promise<string | null> {
    if (!this.isRunningInNativeApp()) {
      return Promise.resolve(null);
    }
    const requestId = createRequestId('restore');
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.pendingRestores.delete(requestId);
        resolve(null);
      }, 4000);
      this.pendingRestores.set(requestId, payload => {
        clearTimeout(timer);
        resolve(payload);
      });
      this.postToNative({ type: 'REQUEST_RESTORE_STORAGE', requestId });
    });
  }
}

export const nativeBridge = new NativeBridge();

