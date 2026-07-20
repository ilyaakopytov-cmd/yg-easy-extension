import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { PopupApp } from './PopupApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <PopupApp />
    </ErrorBoundary>
  </StrictMode>,
);
