import { defineConfig } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/libs/retrieval-integration',
  plugins: [nxViteTsPaths()],
  test: {
    name: 'retrieval-integration',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.integration.spec.ts'],
    reporters: ['default'],
    testTimeout: 120000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
}));
