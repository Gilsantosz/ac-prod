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

            // Não intercepta nem redireciona WebSockets e requisições internas do Vite (HMR, React Refresh, etc.)
            const isViteInternal =
              req.headers.upgrade === 'websocket' ||
              req.headers['sec-websocket-key'] ||
              url.includes('/@') ||
              url.includes('token=') ||
              url.startsWith('/@vite') ||
              url.startsWith('/@react-refresh') ||
              url.startsWith('/@id') ||
              url.startsWith('/@fs');

            if (isViteInternal) {
              return next();
            }

            if (normalizedBase !== '/') {
              const accept = req.headers.accept || '';
              const isHtml = accept.includes('text/html');

              // Redireciona a raiz e o base path sem barra para a URL canônica apenas em requisições de navegação HTML
              if ((url === '/' || url === '' || url === '/index.html') && isHtml) {
                res.writeHead(302, { Location: normalizedBase });
                res.end();
                return;
              }
              if ((url === baseWithoutTrailingSlash || url.startsWith(`${baseWithoutTrailingSlash}?`)) && isHtml) {
                const query = url.includes('?') ? url.slice(url.indexOf('?')) : '';
                res.writeHead(302, { Location: `${normalizedBase}${query}` });
                res.end();
                return;
              }

              // SPA fallback: apenas reescreve para o index.html se for uma requisição GET de navegação (HTML)
              const isGet = req.method === 'GET';

              if (isGet && isHtml && url.startsWith(normalizedBase)) {
                req.url = normalizedBase;
              }
            }

            next();
          });
        },
        configurePreviewServer(server) {
          server.middlewares.use((req, res, next) => {
            const url = req.url || '';
            const accept = req.headers.accept || '';
            const isHtml = accept.includes('text/html');

            const isViteInternal =
              req.headers.upgrade === 'websocket' ||
              req.headers['sec-websocket-key'] ||
              url.includes('/@') ||
              url.includes('token=');

            if (isViteInternal) {
              return next();
            }

            if (normalizedBase !== '/') {
              if ((url === baseWithoutTrailingSlash || url.startsWith(`${baseWithoutTrailingSlash}?`)) && isHtml) {
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
        devOptions: {
          enabled: false,
        },
        registerType: 'autoUpdate',
        injectRegister: 'inline',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icons/*.png'],
        manifest: {
          id: normalizedBase,
          name: 'Leo Flow — Controle de Produção',
          short_name: 'Leo Flow',
          description: 'Sistema MES de controle de produção, rastreabilidade e painéis industriais.',
          theme_color: '#005f2f',
          background_color: '#f3f4f6',
          display: 'standalone',
          display_override: ['window-controls-overlay', 'standalone'],
          orientation: 'any',
          scope: baseWithoutTrailingSlash || '/',
          start_url: normalizedBase,
          lang: 'pt-BR',
          icons: [
            {
              src: `${normalizedBase}icons/icon-192-v2.png`,
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any maskable',
            },
            {
              src: `${normalizedBase}icons/icon-512-v2.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable',
            },
          ],
        },
        workbox: {
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          // Mantém somente os arquivos estáticos do aplicativo no cache.
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          // Dados MES são transacionais: nunca reutilizar respostas antigas do Supabase.
          // O modo offline e a fila durável de coletas são controlados pela aplicação,
          // não pelo cache HTTP do Service Worker.
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
              handler: 'NetworkOnly',
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