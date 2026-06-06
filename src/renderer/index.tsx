import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// Suppress benign ResizeObserver errors in Webpack Dev Server overlay
window.addEventListener('error', (e) => {
  if (e.message === 'ResizeObserver loop completed with undelivered notifications.' || e.message === 'ResizeObserver loop limit exceeded') {
    e.stopImmediatePropagation();
  }
});

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
