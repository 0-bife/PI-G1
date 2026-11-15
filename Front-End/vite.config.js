import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Ativa o suporte do Vite a arquivos JSX/React.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
});
