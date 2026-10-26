import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Makes the site installable ("Add to Home Screen") and keeps the app shell available offline.
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Movie Night',
        short_name: 'Movie Night',
        description: 'Swipe movies and series together; watch what you both like.',
        theme_color: '#B0123E',
        background_color: '#F2F0F6',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
})
