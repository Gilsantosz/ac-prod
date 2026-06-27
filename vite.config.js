import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'
import { VitePWA } from 'vite-plugin-pwa'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // Base path para GitHub Pages: https://gilsantosz.github.io/ac-prod/
  base: '/ac-prod/',

  logLevel: 'info',

  plugins: [
    react(),
    {
      name: 'spa-fallback',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url || '';

          // Redireciona a raiz e o base path sem barra para a URL canônica.
          if (url === '/' || url === '' || url === '/index.html') {
            res.writeHead(302, { Location: '/ac-prod/' });
            res.end();
            return;
          }
          if (url === '/ac-prod' || url.startsWith('/ac-prod?')) {
            const query = url.includes('?') ? url.slice(url.indexOf('?')) : '';
            res.writeHead(302, { Location: `/ac-prod/${query}` });
            res.end();
            return;
          }

          // SPA fallback: apenas reescreve para o index.html se for uma requisição GET de navegação (HTML)
          // e não for um recurso interno do Vite (como @vite/client ou @react-refresh)
          const accept = req.headers.accept || '';
          const isGet = req.method === 'GET';
          const isHtml = accept.includes('text/html');
          const isViteInternal = url.includes('/@');

          if (isGet && isHtml && url.startsWith('/ac-prod/') && !isViteInternal) {
            req.url = '/ac-prod/';
          }

          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url || '';
          if (url === '/ac-prod' || url.startsWith('/ac-prod?')) {
            const query = url.includes('?') ? url.slice(url.indexOf('?')) : '';
            res.writeHead(302, { Location: `/ac-prod/${query}` });
            res.end();
            return;
          }
          next();
        });
      }
    },
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icons/*.png'],
      manifest: {
        name: 'Leo Flow — Controle de Produção',
        short_name: 'Leo Flow',
        description: 'Sistema MES de controle e apontamento de produção industrial',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/ac-prod/',
        start_url: '/ac-prod/',
        lang: 'pt-BR',
        icons: [
          {
            src: '/ac-prod/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/ac-prod/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Cache estático
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 3000000,
        // Estratégia network-first para API calls Supabase
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 5 },
              networkTimeoutSeconds: 10,
            },
          },
        ],
      },
    }),
  ],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          router: ['react-router-dom'],
          charts: ['recharts'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
