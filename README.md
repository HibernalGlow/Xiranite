# Xiranite

一个以节点为核心的可视化工作台：把工具、媒体处理和日常工作流部署到同一个可组合的桌面/Web 环境中。

Xiranite 适合需要频繁切换工具、整理本地资源并持续调整工作区的人。节点只负责自己的能力，工作区负责组合、布局、运行和持久化。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Repository](https://img.shields.io/badge/GitHub-HibernalGlow%2FXiranite-181717?logo=github)](https://github.com/HibernalGlow/Xiranite)

## 你可以用它做什么

- 从模块库搜索节点，并拖拽到工作区立即使用
- 在仪表盘、卡片、标签页、流程画布、泳道和自由网格之间切换同一组节点的呈现方式
- 将文件整理、媒体处理、同步转换、环境配置等工具集中到一个界面
- 使用本地后端运行节点，把 Web 开发模式和 Wails 桌面模式共用同一套前端与节点契约
- 用主题、背景、操作栏位置和布局持久化，把工作区调整成自己的工具环境

## 核心机制

### 一个节点，多种工作区

模块库负责发现和部署节点；工作区负责展示和组织节点。节点通过统一的 `deployComponent` 机制进入不同视图，同一个节点可以根据任务需要出现在多个视图中。

| 视图 | 适合场景 | 主要能力 |
| --- | --- | --- |
| **Dashboard** | 查看全局状态 | 资源概览、运行历史、后端健康状态和快捷操作 |
| **Cards** | 日常操作 | Grid、Stack、Split、Focus 四种卡片布局 |
| **Dockview** | 并行工作 | IDE 式标签页、拖拽分屏和多节点监控 |
| **Flow** | 编排工作流 | 无限画布、缩放平移和节点连线 |
| **Lane** | 分组处理 | 泳道、跨列拖拽和工作流分组 |
| **Bento** | 自由排布 | 12 列网格、调整尺寸、折叠和布局持久化 |

### 节点是可独立演进的能力单元

系统模块提供设置、模块库、运行历史、终端、任务、看板、数据库、富文本和音乐播放等基础能力。PackU 节点则覆盖媒体处理、文件整理、同步转换和系统工具等场景；节点的核心运行时位于 `packages/nodes/*`，应用侧工作台位于 `src/nodes/<id>/`。

## 快速开始

### 前置依赖

- [Bun](https://bun.sh) 1.3.0+
- Go 1.21+（桌面端开发与构建）
- Node.js 24+（备用运行时）

### Web 开发模式

```bash
bun install
bun run dev
```

`bun run dev` 会生成节点注册表、构建 workspace 包，并启动前端与本地后端。

常用开发入口：

```bash
bun run dev:lean       # 低内存开发模式
bun run dev:vite       # 仅启动 Vite 前端
bun run dev:desktop    # 启动 Wails 桌面开发模式
bun run dev:desktop:lean
```

开发会话的端口、后端 manifest 和共享 Vite 缓存约定见 [开发会话说明](docs/development-sessions.md)。

### 全局 CLI 快捷命令

安装仓库提供的 CLI 后，可在仓库根目录使用：

```bash
xr    # 等价于 bun run dev
xrd   # 等价于 bun run dev:desktop
```

## 项目结构

```text
Xiranite/
├── src/                    # React 应用、工作区视图和节点工作台
│   ├── components/         # 工作区、系统视图和基础 UI
│   ├── nodes/              # 节点专属前端界面
│   ├── store/              # Zustand 工作区状态
│   └── styles/themes/      # 主题 CSS
├── packages/
│   ├── api/ contract/      # API 与跨端契约
│   ├── runtime/ backend/   # 节点运行时与本地后端
│   ├── repository/ services/ # 持久化与业务服务
│   └── nodes/              # 独立节点包
├── scripts/                # 注册表、构建和审计脚本
├── docs/                   # 架构、设计和开发文档
└── main.go                 # Wails 桌面入口
```

## 主题系统

Xiranite 提供 16+ 内置主题预设，并支持系统跟随、浅色/深色模式、网格或点阵背景、自定义图片背景、操作栏位置和自定义主题对象导入。

其中 **Wuling Jade Industrial** 是项目的代表性主题：以冷灰实验室表面、玉绿强调色、硬边阴影、技术面板和数据等宽字体构成偏工业的工作台视觉。主题细节集中在 `src/styles/themes/`。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | React 19、TypeScript、Vite 7 |
| UI | Tailwind CSS v4、shadcn/ui、Lucide |
| 状态与布局 | Zustand、dockview-react、gridstack、@dnd-kit |
| 国际化 | i18next（中文/英文） |
| 桌面端 | Wails v3、Go |
| 包管理与工作流 | Bun 1.3.0、Turbo |

## 开发与构建

```bash
# 构建
bun run build
bun run build:packages
bun run wails:build

# 类型检查与测试
bun run typecheck
bun run test:unit
bun run test:browser
bun run lint

# 节点注册表与质量审计
bun run generate:node-registries
bun run audit:node-architecture
bun run audit:node-ui-quality
```

项目遵循以下边界：

- 前端交互优先放在 `src/nodes/<id>/`，节点 package 聚焦运行时、CLI 和核心逻辑
- 共享类型与跨端协议放在 `packages/contract`、`packages/shared` 等公共包
- 新增节点后重新生成节点注册表
- 前端布局和交互回归使用 Vitest Browser Mode；纯逻辑使用普通 Vitest

更多约定见 [开发会话说明](docs/development-sessions.md) 以及 `docs/` 下的架构文档。

## 国际化

界面支持中文和英文。可以在 **设置 → Language** 切换语言；节点名称和描述通过 `module:<id>.name` 等 i18next key 管理。

## 致谢

Xiranite 使用或参考了以下开源项目：

- [shadcn/ui](https://ui.shadcn.com/)：基础组件体系
- [dockview](https://dockview.dev/)：标签页与分屏布局
- [gridstack](https://gridstackjs.com/)：自由网格布局
- [Wails](https://wails.io/)：桌面应用框架
- Endfield、Onlook、Tori、Conductor：主题视觉参考

## License

[MIT](LICENSE)
