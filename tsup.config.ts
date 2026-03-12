import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  outDir: 'dist',
  outExtension: () => ({ js: '.js' }),
  bundle: true,
  minify: false,
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  external: ['keytar'],
})
