import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FullPageApp } from './FullPageApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FullPageApp />
  </StrictMode>,
);
