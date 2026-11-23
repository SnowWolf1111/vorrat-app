import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Auf GitHub Pages liegt die App unter /<repo-name>/ – der Workflow setzt BASE_PATH.
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Vorrat',
        short_name: 'Vorrat',
        description: 'Vorrat, Mindestbestand und Einkaufsliste',
        lang: 'de',
        theme_color: '#14532d',
        background_color: '#0f1412',
        display: 'standalone',
        start_url: base,
        scope: base,
        // Lange auf das App-Symbol drücken -> Schnellzugriffe (Android)
        shortcuts: [
          { name: 'Sprechen', short_name: 'Sprechen', url: `${base}#sprechen`, icons: [{ src: 'icon-192.png', sizes: '192x192' }] },
          { name: 'Scannen', short_name: 'Scannen', url: `${base}#scan`, icons: [{ src: 'icon-192.png', sizes: '192x192' }] },
          { name: 'Einkaufsliste', short_name: 'Einkauf', url: `${base}#einkauf`, icons: [{ src: 'icon-192.png', sizes: '192x192' }] },
          { name: 'Läuft ab', short_name: 'MHD', url: `${base}#mhd`, icons: [{ src: 'icon-192.png', sizes: '192x192' }] },
        ],
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          // Artikelbilder (eigene, Produktfotos, KI-Bilder) offline vorhalten
          {
            urlPattern: ({ url }) => url.pathname.includes('/img/') || url.hostname.includes('openfoodfacts'),
            handler: 'CacheFirst',
            options: { cacheName: 'bilder', expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 180 }, cacheableResponse: { statuses: [0, 200] } },
          },
          // Texterkennung (Tesseract) nach dem ersten Laden offline
          {
            urlPattern: ({ url }) => url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'tessdata.projectnaptha.com',
            handler: 'CacheFirst',
            options: { cacheName: 'ocr', expiration: { maxEntries: 20 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
})
