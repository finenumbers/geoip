import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration suites share Postgres state and fixture seed.
    fileParallelism: process.env.RUN_INTEGRATION === '1' ? false : undefined,
  },
});
