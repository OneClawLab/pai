import { defineConfig } from 'tsup';

export default defineConfig({
  // 入口文件，可以是一个数组或对象（用于多入口）
  entry: ['src/index.ts'],
  
  // 目标环境
  target: 'node20',
  
  // 输出格式：CLI 工具建议仅使用 ESM，除非有特殊的旧版兼容需求
  format: ['esm'],
  
  // 自动生成 .d.ts 声明文件
  dts: true,
  
  // 每次构建前清理 dist 目录
  clean: true,
  
  // 开启 Source Maps 方便调试
  sourcemap: true,
  
  // 压缩代码 (CLI 工具如果逻辑复杂建议开启，开发阶段可设为 false)
  minify: false,
  
  // 静态资源处理
  splitting: false,

  // 关键：确保输出文件的头部包含 Shebang，否则 CLI 无法直接执行
  banner: {
    js: '#!/usr/bin/env node',
  },

  // 这里的配置可以防止某些 node 内置模块被错误地 bundle
  external: ['canvas', 'jsdom'], 
});