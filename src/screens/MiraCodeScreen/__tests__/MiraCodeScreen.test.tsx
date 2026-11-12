import React from 'react';
import {act, render, waitFor} from '@testing-library/react-native';

import {modelStore} from '../../../store';
import {ROUTES} from '../../../utils/navigationConstants';
import {MiraCodeScreen} from '../MiraCodeScreen';

const mockNavigate = jest.fn();
const mockOpenDrawer = jest.fn();
const mockInjectJavaScript = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    openDrawer: mockOpenDrawer,
  }),
}));

jest.mock('react-native-webview', () => {
  const ReactLib = require('react');
  const {View} = require('react-native');
  const MockWebView = ReactLib.forwardRef((props: any, ref: any) => {
    ReactLib.useImperativeHandle(ref, () => ({
      injectJavaScript: mockInjectJavaScript,
      reload: jest.fn(),
    }));
    return ReactLib.createElement(View, {testID: 'mock-webview', ...props});
  });
  return {
    __esModule: true,
    WebView: MockWebView,
    default: MockWebView,
  };
});

describe('MiraCodeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the offline WebView studio container', () => {
    const {getByTestId} = render(<MiraCodeScreen />);
    expect(getByTestId('miracode-screen')).toBeTruthy();
    expect(getByTestId('mock-webview')).toBeTruthy();
  });

  it('pushes NATIVE_STATUS on WEB_READY and handles navigation messages', async () => {
    const {getByTestId} = render(<MiraCodeScreen />);
    const webview = getByTestId('mock-webview');

    await act(async () => {
      await webview.props.onMessage({
        nativeEvent: {data: JSON.stringify({type: 'WEB_READY'})},
      });
    });

    expect(mockInjectJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('NATIVE_STATUS'),
    );

    await act(async () => {
      await webview.props.onMessage({
        nativeEvent: {data: JSON.stringify({type: 'OPEN_MODELS_SCREEN'})},
      });
    });
    expect(mockNavigate).toHaveBeenCalledWith(ROUTES.MODELS);

    await act(async () => {
      await webview.props.onMessage({
        nativeEvent: {data: JSON.stringify({type: 'OPEN_NATIVE_DRAWER'})},
      });
    });
    expect(mockOpenDrawer).toHaveBeenCalled();
  });

  it('reports GENERATE_ERROR when no Metal model is loaded', async () => {
    (modelStore.acquireGeneration as jest.Mock).mockResolvedValueOnce(null);
    const {getByTestId} = render(<MiraCodeScreen />);
    const webview = getByTestId('mock-webview');

    await act(async () => {
      await webview.props.onMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'GENERATE_CODE',
            requestId: 'req_1',
            messages: [{role: 'user', content: 'Build a counter'}],
            maxTokens: 512,
            temperature: 0.2,
          }),
        },
      });
    });

    await waitFor(() => {
      expect(mockInjectJavaScript).toHaveBeenCalledWith(
        expect.stringContaining('GENERATE_ERROR'),
      );
    });
  });
});
