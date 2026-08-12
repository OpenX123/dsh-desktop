import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Archival build for the retained custom renderer prototype. The shipped
 * desktop shell does not build or load this output; its main window loads the
 * official Web UI origin directly. A relative base keeps this optional output
 * self-contained when it is built manually for reference.
 */
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    minify: false,
    sourcemap: true,
  },
})
