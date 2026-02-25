import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Inject Jest-compatible globals (describe, it, expect, vi, ...)
    globals: true,
    // Import reflect-metadata trước tất cả test files (bắt buộc cho NestJS decorators)
    setupFiles: ['./vitest.setup.ts'],
    // Root cho test files — bao gồm cả .spec.ts (NestJS convention)
    include: ['src/**/__tests__/**/*.{test,spec}.ts'],
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
