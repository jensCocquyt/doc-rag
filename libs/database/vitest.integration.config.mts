import { defineConfig } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/libs/database-integration',
  plugins: [nxViteTsPaths()],
  test: {
    name: 'database-integration',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.integration.spec.ts'],
    reporters: ['default'],
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
}));
