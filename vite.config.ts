import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Uji lokal: layanan admin (admin/terawang_admin, uvicorn port 3071) disajikan lewat alamat yang sama dengan dasbor.
  server: {
    proxy: {
      '/admin': 'http://127.0.0.1:3071',
      // API baca-saja (api/src/server.ts, `npm run api` di folder api): hasil model dari database.
      '/api': 'http://127.0.0.1:3072',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
