# Xiranite 节点 UI 长期重写计划

## 背景

当前节点 UI 的主要问题不是单个组件不好看，而是架构层把 UI 能力压得太窄：

- 节点包内的 `Component.tsx` 为了保持独立发布，只能使用很薄的 UI primitive。
- `@xiranite/ui` 抽象层能力不足，导致复杂交互只能退化成输入框、按钮组、简单日志。
- 小宽度和大宽度没有不同信息架构：小卡片只是被压窄，大卡片只是被拉宽。
- 节点内部经常把所有选项横向排开，用户看不到功能层级、说明、风险和推荐路径。
- 动画、状态过渡、折叠态信息、运行态反馈都偏弱，导致卡片没有“活着”的感觉。

因此后续目标不是“把旧 UI 美化一下”，而是重建一套更适合 Xiranite 的节点体验。


## 总体方向

采用 **headless 节点包  主应用拥有 UI** 的架构。

```text
packages/nodes/<id>/
  src/
    def.ts
    core.ts
    platform.ts
    cli.ts
    index.ts

src/nodes/<id>/
  Component.tsx
  entry.ts
  ui/
    *.tsx
```

节点包只负责：

- `def.ts`：节点元信息。
- `core.ts`：纯逻辑、规划、校验、状态归约。
- `platform.ts`：Node/Bun 文件系统、shell、网络等能力。
- `cli.ts`：独立命令行。
- `index.ts`：导出 `def`、`core`，不导出 React 组件。

主应用负责：

- `Component.tsx`：完整节点 UI。
- shadcn、Dice UI、Base UI、Radix、Vaul、dnd-kit、Gridstack 等交互组件。
- 节点在卡片、泳道、白板、便当、浮窗、Dock 中的自适应表现。
- 动画、折叠态、运行态、错误态、空态、配置态。

## 核心原则

### 1. 节点包零 React 依赖

节点包必须可以作为独立 npm CLI 包安装：

```bash
npm i -g @xiranite/node-repacku
xrepacku
```

节点包不依赖：

- `react`
- `react-dom`
- `lucide-react`
- `@xiranite/ui`
- shadcn
- Xiranite 主应用路径

### 2. 主应用 UI 不再受节点包限制

主应用节点 UI 可以直接使用：

- `@/components/ui/*`
- shadcn 组件
- Dice UI 组件
- Base UI / Radix primitives
- Vaul drawer
- dnd-kit
- Gridstack
- react-resizable-panels
- sonner
- Recharts
- BlockNote

这能让节点 UI 按真实功能设计，而不是被“最小公共 UI 包”拖住。

### 3. Component 是主应用体验，不是节点包公共 API

节点包公共 API 应该是：

```ts
export { def } from "./def"
export * as core from "./core"
```

主应用组装：

```ts
import { def, core } from "@xiranite/node-repacku"
import { Component } from "./Component"

export default {
  def,
  core,
  Component,
}
```

### 4. UI 不承担原生能力

即使 Component 放在主应用里，也不能直接做文件系统、shell、注册表等原生操作。

正确路径：

```text
Component
  -> host.actions.run / backend RPC
  -> node platform
  -> node core
```

Component 只负责输入、预览、交互、展示和状态编排。

### 5. 组件化是默认原则

节点 UI 不允许长期堆在一个巨型 `Component.tsx` 里。

- 单文件建议不超过 800 行，硬上限 1000 行。
- `Component.tsx` 只负责状态编排和主布局。
- 表单控件、结果预览、目录树、日志、统计、运行状态等都应该拆成本节点内的局部组件。
- 可复用的跨节点组件再上移到 `src/nodes/shared/` 或主应用 UI 层。
- 不为“拆而拆”，但一旦某块 UI 有独立职责、独立测试价值或未来会复用，就应该拆出去。

推荐结构：

```text
src/nodes/<id>/
  Component.tsx
  entry.ts
  types.ts
  constants.ts
  controls.tsx
  ResultPreview.tsx
  FileTreePreview.tsx
```

### 6. 可视化组件优先，禁止把结构化数据退化成纯文本

节点 UI 的目标是提高可视化程度。目录树、文件列表、表格、时间线、画廊、关系图、运行步骤等结构化数据，应优先使用成熟组件呈现。

查找顺序：

1. 项目已安装的 shadcn 组件。
2. shadcn registry。
3. Dice UI registry。
4. Magic UI registry。
5. Aceternity、React Bits 等 shadcn-like 组件源。
6. 最后才写本地小组件。

