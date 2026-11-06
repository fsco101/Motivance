import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Local Supabase Auth already lists this address as its site URL.
  server: { port: 3000, strictPort: true },
  preview: { port: 3000, strictPort: true },
  build: { sourcemap: false },
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'unit', environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'], setupFiles: ['src/test/setup.ts'] },
      },
      {
        extends: true,
        test: { name: 'contract', environment: 'node', include: ['tests/contract/**/*.test.ts'], testTimeout: 30_000, hookTimeout: 30_000 },
      },
    ],
  },
})
