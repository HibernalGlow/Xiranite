# Xiranite

Xiranite 是一个面向节点编排与可视化工作台的桌面/Web 混合应用。它以**模块（节点）**为核心单元，支持在多种视图形态中自由部署、组合和运行功能单元，并通过深度可定制的主题系统提供差异化的视觉体验。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React 19 + TypeScript |
| 构建工具 | Vite 7 |
| 样式方案 | Tailwind CSS v4 + shadcn/ui |
| 状态管理 | Zustand |
| 国际化 | i18next (zh/en) |
| 布局引擎 | dockview-react / gridstack / @dnd-kit |
| 桌面框架 | Wails v3 (Go) |
| 包管理 | Bun 1.3.0 |
| 工作流 | Turbo |

---

## 快速开始

### 前置依赖

- [Bun](https://bun.sh) 1.3.0+
- Go 1.21+（桌面端构建）
- Node.js 24+（备用）

### 安装与启动

```bash
# 安装依赖
bun install

# 启动 Web 开发服务器（前端 + 本地后端）
bun run dev

# 仅启动 Vite 前端（后端独立运行时）
bun run dev:vite

# 启动桌面端开发模式
bun run dev:desktop
```

### 全局 CLI 快捷命令

安装后可在任意目录使用：

```bash
xr    # 等价于 bun run dev，在仓库根目录启动开发服务器
xrd   # 等价于 bun run dev:desktop，启动桌面开发模式
```

---

## 架构概览

Xiranite 采用 **Monorepo** 结构，核心代码分为三层：

```
Xiranite/
├── src/                          # 前端应用主包
│   ├── components/
│   │   ├── workspace/            # 6 种视图模式渲染器
│   │   ├── views/                # 系统级视图（设置、模块库、运行历史等）
│   │   ├── modules/              # 模块渲染与注册中心
│   │   └── ui/                   # shadcn/ui 基础组件
│   ├── nodes/                    # 节点专属 UI（Component.tsx / controls.tsx / Workbench.tsx）
│   ├── store/                    # Zustand 全局状态
│   ├── lib/                      # 工具函数与主题系统
│   └── styles/themes/            # 主题 CSS（含武陵主题）
│
├── packages/
│   ├── api/                      # API 类型与客户端
│   ├── contract/                 # 跨端契约
│   ├── shared/                   # 共享类型与工具
│   ├── runtime/                  # 节点运行时
│   ├── backend/                  # 本地后端服务
│   ├── cli/                      # CLI 入口
│   ├── repository/               # 数据持久化
│   ├── services/                 # 业务服务层
│   └── nodes/                    # 40+ 独立节点包
│       ├── gifu, simiu, jellypot # PackU 系列节点
│       ├── enginev, lorat        # 媒体处理节点
│       ├── envuconfig, smartzip  # 工具节点
│       └── ...                   # 更多节点
│
├── scripts/                      # 工程脚本（注册表生成、构建、审计）
├── docs/                         # 设计文档与计划
└── main.go                       # Wails 桌面入口
```

---

## 六种视图模式

Xiranite 的核心交互围绕**视图模式（View Mode）**展开。同一组节点可在不同视图中以完全不同的形态呈现，并通过统一的 `deployComponent` 机制部署。

### 1. Dashboard — 系统仪表盘

Dashboard 是默认入口视图，提供对整个系统运行状态的宏观监控：

- **资源概览**：节点总数、运行中操作数、后端健康状态
- **运行历史**：近期节点执行的时序流，带状态标签（成功/失败/进行中）
- **性能图表**：基于 recharts 的面积图与柱状图，展示调用频率与资源占用趋势
- **快捷操作**：一键重启后端、复制开发命令、打开前端 Dev URL

> 部署节点方式：在模块库选择节点，选择 **Dashboard** 作为目标视图，节点将作为监控卡片嵌入仪表盘。

### 2. Cards — 卡片视图

最灵活的通用视图，支持四种子布局：

| 子布局 | 行为 |
|--------|------|
| **Grid** | 等宽网格，自动响应式排列 |
| **Stack** | 垂直堆叠，适合长内容节点 |
| **Split** | 双栏布局，对比查看 |
| **Focus** | 单卡片聚焦，沉浸式操作 |

卡片支持智能权重排序：运行中的节点、发生错误的节点、被聚焦的节点会自动获得更大的显示面积。拖拽模块到画布即可部署。

### 3. Dockview — 标签页视图

基于 `dockview-react` 实现的 IDE 式多标签布局：

- 每个节点占据一个独立标签页，可自由拖拽分屏
- 支持左右/上下分栏，适合多节点并行监控
- 关闭标签页仅在当前视图隐藏节点，不会销毁实例
- 空态时提供快捷入口打开模块库

> 部署节点方式：从模块库拖拽节点到 dockview 画布，自动创建新标签页。

### 4. Flow — 流式画布

用于可视化编排节点工作流：

- 无限画布，支持缩放与平移
- 节点以卡片形式放置在画布任意位置
- 节点之间可通过连线建立数据流关系
- 拖拽模块到画布指定位置即可部署

### 5. Lane — 泳道视图

基于 `@dnd-kit` 实现的 Kanban 式列布局：

- 水平泳道排列，每列代表一个逻辑分组
- 支持拖拽卡片跨泳道移动
- 底部 Dock 指示器显示当前所在泳道位置
- 可动态添加/删除泳道

> 部署节点方式：拖拽模块到任意泳道，或空态时直接部署到默认泳道。

### 6. Bento — 网格视图

基于 `gridstack` 的自由网格布局：

- 12 列网格系统，每个节点占据可变宽高的网格单元
- 支持拖拽调整位置，拖拽右下角调整大小
- 节点支持**折叠/展开**状态，折叠后仅显示标题栏与进度条
- 每个节点有独立的布局持久化（`bentoLayout`）

> 部署节点方式：拖拽模块到网格任意位置，自动计算网格坐标插入。

---

## 模块与节点系统

### 系统模块（内置组件）

| 模块 ID | 名称 | 功能 |
|---------|------|------|
| `settings` | 设置 | 主题、背景、运行时、数据管理 |
| `module-registry` | 模块库 | 浏览、搜索、部署所有可用模块 |
| `node-history` | 运行历史 | 节点执行记录与筛选 |
| `node-operations` | 节点操作 | 实时后端节点运行监控 |
| `scratch` | 草稿 | 临时文本缓冲区 |
| `counter` | 计数器 | 有状态整数追踪 |
| `terminal` | 终端 | 命令行接口 |
| `tasks` | 任务 | 线性目标追踪 |
| `kanban` | 看板 | 敏捷工作流可视化 |
| `database` | 数据库 | Notion 式元数据表 |
| `blocknote` | 富文本 | BlockNote 块级编辑器 |
| `music-player` | 音乐播放器 | 本地 FLAC 播放与主题 Dock 集成 |

### PackU 节点（40+ 独立包）

位于 `packages/nodes/*`，每个节点是独立的 workspace 包，包含核心运行时与前端 UI：

**媒体处理**：`enginev`（引擎视频）、`lorat`（LoRA 工具）、`audiov`（音频可视化）、`bitv`（比特率分析）

**文件整理**：`gifu`（GIF 处理）、`simiu`（文件去重）、`jellypot`（媒体整理）、`smartzip`（智能压缩）、`nameu`（批量重命名）、`coveru`（封面管理）、`timeu`（时间戳整理）、`classf`（分类器）、`classq`（分类查询）

**同步与转换**：`synct`（同步工具）、`transq`（转码队列）、`snf`（文件同步）

**系统工具**：`envuconfig`（环境配置）、`findz`（文件查找）、`formatv`（格式化）、`bandia`（Bandizip 集成）、`cleanf`（清理）、`crashu`（崩溃处理）、`dissolvef`（溶解）、`encodeb`（编码）、`kavvka`（Kavvka 集成）、`lata`（Lata 工具）、`linedup`（行处理）、`linku`（链接管理）、`marku`（标记）、`migratef`（迁移）、`movea`（移动）、`mvz`（MVZ 处理）、`owithu`（组织）、`rawfilter`（原始过滤）、`recycleu`（回收站）、`repacku`（重新打包）、`scoolp`（Scoolp 工具）、`seriex`（系列管理）、`sleept`（睡眠）、`trename`（树形重命名）

每个节点在 `src/nodes/<id>/` 下拥有专属工作台面（`Component.tsx`），提供区别于通用表单的定制化交互界面。

---

## 主题系统

Xiranite 拥有工程级主题系统，支持 16+ 内置预设与完全自定义。

### 武陵主题（Wuling Jade Industrial）

**武陵主题**是项目的标志性主题之一，设计灵感源自《明日方舟：终末地》武陵方向的玉绿工业美学。

**视觉特征**：
- **浅色模式**：冷灰实验室表面（`oklch(0.981 0.006 180)`）搭配玉绿主色（`oklch(0.72 0.13 173)`）
- **深色模式**：深岩板背景（`oklch(0.17 0.018 174)`）搭配荧光玉绿高亮
- **硬边阴影**：所有卡片采用 2px 偏移的硬朗投影，替代模糊阴影
- **技术面板**：节点内部表面使用细密网格背景与内嵌高光
- **字体搭配**：Hanken Grotesk 文本 + JetBrains Mono 数据标签

**交互细节**：
- 按钮悬停时产生内嵌 1px 高亮边框
- 表格行悬停以主色 8% 透明度叠加
- 奇偶行采用 `surface-stripe` 微条纹区分
- 进度条使用玉绿到浅绿的渐变指示器
- 面板进入时有 220ms 的模糊渐入动画（`wuling-panel-enter`）

### 主题配置能力

| 维度 | 选项 |
|------|------|
| 预设主题 | 16+ 内置（Spatial / Endfield / Wuling / Onlook / Tori / Conductor / Aperture / Vite 等） |
| 颜色模式 | 系统跟随 / 强制浅色 / 强制深色 |
| 背景模式 | 网格 / 点阵 / 自定义图片 / 无背景 |
| 大气效果 | 暗角强度、颗粒强度、动作光晕、卡片 elevation |
| 操作栏 | 左侧 / 右侧 / 悬浮岛三种位置，支持交通灯样式 |
| 自定义主题 | 支持导入 tweakcn / aestivus JSON 主题对象 |

---

## 开发与构建

### 常用命令

```bash
# 开发
bun run dev              # 完整开发模式（生成注册表 + 构建包 + 启动前后端）
bun run dev:vite         # 仅 Vite 前端（最快）
bun run dev:desktop      # 桌面端开发模式

# 构建
bun run build            # 生产构建（含类型检查与 chunk 审计）
bun run build:packages   # 构建所有 workspace 包
bun run build:backend:js # 构建后端 JS 产物（供 Wails 嵌入）
bun run wails:build      # 构建完整桌面可执行文件

# 质量保障
bun run typecheck        # TypeScript 类型检查（tsgo --noEmit）
bun run test:unit        # Vitest 单元测试
bun run lint             # OXLint 代码检查
bun run audit:node-architecture   # 节点架构审计
bun run audit:node-ui-quality     # 节点 UI 质量审计

# 节点管理
bun run generate:node-registries  # 重新生成节点注册表
bun run migrate:node-ui           # 迁移节点 UI 到应用侧
```

### 项目结构约定

- **前端 UI 优先放在 `src/nodes/<id>/`**：利用现有 shadcn 组件，减少 node package 依赖
- **Node package 聚焦核心**：每个 `packages/nodes/<id>` 保留运行时、CLI、核心逻辑
- **共享数据源**：相关功能共用数据层，避免维护多份状态
- **测试覆盖**：每个节点 `Component.tsx` 需配套 `Component.test.tsx`

---

## 国际化

Xiranite 内置中英双语支持：

- 界面语言通过 **设置 → Language** 切换
- 节点名称与描述通过 `module:<id>.name` 键值自动翻译
- 切换语言后建议刷新页面以确保所有动态内容同步

---

## 开源与致谢

Xiranite 的设计受到以下开源项目与作品的视觉启发：

- **Endfield**（终末地）— 工业面板与冷灰实验室美学
- **Onlook、Tori、Conductor** — 各主题预设的参考来源
- **shadcn/ui** — 组件基础
- **dockview** — 标签页布局引擎
- **gridstack** — 网格布局引擎
- **Wails** — 跨平台桌面框架

---

## License

[MIT](LICENSE)
