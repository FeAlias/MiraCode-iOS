import React, {useCallback, useEffect, useMemo, useRef} from 'react';
import {StyleSheet, View} from 'react-native';

import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {DrawerNavigationProp} from '@react-navigation/drawer';
import {useNavigation} from '@react-navigation/native';
import {autorun, toJS} from 'mobx';
import {observer} from 'mobx-react-lite';
import {WebView, WebViewMessageEvent} from 'react-native-webview';
import * as RNFS from '@dr.pogodin/react-native-fs';
import Share from 'react-native-share';
import DeviceInfo from 'react-native-device-info';
import {Buffer} from 'buffer';

import {
  chatSessionStore,
  defaultCompletionSettings,
  modelStore,
} from '../../store';
import type {GenerationLease} from '../../store/generationLease';
import {
  CompletionParams,
  CompletionStreamData,
  toApiCompletionParams,
} from '../../utils/completionTypes';
import {acquireKeepAwake} from '../../utils/keepAwake';
import {stopQuietly} from '../../utils/stopQuietly';
import {ROUTES} from '../../utils/navigationConstants';
import {MIRACODE_HTML_BASE64} from './miracodeHtmlBundle';

interface NativeChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface NativeModelSummary {
  id: string;
  name: string;
  sizeBytes: number;
  isDownloaded: boolean;
  isLoaded: boolean;
}

interface NativeStatusPayload {
  activeModel: NativeModelSummary | null;
  isContextLoading: boolean;
  loadingModelName: string | null;
  downloadedModels: NativeModelSummary[];
  contextWindow: number;
  totalRamGB: number;
}

type WebInboundMessage =
  | {type: 'WEB_READY'}
  | {type: 'OPEN_NATIVE_DRAWER'}
  | {type: 'OPEN_MODELS_SCREEN'}
  | {type: 'SELECT_NATIVE_MODEL'; requestId: string; modelId: string}
  | {type: 'UNLOAD_NATIVE_MODEL'}
  | {
      type: 'GENERATE_CODE';
      requestId: string;
      messages: NativeChatMessage[];
      maxTokens: number;
      temperature: number;
    }
  | {type: 'ABORT_GENERATION'; requestId?: string}
  | {type: 'SHARE_FILE'; requestId: string; fileName: string; content: string}
  | {type: 'BACKUP_STORAGE'; payload: string}
  | {type: 'REQUEST_RESTORE_STORAGE'; requestId: string};

const BACKUP_FILE_PATH = `${RNFS.DocumentDirectoryPath}/miracode-workspace-backup.json`;
const STREAM_THROTTLE_MS = 45;

