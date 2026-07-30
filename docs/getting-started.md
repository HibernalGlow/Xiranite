# Xiranite 快速上手

Xiranite 当前正式维护 Windows / Wails 桌面构建，同时提供 Web 开发入口。本文面向要在本地运行、调试或验证仓库的人。

## 环境要求

- [Bun](https://bun.sh/) 1.3.0 或更高版本
- Go 1.21 或更高版本，用于 Wails 桌面开发与构建
- Node.js 24 或更高版本，作为部分工具的备用运行时
- Windows 10/11 与可用的 WebView2，用于正式桌面路径

在仓库根目录安装 workspace 依赖：

```bash
bun install
```

## 启动 Web 开发环境

```bash
bun run dev
```

该命令会生成节点注册表、增量构建 workspace package，并启动 Vite 与本地后端。开发机内存紧张时使用：

```bash
bun run dev:lean
```

已确认 package 和注册表无需重建时，可使用快速入口：

```bash
bun run dev:quick
bun run dev:quick:lean
```

只连接已运行后端并启动前端时：

```bash
bun run dev:vite
```

## 启动 Windows 桌面环境

```bash
bun run dev:desktop
```

低内存入口：

```bash
bun run dev:desktop:lean
```

结束正常开发会话后运行：

```bash
bun run dev:stop
```

不要手工遗留 Vite、测试后端或桌面 helper 进程。多 Agent 或多工作树并行开发时，端口与 backend manifest 规则见 [开发会话](development-sessions.md)。

## 常用验证

Windows 开发机上的 build、typecheck、Vitest、Browser Mode 和原生构建必须串行运行。Vitest 固定使用单 worker。

```bash
bun run typecheck
bun run test:unit -- --maxWorkers=1
bun run test:browser -- path/to/example.browser.test.tsx
bun run lint
bun run check:source-size
```

前端布局与交互使用 Vitest Browser Mode；纯逻辑使用普通 Vitest；真实 Wails 跨进程行为使用 Go 或宿主集成测试。完整规则见 [前端测试规范](frontend-testing.md)。

## 构建

```bash
bun run build
bun run build:packages
bun run wails:build
```

原生 Rust 构建、测试和 Clippy 需要单 Cargo job；具体 crate 命令与 sccache 约定见仓库根目录的 `AGENTS.md`。

## CLI 快捷入口

仓库提供全局 shim 后，可在仓库根目录使用：

```bash
xr    # bun run dev
xrd   # bun run dev:desktop
```

CLI 命名、引导模式和 shim 细节见 [CLI 命名](cli-naming-and-guided-ui.md) 与 [CLI shim](cli-shims.md)。
