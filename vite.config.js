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

          // Redireciona "/" e "" para "/ac-prod/"
          if (url === '/' || url === '' || url === '/index.html') {
            res.writeHead(302, { Location: '/ac-prod/' });
            res.end();
            return;
          }

          // SPA fallback: rotas dentro de /ac-prod/ sem extensão de arquivo
          // -> reescreve para /ac-prod/ e deixa o Vite servir o index.html
          if (url.startsWith('/ac-prod/') && !url.match(/\.[a-z0-9]+(\?.*)?$/i)) {
            req.url = '/ac-prod/';
          }

          next();
        });
      }
    },
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icons/*.png'],
      manifest: {
        name: 'AC.Prod — Controle de Produção',
        short_name: 'AC.Prod',
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