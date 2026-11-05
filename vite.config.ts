/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

import angular from '@analogjs/vite-plugin-angular';
import viteTsConfigPaths from 'vite-tsconfig-paths';

export default defineConfig(({ mode }) => ({
  plugins: [angular(), viteTsConfigPaths()],
  test: {
    reporters: ['default'],
    projects: [
      {
        plugins: [angular(), viteTsConfigPaths()],
        test: {
          name: 'web',
          globals: true,
          setupFiles: ['web/src/test-setup.ts'],
          environment: 'jsdom',
          include: ['web/src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
          isolate: true, // Run each test file in isolation to prevent TestBed state pollution
        },
      },
      {
        test: {
          name: 'shared-analytics',
          environment: 'jsdom',
          environmentOptions: { jsdom: { url: 'https://kualia.com' } },
          include: ['packages/shared/src/analytics/**/*.spec.ts'],
        },
      },
      {
        plugins: [viteTsConfigPaths()],
        test: {
          name: 'convex',
          globals: true,
          environment: 'node',
          include: ['convex/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}'],
        },
      },
    ],
  },
  define: {
    'import.meta.vitest': mode !== 'production',
  },
}));
