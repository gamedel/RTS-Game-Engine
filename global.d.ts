interface RTSBootStatusAPI {
  show?: (message?: string) => void;
  hide?: () => void;
  error?: (message: string) => void;
  wire?: () => void;
}

declare global {
  interface Window {
    __rtsBootStatus?: RTSBootStatusAPI;
  }
}

export {};
