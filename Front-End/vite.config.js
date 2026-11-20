import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Copia dist/index.html para dist/404.html para suportar F5/reload em subrotas no GitHub Pages.
function githubPagesSpaFallback() {
  return {
    name: 'github-pages-spa-fallback',
    closeBundle() {
      const distDir = path.resolve(process.cwd(), 'dist');
      const indexFile = path.join(distDir, 'index.html');
      const notFoundFile = path.join(distDir, '404.html');
      if (fs.existsSync(indexFile)) {
        fs.copyFileSync(indexFile, notFoundFile);
      }
    },
  };
}

// Ativa o suporte do Vite a arquivos JSX/React.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), githubPagesSpaFallback()],
});
