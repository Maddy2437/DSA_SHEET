import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { AppShell, Providers } from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <HashRouter>
        <AppShell />
      </HashRouter>
    </Providers>
  </StrictMode>,
);
