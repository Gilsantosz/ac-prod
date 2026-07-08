import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'
import { VitePWA } from 'vite-plugin-pwa'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production';
  const appBase = process.env.VITE_APP_BASE || (isProduction ? '/ac-prod/' : '/');
  const normalizedBase = appBase.endsWith('/') ? appBase : `${appBase}/`;
  const baseWithoutTrailingSlash = normalizedBase === '/' ? '' : normalizedBase.slice(0, -1);

  return {
    base: normalizedBase,

    logLevel: 'info',

    plugins: [
      react(),
      {
        name: 'spa-fallback',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const url = req.url || '';

            if (normalizedBase !== '/') {
              // Redireciona a raiz e o base path sem barra para a URL canônica.
              if (url === '/' || url === '' || url === '/index.html') {
                res.writeHead(302, { Location: normalizedBase });
                res.end();
                return;
              }
              if (url === baseWithoutTrailingSlash || url.startsWith(`${baseWithoutTrailingSlash}?`)) {
                const query = url.includes('?') ? url.slice(url.indexOf('?')) : '';
                res.writeHead(302, { Location: `${normalizedBase}${query}` });
                res.end();
                return;
              }

              // SPA fallback: apenas reescreve para o index.html se for uma requisição GET de navegação (HTML)
              // e não for um recurso interno do Vite (como @vite/client ou @react-refresh)
              const accept = req.headers.accept || '';
              const isGet = req.method === 'GET';
              const isHtml = accept.includes('text/html');
              const isViteInternal = url.includes('/@');

              if (isGet && isHtml && url.startsWith(normalizedBase) && !isViteInternal) {
                req.url = normalizedBase;
              }
            }

            next();
          });
        },
        configurePreviewServer(server) {
          server.middlewares.use((req, res, next) => {
            const url = req.url || '';
            if (normalizedBase !== '/') {
              if (url === baseWithoutTrailingSlash || url.startsWith(`${baseWithoutTrailingSlash}?`)) {
                const query = url.includes('?') ? url.slice(url.indexOf('?')) : '';
                res.writeHead(302, { Location: `${normalizedBase}${query}` });
                res.end();
                return;
              }
            }
            next();
          });
        }
      },
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icons/*.png'],
        manifest: {
          id: normalizedBase,
          name: 'Leo Flow — Controle de Produção',
          short_name: 'Leo Flow',
          description: 'Sistema MES de controle de produção, rastreabilidade e painéis industriais.',
          theme_color: '#005f2f',
          background_color: '#f3f4f6',
          display: 'standalone',
          display_override: ['standalone', 'fullscreen', 'minimal-ui'],
          orientation: 'landscape',
          scope: normalizedBase,
          start_url: normalizedBase,
          lang: 'pt-BR',
          icons: [
            {
              src: `${normalizedBase}icons/icon-192.png`,
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any maskable',
            },
            {
              src: `${normalizedBase}icons/icon-512.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable',
            },
          ],
        },
        workbox: {
          // Cache estático
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
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
  };
});

