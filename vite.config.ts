import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The desktop renderer build. The built app is served by the harness child's
 * own HTTP carrier under the `/app/` prefix (the desktop glue registers that
 * route), so the bundle base must be `/app/` for same-origin asset loading.
 * Protocol-contract packages (`@deepseek-ai/dsh-host-apiproxy/api|client`)
 * resolve through their exports maps to built lib, exactly like Node
 * consumers — no alias needed.
 */
export default defineConfig({
  plugins: [react()],
  // Served under the harness carrier's /app prefix route.
  base: '/app/',
  build: {
    outDir: 'dist',
    minify: false,
    sourcemap: true,
  },
})
