import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setupTests.js'],
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    css: true,
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: [
        'src/lib/traceabilityService.js',
        'src/lib/readers/**/*.js',
        'src/components/entry/ProductionForm.jsx',
        'src/components/traceability/{TraceabilityScannerPanel,MobileCameraScanner}.jsx',
      ],
    },
  },
});