例如目录树应优先使用 `@magicui/file-tree` 这类现成组件，而不是手写 `pre` 文本树。只有在没有合适组件，或现成组件无法满足功能时，才允许自写。

### 7. 不给每个节点默认加配置侧栏

配置不是每张卡片都必须有的侧栏。尤其在折叠态和极小卡片里，用户主要需要看状态、快速启动、快速判断结果，而不是调整完整配置。

- 常用参数应在卡片内容中按空间自适应展示。
- 低频参数优先用内联折叠区、Popover 或局部 Disclosure。
- Sheet/Dialog 只用于确实需要聚焦处理的复杂流程或危险确认。
- 不要为了“功能可达”给每个节点额外挂一个侧栏，这会增加维护成本，也会破坏卡片的轻量感。

## 目标体验

### 1. 灵动岛式卡片状态

每个节点至少要有三种展示层级。

#### 折叠态
参考苹果灵动岛。

用于极小卡片、泳道压缩、Dock、运行中后台状态 其他卡片聚焦时。

要求：

- 显示节点图标、核心状态、一条关键信息。
- 应保留关键信息密度，例如当前模式、路径摘要、运行进度或上次结果摘要。
- 有动态背景或轻量动效，但不能影响性能。
- 可表达运行中、成功、失败、等待输入、需要配置等状态。
- 不展示完整表单，不把内容硬塞进去。

示例：

```text
Repacku
正在压缩 18 / 42
```

#### 紧凑态

用于普通卡片宽度。

要求：

- 展示最常用路径。
- 常用参数在卡片内可见或可滚动访问。
- 次要选项优先折叠到 Popover 或 Disclosure，不默认打开侧栏。
- 运行日志和结果有清晰层级。
- 不出现一排十几个按钮。

#### 展开态

用于大卡片、浮窗、便当大格子。

要求：

- 可以展示完整配置、预览、历史、日志、结果。
- 大宽度不是简单拉伸，而是切换为多区域布局。
- 重要区域可以并排：输入 / 选项 / 预览 / 日志。

### 2. 响应式不是 CSS 压缩，而是信息架构切换

每个节点 UI 应按容器尺寸进入不同布局：

```text
width < 280      -> collapsed
280 - 520        -> compact
520 - 860        -> regular
860             -> expanded
floating window  -> workspace
```

建议建立统一 hook：

```ts
useNodeSurface()
```

返回：

```ts
{
  mode: "collapsed" | "compact" | "regular" | "expanded" | "workspace",
  width,
  height,
  density,
}
```

节点 Component 不再自己猜卡片大小。

实现策略：

- 优先使用 CSS Container Queries 做布局自适应，例如 `@container/repacku` 和 `@4xl/repacku:grid-cols-2`。
- JS hook 只负责粗粒度模式和极端状态判断，不维护多套重复参数。
- 同一组字段应该只有一份数据源和一套控件组件，不在不同形态里复制三份表单逻辑。

### 3. 最大高度下应尽量减少关键内容滚动

当节点卡片、浮窗或便当格子已经获得接近整屏的最大可用高度时，UI 不应该继续把核心操作和关键配置藏在滚动区深处。用户容易因为看不到而忘记参数、风险开关或下一步操作。

要求：

- 展开态、workspace 态、浮窗态应优先让核心任务流一屏可见：输入、模式、启动/取消、常用参数、风险开关、当前状态。
- 可以滚动的内容应主要限于天然长内容：文件列表、目录树、运行日志、历史记录、大批量结果、错误明细。
- 如果内容超出一屏，先重新组织信息架构，例如顶部工具栏、左右分栏、固定操作区、局部滚动面板，而不是让整个节点主体长滚动。
- 危险开关、执行按钮、当前进度和错误状态不应被长日志或大列表挤到不可见区域。
- 视觉验收时要检查最大尺寸/满屏形态，确认常用流程不需要频繁滚动才能完成。

### 4. 节点 UI 应该有清晰任务流

每个节点都要根据功能设计自己的流程，而不是套通用模板。

例如：

- `repacku`：选择模式 -> 扫描路径 -> 预估任务 -> 执行 -> 结果归档。
- `recycleu`：确认风险 -> 倒计时 -> 执行 -> 系统回收站状态。
- `enginev`：选择 Wallpaper Engine 根目录 -> 扫描 -> 画廊预览 -> 筛选/打开/复制路径。
- `linku`：读取配置 -> 显示已有链接 -> 添加/校验/打开。
- `trename`：输入路径 -> 预览重命名计划 -> 执行 -> undo。

