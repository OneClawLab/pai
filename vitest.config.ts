import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    watch: false, // 禁用默认的 Watch 模式
    testTimeout: 10000, // 10 seconds for property-based tests
    fileParallelism: false, // 顺序执行文件，避免并发资源争用
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.config.ts',
      ],
    },
  },
});
