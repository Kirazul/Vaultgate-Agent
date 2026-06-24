export {};

declare global {
  interface Window {
    vaultgate?: {
      platform: string;
      version: string;
      window?: {
        close: () => void;
        minimize: () => void;
        toggleMaximize: () => void;
        toggleFullscreen: () => void;
      };
    };
  }
}