## UI 技术栈策略

可用网站列表。 最好每个都能用上
https://motion.net.cn/docs/react-quick-start 
https://diceui.com/
https://www.remotion.dev/
https://ui.aceternity.com/
https://www.reactbits.dev/get-started/index
https://r3f.docs.pmnd.rs/getting-started/introduction
https://magicui.design/docs/components

遇到某类组件缺失时，不要只查 shadcn 官方。必须继续查 Dice UI、Magic UI、Aceternity、React Bits 等 shadcn-like 组件库。

### 首选：主应用 shadcn

shadcn 负责常规 UI：

- Button
- Dialog
- Sheet
- Popover
- Select
- Command
- Tooltip
- Tabs
- Form
- Dropdown Menu
- Scroll Area
- Accordion

### 积极引入 Dice UI

Dice UI 适合补充更复杂、更现代的交互组件。

引入原则：

- 优先用于 Combobox、Tags Input、Kbd、Sortable、Date/Time、Color、高级 Select 等复杂组件。
- 只在主应用引入，不进入节点包。
- 每次引入要有实际节点使用场景，不为“组件收藏”堆依赖。

### 动画层

优先使用已有栈和轻量方案：

- Tailwind transition / animation：基础 hover、展开、淡入。
- `tw-animate-css`：通用进入/退出动效。
- View Transition API：视图切换和卡片形态变化的长期方向。
- 如现有能力不足，再评估 `motion` / `framer-motion`。

动画原则：

- 状态变化有过渡。
- 运行态有生命感。
- 错误态清晰但不刺眼。
- 不为装饰牺牲性能。
- 列表大量节点时禁用重动画或降级。

## 架构改造阶段

### Phase 0：定稿契约

目标：先把边界定住，避免边做边返工。

任务：

- 修改 `@xiranite/contract`，拆分纯节点包契约和主应用节点契约。
- 定义 `HeadlessNodePackage`：

```ts
interface HeadlessNodePackage<TCore> {
  def: NodeDef
  core: TCore
}
```

- 定义主应用侧 `AppNodeEntry`：

```ts
interface AppNodeEntry<TCore> {
  def: NodeDef
  core: TCore
  Component: ComponentType<NodeComponentProps>
}
```

- `NodeComponentProps` 保留在主应用或 contract 的 app 子路径中，不污染节点包默认入口。
- 更新架构验证脚本：节点包默认入口不得导出 React Component。

验收：

- 节点包默认入口不再需要 React 类型。
- CLI 构建不安装 React。
- backend runner 不会 import Component。

### Phase 1：建立主应用节点 UI 目录

目标：让主应用开始拥有节点 UI。

建议结构：

```text
src/nodes/
  repacku/
    Component.tsx
    entry.ts
    parts/
      RepackuCollapsed.tsx
      RepackuCompact.tsx
      RepackuExpanded.tsx
  registry.ts
```

任务：

- 增加 `src/nodes/<id>/entry.ts`。
- 生成器改为组合 app entry。
- `packages/nodes/<id>/src/Component.tsx` 暂时保留但标记 deprecated，逐步迁出。
- 每迁移一个节点，删除节点包 React 依赖。

验收：

- 至少迁移 `repacku`、`recycleu`、`enginev` 三个差异最大的节点。
- 主应用能正常渲染。
- CLI 包构建不受影响。

### Phase 2：建立 Node Surface 系统

目标：解决小宽度/大宽度体验完全不同的问题。

任务：

- 实现 `useNodeSurface()`。
- 建立 `NodeSurfaceProvider`，给每个卡片提供容器尺寸、视图类型、是否浮窗、是否折叠。
- 所有节点组件通过 surface mode 切换 UI，而不是用固定 `min-h` 或固定 grid。
- 给卡片壳提供统一折叠态入口，但折叠内容由节点自己定义。

验收：

- 小卡片不再硬压完整表单。
- 大卡片不再只是拉宽。
- 便当、卡片、泳道、浮窗都能得到正确 mode。

### Phase 3：重写高优先级节点 UI

优先迁移体验问题最明显、最常用、最能验证新架构的节点。

建议顺序：

1. `repacku`
2. `enginev`
3. `recycleu`
4. `bandia`
5. `trename`
6. `linku`
7. `marku / migratef / dissolvef`

每个节点都要交付：

- 折叠态
- 紧凑态
- 展开态
- 运行态
- 错误态
- 空态
- 配置入口
- 真实 Playwright 交互测试

