import { build } from 'esbuild';

// @actions/* are ESM but some of their dependencies still call require() for
// Node built-ins, which an ESM bundle can't do without this shim.
const requireShim = [
  "import { createRequire as __createRequire } from 'node:module';",
  'const require = __createRequire(import.meta.url);',
].join('\n');

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  banner: { js: requireShim },
  legalComments: 'none',
  logLevel: 'info',
});
