import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages sirve la app desde /<repositorio>/; el resto de hosts usa la raíz.
// VITE_BASE_PATH permite fijar la base sin tocar el código (ver .github/workflows/deploy.yml).
const base = (process.env.VITE_BASE_PATH ?? '/').replace(/\/*$/, '/');

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: base,
        name: 'INVENTRA — Gestión integral de inventarios',
        short_name: 'INVENTRA',
        description:
          'Control de inventarios: entradas, salidas, producción, BOM, trazabilidad y reportes.',
        lang: 'es',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#f5f7f9',
        theme_color: '#0e5c63',
        categories: ['business', 'productivity'],
        icons: [
          {
            src: `${base}pwa-192.png`,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: `${base}pwa-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: `${base}pwa-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
