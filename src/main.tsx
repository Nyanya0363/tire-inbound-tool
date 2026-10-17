import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installGlobalErrorLogging } from './core/logger';
import './styles.css';

installGlobalErrorLogging();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
