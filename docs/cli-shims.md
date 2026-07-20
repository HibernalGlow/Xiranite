# Xiranite CLI Shim

使用 `scripts/install-cli-shims.ts` 将迁移后的 TypeScript CLI 暴露为系统命令，同时保留旧的 Python 安装。

该脚本将受管理的 shim 文件写入目标目录：

- `xiranite.cmd`
- `xr.cmd`：在仓库根目录运行 `bun run dev`，一键启动后端 + 前端开发服务器
- `xrd.cmd`：在仓库根目录运行 `bun run dev:desktop`，启动 Wails 桌面开发模式
- 根据当前 CLI 命名策略，每个已迁移节点包对应一个 `x<node>.cmd`
- 可选的旧版别名：`anode.cmd`、`aestiv.cmd`、`aestiva.cmd`

`xr`/`xrd` 通过 `bun --cwd <repoRoot> run <script>` 启动，因此可从任意目录调用，无需先 `cd` 到仓库。这两个 shim 仅校验仓库根目录存在 `package.json`，不依赖 `dist` 产物；首次运行时 `dev`/`dev:desktop` 脚本内部会自行执行 `generate:node-registries` 与 `build:packages:turbo`。

开发完成后请运行 `xr stop`。它会先请求开发主管进程关闭后端和子进程；若终端已被直接关闭且主管进程未响应，才会核验命令行属于当前 Xiranite 工作区后终止记录的遗留进程树。`xr reboot` 会停止后重新启动浏览器开发宿主，`xrd reboot` 对应重启 Wails 开发宿主；额外参数会传给新的启动命令。

`xr ui` 和 `xrd ui` 使用仓库现有的 OpenTUI + React 环境打开开发控制台，分别管理浏览器和 Wails 开发宿主。控制台提供启动、停止、重启、彩色终端输出、PID 和运行时长；退出控制台会安全停止受管进程。子进程由 Bun 原生 `Terminal` 提供真实 PTY，`@xterm/headless` 负责 ANSI、256 色、TrueColor 和滚动缓冲解析，OpenTUI 只绘制当前可见 viewport；输出刷新合并到最多 20 FPS，空闲时不刷新输出面板，也不执行周期性的 PowerShell/CIM 资源查询。也可从仓库根目录运行 `bun run dev:ui` 或 `bun run dev:desktop:ui`。更新后需重新执行安装命令，才能生成带有这些路由的本地 shim。

默认目标：

```powershell
~\.xiranite\bin
```

推荐流程：

```powershell
bun run build:packages
bun scripts/install-cli-shims.ts --dry-run --legacy-aliases
bun scripts/install-cli-shims.ts --force --legacy-aliases
```

然后将目标目录置于用户 `PATH` 中的 Python Scripts 之前。对于当前 PowerShell 会话：

```powershell
$env:Path = "$HOME\.xiranite\bin;$env:Path"
```

这些 shim 体积小巧且可逆。它们通过 Bun 调用编译后的 JS 文件，例如：

```cmd
bun "D:\1VSCODE\Projects\Xiranite\packages\cli\dist\index.js" %*
```

安全规则：

- `--dry-run` 打印计划写入的内容，不触碰文件系统。
- 除非传递 `--force`，否则跳过现有未受管理的文件。
- 现有受管理的 Xiranite shim 可安全覆盖。
- 脚本会检查 `dist/cli.js` 文件是否存在，如果缺失则提示你运行 `bun run build:packages`。

旧版别名会分发到聚合的 `xiranite` CLI。除非你刻意希望旧的 Python 命令名称解析到 Xiranite，否则保持禁用状态。