export const MiraCodeScreen: React.FC = observer(() => {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<DrawerNavigationProp<Record<string, object | undefined>>>();
  const webViewRef = useRef<WebView | null>(null);
  const webReadyRef = useRef(false);
  const totalRamGBRef = useRef(8);
  const activeLeasesRef = useRef<Map<string, GenerationLease>>(new Map());

  const miracodeHtml = useMemo(
    () => Buffer.from(MIRACODE_HTML_BASE64, 'base64').toString('utf8'),
    [],
  );

  const sendToWeb = useCallback((msg: Record<string, unknown>) => {
    if (!webViewRef.current) {
      return;
    }
    const serialized = JSON.stringify(msg);
    const script = `window.__MIRACODE_ON_NATIVE_MESSAGE__ && window.__MIRACODE_ON_NATIVE_MESSAGE__(${serialized}); true;`;
    webViewRef.current.injectJavaScript(script);
  }, []);

  const buildStatusPayload = useCallback((): NativeStatusPayload => {
    const activeModel = modelStore.activeModel;
    const downloadedModels: NativeModelSummary[] = modelStore.models
      .filter(m => m.isDownloaded)
      .map(m => ({
        id: m.id,
        name: m.name,
        sizeBytes: m.size || 0,
        isDownloaded: Boolean(m.isDownloaded),
        isLoaded: m.id === modelStore.activeModelId,
      }));

    return {
      activeModel: activeModel
        ? {
            id: activeModel.id,
            name: activeModel.name,
            sizeBytes: activeModel.size || 0,
            isDownloaded: Boolean(activeModel.isDownloaded),
            isLoaded: true,
          }
        : null,
      isContextLoading: modelStore.isContextLoading,
      loadingModelName: modelStore.loadingModel?.name ?? null,
      downloadedModels,
      contextWindow: modelStore.contextInitParams?.n_ctx ?? 4096,
      totalRamGB: totalRamGBRef.current,
    };
  }, []);

  const pushStatus = useCallback(() => {
    if (!webReadyRef.current) {
      return;
    }
    sendToWeb({type: 'NATIVE_STATUS', payload: buildStatusPayload()});
  }, [buildStatusPayload, sendToWeb]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(DeviceInfo.getTotalMemory())
      .then(bytes => {
        if (cancelled || typeof bytes !== 'number') {
          return;
        }
        const gb = Math.round((bytes / 1024 ** 3) * 10) / 10;
        totalRamGBRef.current = gb > 0 ? gb : 8;
        pushStatus();
      })
      .catch(() => {
        totalRamGBRef.current = 8;
      });
    return () => {
      cancelled = true;
    };
  }, [pushStatus]);

  useEffect(() => {
    const dispose = autorun(() => {
      const payload = buildStatusPayload();
      if (webReadyRef.current) {
        sendToWeb({type: 'NATIVE_STATUS', payload});
      }
    });
    return () => {
      dispose();
    };
  }, [buildStatusPayload, sendToWeb]);

  useEffect(() => {
    const leases = activeLeasesRef.current;
    return () => {
      for (const lease of leases.values()) {
        lease.abort();
      }
      leases.clear();
    };
  }, []);

  const handleGenerateCode = useCallback(
    async (msg: Extract<WebInboundMessage, {type: 'GENERATE_CODE'}>) => {
      const {requestId, messages, maxTokens, temperature} = msg;
      const releaseKeepAwake = acquireKeepAwake();
      let lease: GenerationLease | null = null;
      try {
        lease = await modelStore.acquireGeneration();
        if (!lease) {
          sendToWeb({
            type: 'GENERATE_ERROR',
            requestId,
            error:
              'No local GGUF model is loaded in Apple Metal memory. Tap the model pill above to load a 3B or 7B Coder model.',
          });
          return;
        }

        if (lease.signal.aborted) {
          sendToWeb({
            type: 'GENERATE_DONE',
            requestId,
            text: '',
            aborted: true,
          });
          return;
        }

        activeLeasesRef.current.set(requestId, lease);

        const base: CompletionParams = {
          ...defaultCompletionSettings,
          ...toJS(chatSessionStore.newChatCompletionSettings),
          messages,
          n_predict: Math.min(Math.max(maxTokens || 2048, 256), 4096),
          temperature: typeof temperature === 'number' ? temperature : 0.2,
          stop: toJS(modelStore.activeModel?.stopWords) ?? [],
          enable_thinking: false,
        };
        delete base.tools;
        delete base.tool_choice;

        const apiParams = toApiCompletionParams(base);
        apiParams.reasoning_format = 'auto';
        apiParams.enable_thinking = false;
        apiParams.chat_template_kwargs = {
          ...apiParams.chat_template_kwargs,
          enable_thinking: false,
        };

        const activeLease = lease;
        const onAbort = () =>
          stopQuietly(() => activeLease.engine.stopCompletion());
        activeLease.signal.addEventListener('abort', onAbort, {once: true});

        let accumulated = '';
        let lastStreamAt = 0;

        try {
          const result = await activeLease.engine.completion(
            apiParams,
            (data: CompletionStreamData) => {
              if (activeLease.signal.aborted) {
                return;
              }
              if (typeof data.content === 'string' && data.content.length > 0) {
                accumulated = data.content;
              } else if (
                typeof data.accumulated_text === 'string' &&
                data.accumulated_text.length > 0
              ) {
                accumulated = data.accumulated_text;
              } else if (typeof data.token === 'string') {
                accumulated += data.token;
              }

              const now = Date.now();
              if (now - lastStreamAt >= STREAM_THROTTLE_MS) {
                lastStreamAt = now;
                sendToWeb({
                  type: 'GENERATE_STREAM',
                  requestId,
                  accumulatedText: accumulated,
                  token: data.token,
                });
              }
            },
          );

          const finalText = result.content || result.text || accumulated;
          sendToWeb({
            type: 'GENERATE_DONE',
            requestId,
            text: finalText,
            tokensPredicted:
              result.tokens_predicted ?? result.timings?.predicted_n,
            modelName: modelStore.activeModel?.name,
            aborted: activeLease.signal.aborted || Boolean(result.interrupted),
          });
        } catch (error) {
          if (activeLease.signal.aborted) {
            sendToWeb({
              type: 'GENERATE_DONE',
              requestId,
              text: accumulated,
              modelName: modelStore.activeModel?.name,
              aborted: true,
            });
          } else {
            sendToWeb({
              type: 'GENERATE_ERROR',
              requestId,
              error:
                error instanceof Error
                  ? error.message
                  : 'Local Metal generation failed.',
            });
          }
        } finally {
          activeLease.signal.removeEventListener('abort', onAbort);
        }
      } finally {
        activeLeasesRef.current.delete(requestId);
        if (lease) {
          lease.end();
        }
        releaseKeepAwake();
      }
    },
    [sendToWeb],
  );

  const handleWebMessage = useCallback(
    async (event: WebViewMessageEvent) => {
      let msg: WebInboundMessage;
      try {
        msg = JSON.parse(event.nativeEvent.data) as WebInboundMessage;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') {
        return;
      }

      switch (msg.type) {
        case 'WEB_READY': {
          webReadyRef.current = true;
          pushStatus();
          break;
        }
        case 'OPEN_NATIVE_DRAWER': {
          navigation.openDrawer();
          break;
        }
        case 'OPEN_MODELS_SCREEN': {
          navigation.navigate(ROUTES.MODELS as never);
          break;
        }
        case 'SELECT_NATIVE_MODEL': {
          const model = modelStore.models.find(m => m.id === msg.modelId);
          if (!model) {
            sendToWeb({
              type: 'SELECT_NATIVE_MODEL_RESULT',
              requestId: msg.requestId,
              success: false,
              error: 'Model not found.',
            });
            return;
          }
          try {
            await modelStore.selectModel(model);
            sendToWeb({
              type: 'SELECT_NATIVE_MODEL_RESULT',
              requestId: msg.requestId,
              success: true,
            });
          } catch (error) {
            sendToWeb({
              type: 'SELECT_NATIVE_MODEL_RESULT',
              requestId: msg.requestId,
              success: false,
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to load model into Metal memory.',
            });
          } finally {
            pushStatus();
          }
          break;
        }
        case 'UNLOAD_NATIVE_MODEL': {
          try {
            await modelStore.manualReleaseContext();
          } finally {
            pushStatus();
          }
          break;
        }
        case 'GENERATE_CODE': {
          handleGenerateCode(msg).catch(error => {
            sendToWeb({
              type: 'GENERATE_ERROR',
              requestId: msg.requestId,
              error:
                error instanceof Error
                  ? error.message
                  : 'Generation failed unexpectedly.',
            });
          });
          break;
        }
        case 'ABORT_GENERATION': {
          if (msg.requestId) {
            activeLeasesRef.current.get(msg.requestId)?.abort();
          } else {
            for (const lease of activeLeasesRef.current.values()) {
              lease.abort();
            }
          }
          break;
        }
        case 'SHARE_FILE': {
          const safeName =
            msg.fileName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'miracode.html';
          const filePath = `${RNFS.CachesDirectoryPath}/${safeName}`;
          try {
            await RNFS.writeFile(filePath, msg.content, 'utf8');
            await Share.open({
              url: `file://${filePath}`,
              filename: safeName,
              failOnCancel: false,
            });
            sendToWeb({
              type: 'SHARE_FILE_RESULT',
              requestId: msg.requestId,
              success: true,
            });
          } catch (error) {
            sendToWeb({
              type: 'SHARE_FILE_RESULT',
              requestId: msg.requestId,
              success: false,
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to share exported file.',
            });
          }
          break;
        }
        case 'BACKUP_STORAGE': {
          try {
            await RNFS.writeFile(BACKUP_FILE_PATH, msg.payload, 'utf8');
          } catch {
            // Best-effort backup alongside IndexedDB.
          }
          break;
        }
        case 'REQUEST_RESTORE_STORAGE': {
          let payload: string | null = null;
          try {
            const exists = await RNFS.exists(BACKUP_FILE_PATH);
            if (exists) {
              payload = await RNFS.readFile(BACKUP_FILE_PATH, 'utf8');
            }
          } catch {
            payload = null;
          }
          sendToWeb({
            type: 'RESTORE_STORAGE_RESULT',
            requestId: msg.requestId,
            payload,
          });
          break;
        }
      }
    },
    [handleGenerateCode, navigation, pushStatus, sendToWeb],
  );

  return (
    <View
      testID="miracode-screen"
      style={[
        styles.container,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      <WebView
        ref={webViewRef}
        source={{html: miracodeHtml, baseUrl: 'https://app.miracode.local/'}}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        keyboardDisplayRequiresUserAction={false}
        hideKeyboardAccessoryView={false}
        bounces={false}
        scrollEnabled={false}
        overScrollMode="never"
        style={styles.webview}
        onContentProcessDidTerminate={() => webViewRef.current?.reload()}
        onMessage={handleWebMessage}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  webview: {
    flex: 1,
    backgroundColor: '#09090b',
  },
});
