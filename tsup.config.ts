import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { zocket: 'src/index.ts' },
  format: ['esm'],
  outDir: 'dist',
  bundle: true,
  minify: false,
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  external: ['keytar'],
})
