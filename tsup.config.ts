import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/main.ts' },
  format: ['cjs'],
  bundle: true,
  minify: true,
  sourcemap: true,
  outDir: 'dist',
  outExtension: () => ({ js: '.js' }),
  noExternal: [/.*/], // bundle everything — required for GitHub Actions
})
