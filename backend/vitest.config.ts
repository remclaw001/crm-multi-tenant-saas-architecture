import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Root cho test files
    include: ['src/**/__tests__/**/*.test.ts'],
    // Integration tests cần DB/Redis thật — chạy riêng
    exclude: ['src/**/__tests__/integration/**'],
    environment: 'node',
    // Timeout mặc định 5s — đủ cho unit tests
    testTimeout: 5_000,
    // Report chi tiết
    reporter: 'verbose',
  },
  esbuild: {
    target: 'es2022',
  },
});
