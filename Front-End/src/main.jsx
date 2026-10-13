import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// Ponto de entrada da aplicação React.
createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
);
