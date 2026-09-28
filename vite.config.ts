import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  server: process.env.EVALUCHESS_API_URL
    ? { proxy: { '/api': process.env.EVALUCHESS_API_URL } }
    : undefined,
  plugins: [react(), tailwindcss()],
})
