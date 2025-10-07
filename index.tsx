import '@react-three/fiber';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const boot = window.__rtsBootStatus;
boot?.wire?.();
boot?.show?.('Starting rendering engine…');

const rootElement = document.getElementById('root');
if (!rootElement) {
  const message = 'Could not find root element to mount to';
  boot?.error?.(message);
  throw new Error(message);
}

try {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  boot?.hide?.();
} catch (error) {
  const message =
    error instanceof Error ? error.message : 'Unknown error while mounting the app';
  boot?.error?.(`Failed to start game UI: ${message}`);
  throw error;
}
