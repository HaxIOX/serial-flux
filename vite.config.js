import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // Use relative base so the same build works for:
  // - https://<user>.github.io/<repo>/ (project pages)
  // - https://<custom-domain>/ (custom domain)
  base: command === 'build' ? './' : '/',
  plugins: [react()],
}))
