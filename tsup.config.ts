import { defineConfig } from 'tsup';

export default defineConfig([
  {
    // LIB entry: generates type declarations, no shebang
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'node22',
    clean: true,
    sourcemap: true,
    dts: true,
    splitting: false,
    external: ['canvas', 'jsdom'],
  },
  {
    // CLI entry: injects shebang, no type declarations
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    target: 'node22',
    sourcemap: true,
    dts: false,
    splitting: false,
    banner: { js: '#!/usr/bin/env node' },
    external: ['canvas', 'jsdom'],
  },
]);
