import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import './site-flow.css';
import './pledge.css';
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
