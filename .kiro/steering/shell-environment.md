---
inclusion: always
---

1. 当前开发环境默认 Shell 是 bash，永远不要使用 PowerShell 命令，也不需要 bash -c 啥的，直接写命令就行。

2. npx tsc --noEmit 2>&1

3. 代码里 调用 shell 命令的函数放在 os-utils.ts 里，统一放在 pai repo 里 (包括测试用例也在这里的vites下)，其他 repo 里直接复制使用即可，不需要单独再写测试用例了。
