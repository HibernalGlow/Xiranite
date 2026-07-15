# Xiranite agent instructions

- 在合适的时候提交当前任务中由自己修改的部分，避免暂存区堆积；不得混入用户或其他任务的改动。
- 优先使用 Git Bash；不可用时再使用 PowerShell 7，并确保 UTF-8 编码。
- 前端验证优先编写可重复的自动化脚本或使用 Playwright。尽量不要使用应用内 Browser，因为它的交互和维护成本较高；只有用户明确要求时才使用 Browser。
- Windows 开发机内存预算有限：NeoView 的 build、typecheck、Vitest、Playwright、性能审计和原生构建必须严格串行，前一进程完全退出后才能启动下一项；Vitest 使用 `--maxWorkers=1`。即使工具支持并行调用也不得并发执行这些重任务，避免 esbuild/Vitest/原生编译共同触发系统提交内存耗尽。
