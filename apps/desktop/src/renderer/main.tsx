import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppShell } from './app/AppShell';
import './styles/global.css';
import './styles/workbench.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found.');

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>,
);
