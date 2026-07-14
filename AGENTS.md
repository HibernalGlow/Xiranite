# Xiranite agent instructions

- 在合适的时候提交当前任务中由自己修改的部分，避免暂存区堆积；不得混入用户或其他任务的改动。
- 优先使用 Git Bash；不可用时再使用 PowerShell 7，并确保 UTF-8 编码。
- 前端验证优先编写可重复的自动化脚本或使用 Playwright。尽量不要使用应用内 Browser，因为它的交互和维护成本较高；只有用户明确要求时才使用 Browser。
