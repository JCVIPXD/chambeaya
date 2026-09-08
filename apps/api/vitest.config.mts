import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `tsc --outDir dist` may be run locally for the production image. Those
    // CommonJS artifacts are not Vitest source suites and must not be collected.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
  },
});
