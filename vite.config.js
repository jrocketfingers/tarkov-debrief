/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(() => {
  return {
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      }
    },
    build: {
      outDir: 'build',
    },
    plugins: [react()],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      allowedHosts: ['caution-galleria-petal.ngrok-free.dev'],
      exclude: ['node_modules', 'build', 'e2e'],
    },
    server: {
      host: true,
      allowedHosts: ['caution-galleria-petal.ngrok-free.dev']
    }
  };
});