验收：

- 每个节点用真实路径或 mock backend 跑通。
- 节点运行日志、进度、结果能更新。
- 卡片尺寸变化时 UI 不重叠、不挤压、不丢功能。

### Phase 4：动画和反馈系统

目标：让节点像“活的工具”，而不是静态表单。

任务：

- 定义节点状态动画规范。
- 增加运行态背景层：进度流光、轻量噪声、状态色。
- 增加折叠/展开形态过渡。
- 增加成功/失败/result reveal 动画。
- 对大量节点场景做性能降级。

验收：

- 动画不阻塞输入。
- 低性能模式可关闭。
- Playwright 截图验证无遮挡、无闪烁黑块、无文本溢出。

### Phase 5：删除或降级 `@xiranite/ui`

目标：避免继续维护一个夹在中间的简陋 UI 系统。

可选结果：

1. 完全删除 `@xiranite/ui`。
2. 只保留非视觉工具，例如 class helper、layout token。
3. 改名为内部 app UI，不再给节点包消费。

验收：

- 节点包不依赖 `@xiranite/ui`。
- 主应用 UI 统一走 shadcn / Dice UI / app components。
- 架构验证脚本能阻止节点包重新引入 React/UI。

## 每个节点 UI 的设计模板

迁移每个节点前，必须先写一个小设计说明：

```text
节点：
核心任务：
最常用路径：
危险操作：
需要预览的数据：
运行中用户最关心的信息：
成功后用户下一步：
失败时用户需要什么帮助：
折叠态显示：
紧凑态显示：
展开态显示：
需要的 shadcn/Dice UI 组件：
需要的测试路径：
```

这能避免所有节点再次套同一个模板。

## 测试策略

### 单元测试

节点包：

- `core.ts` 纯逻辑测试。
- `platform.ts` 使用临时目录测试，不污染 Git。
- `cli.ts` 测无参 guided 入口和显式命令入口。

主应用：

- React Testing Library 测组件状态。
- happy-dom 测基础交互。
- MSW mock backend。

### 真实交互测试

Playwright 用于：

- 拖入节点。
- 切换视图。
- 调整卡片大小。
- 折叠/展开。
- 启动节点。
- 查看进度和日志。
- 验证真实本地图片显示。

### 视觉验收

每个重写节点至少验证：

- 320px 宽
- 480px 宽
- 720px 宽
- 1000px 宽
- 浮窗
- 便当视图
- 暗色/亮色

## 风险和约束

### 风险：主应用 UI 和节点包 def/core 不同步

应对：

- 每个 app entry 必须 import 节点包的 `def` 和 `core`。
- 不允许在主应用重复定义节点 id/name/version。

### 风险：第三方节点无法自带 UI

短期接受。

长期可提供可选子路径：

```json
"exports": {
  ".": "./dist/index.js",
  "./core": "./dist/core.js",
  "./platform": "./dist/platform.js",
  "./cli": "./dist/cli.js",
  "./react": "./dist/react.js"
}
```

但默认仍是 headless。

### 风险：主应用 UI 变重

应对：

- 节点 UI 按路由/registry 懒加载。
- 高级组件只在需要的节点里 import。
- 动画和图表按需加载。

### 风险：过度追求动效导致工具效率下降

应对：

- 工具效率优先。
- 动画只服务状态理解和操作反馈。
- 设置中提供低动效模式。

## 推荐优先级

### P0

- 契约拆分：headless node package / app node entry。
- 新建 `src/nodes/` 主应用节点 UI 层。
- 建立 `useNodeSurface()`。
- 迁移 `repacku` 作为样板。

### P1

- 迁移 `enginev`、`recycleu`、`bandia`。
- 建立折叠态规范和运行态背景。
- 引入 Dice UI 的第一批实际组件。

### P2

- 迁移剩余高频节点。
- 删除节点包 React 依赖。
- 删除或降级 `@xiranite/ui`。

### P3

- 视觉回归测试。
- 低动效模式。
- 第三方节点可选 React UI 子路径。

## 最终目标

Xiranite 节点应该变成：

- CLI 独立、轻量、可发布。
- core 纯逻辑，可测试，可复用。
- platform 明确承载本地能力。
- 主应用 UI 精致、响应式、动画自然。
- 卡片不是被压扁的表单，而是能根据空间变化的信息体。
- 桌面、Web、未来其他壳都只消费同一套 Local Service 和 headless node packages。
