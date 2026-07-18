# Xiranite context menu optimization plan

> 给实现 AI：这份文档用于改造当前右键菜单。目标不是重写整套交互，而是在保留现有 `data-context-menu` 全局注册机制的前提下，参考 shadcn/Radix Context Menu，把菜单渲染、菜单能力、默认功能和测试补齐。

## 参考资料

- shadcn context menu docs: https://ui.shadcn.com/docs/components/radix/context-menu
- shadcn example: https://ui.shadcn.com/code/apps/v4/registry/bases/radix/examples/context-menu-example.tsx
- Radix Context Menu API: https://www.radix-ui.com/docs/primitives/components/context-menu.md

已在项目根目录运行：

```powershell
bunx --bun shadcn@latest docs context-menu
```

输出显示当前项目应使用 `radix/context-menu` 文档，而不是强行使用 Base 版本。原因：当前项目已有 shadcn 组件均基于 Radix primitive，例如 `src/components/ui/dropdown-menu.tsx` 从 `radix-ui` 导入 primitive。

## 当前实现

相关文件：

- `src/App.tsx`：包裹 `ContextMenuProvider`
- `src/components/context-menu/ContextMenuProvider.tsx`
- `src/components/context-menu/defaults.tsx`
- `src/components/context-menu/ContextMenuProvider.test.tsx`
- `src/components/workspace/WorkspaceLayout.tsx`
- `src/components/workspace/ComponentCard.tsx`
- `src/i18n/locales/en.json`
- `src/i18n/locales/zh.json`

当前做法：

- `ContextMenuProvider` 监听全局 `window.contextmenu`。
- 从事件 `composedPath()` 中扫描 `data-context-menu` scope。
- 通过 `useContextMenuBuilder(scope, builder)` 注册菜单构建函数。
- 最终用 `DropdownMenu` + 一个固定在鼠标坐标处的 1x1 invisible anchor 模拟右键菜单。
- 已支持 `item`、`separator`、`label`、`checkbox`、`radio`、submenu、shortcut、destructive。

当前不足：

- 文件叫 ContextMenu，但渲染层实际是 DropdownMenu，语义和可访问性都不够直接。
- 默认菜单功能少，且 `openWindow`、`duplicate` 还是禁用 stub。
- 默认组件菜单同时显示 `fullscreen` 和 `exitFullscreen`，没有根据当前状态裁剪。
- `ContextMenuItemDef` 缺少 `id`、`hidden`、`group`、`keepOpen`、`confirm`、`testId` 等实际会用到的字段。
- radio 分组渲染方式会为每个 radio item 创建一个 `DropdownMenuRadioGroup`，应改为按组聚合一次。
- icon 渲染里有 `className="mr-2 size-4"`，和 shadcn 项目规则不一致；项目组件 CSS 已会处理菜单内 svg 尺寸。
- editable target 只判断 `INPUT` / `TEXTAREA` / `contentEditable`，应补 `SELECT` 和 `[role="textbox"]`。

## 目标

1. 安装并使用 shadcn `context-menu` 组件。
2. 保留现有全局 builder 注册机制，避免每个目标都手动包一层菜单。
3. 支持更多菜单项类型和行为：
   - group
   - submenu
   - checkbox
   - radio group
   - shortcut
   - destructive
   - disabled / hidden
   - keep open after select
   - confirm before destructive action
4. 补齐组件卡片、工作区空白区域、泳道、Dock/Flow/Bento 视图的默认菜单。
5. 补测试，覆盖菜单打开、禁用、子菜单、checkbox、radio、editable native menu、状态化菜单裁剪。

## 安装 shadcn Context Menu

当前项目没有 `src/components/ui/context-menu.tsx`。

运行：

```powershell
bunx --bun shadcn@latest add context-menu
```

安装后必须检查新增文件：

- `src/components/ui/context-menu.tsx`

要求：

- 保持项目现有 `new-york` 风格和 Tailwind v4 写法。
- 不要顺手改 `dropdown-menu.tsx`。
- 不要把图标库整体迁移。虽然 `components.json` 写着 `iconLibrary: "radix"`，但项目实际已广泛使用 `lucide-react`，本次菜单功能继续沿用现状。

## 渲染层改造

### 推荐方案

保留 `ContextMenuProvider` 的全局 scope builder 模式，但把菜单 primitive 从 `DropdownMenu*` 换为 `ContextMenu*`：

```ts
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuCheckboxItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuShortcut,
} from "@/components/ui/context-menu"
```

注意：Radix Context Menu 的标准模型是 `ContextMenuTrigger` 包裹右键目标。当前 Xiranite 是全局事件扫描 + 程序化显示。实现者需要先验证 `ContextMenu` controlled open + fixed anchor 是否能稳定按鼠标坐标定位。

如果可以：

- `MenuController` 保留 invisible anchor。
- 把 `DropdownMenu` 系列替换为 `ContextMenu` 系列。
- `ContextMenuContent` 使用 `className="min-w-48"`，并保留 `onCloseAutoFocus={(e) => e.preventDefault()}`。

如果不可以：

- 保留当前 `DropdownMenu` controlled anchor 作为内部定位 fallback。
- 仍然安装 `context-menu.tsx`，并新增 `ScopedContextMenu` 组件，用于后续局部迁移。
- 文档/代码注释中明确：全局菜单因需要程序化坐标定位暂用 DropdownMenu renderer，局部菜单使用 shadcn ContextMenu。

不要为了“纯 ContextMenu”破坏全局 builder 机制。

### 更稳的长期方案

把 `ContextMenuProvider` 改为包裹应用内容：

```tsx
<ContextMenu>
  <ContextMenuTrigger asChild>
    <div onContextMenuCapture={collectItemsFromEvent}>{children}</div>
  </ContextMenuTrigger>
  <ContextMenuContent>
    <MenuItems items={items} />
  </ContextMenuContent>
</ContextMenu>
```

但要注意：如果 wrapper trigger 会拦截所有右键，必须保证 editable target 继续走浏览器原生菜单。这一点需要实际浏览器 QA，不能只靠 happy-dom 测试判断。

## `ContextMenuItemDef` 扩展

把类型扩展为更稳定的菜单描述协议：

```ts
export type ContextMenuItemType =
  | "item"
  | "separator"
  | "label"
  | "group"
  | "checkbox"
  | "radio"
  | "submenu"

export interface ContextMenuItemDef {
  id?: string
  type?: ContextMenuItemType
  label?: string
  icon?: ReactNode
  shortcut?: string
  disabled?: boolean
  hidden?: boolean
  destructive?: boolean
  inset?: boolean
  testId?: string
  keepOpen?: boolean
  confirm?: {
    title: string
    description?: string
    confirmLabel?: string
    cancelLabel?: string
    destructive?: boolean
  }
  onSelect?: () => void | Promise<void>
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void | Promise<void>
  value?: string
  radioGroup?: string
  radioValue?: string
  onRadioChange?: (value: string) => void | Promise<void>
  children?: ContextMenuItemDef[]
}
```

渲染规则：

- `hidden` 的项不渲染。
- 连续 separator 合并，开头/结尾 separator 删除。
- `group` 渲染为 `ContextMenuGroup`，children 内部递归。
- `submenu` 或有 children 的 item 渲染为 `ContextMenuSub`。
- checkbox 使用 `onCheckedChange`，不要只靠 `onSelect`。
- radio 先按 `radioGroup` 聚合，再渲染一个 `ContextMenuRadioGroup` 包住多个 `ContextMenuRadioItem`。
- `keepOpen` 为 true 时，`onSelect` 后不要关闭菜单。
- `confirm` 存在时，点击后打开 `AlertDialog`，确认后再执行 `onSelect`。

## 默认菜单功能清单

### 组件卡片菜单 `component-card`

目标文件：`src/components/context-menu/defaults.tsx`

当前 `ComponentCard` 已提供：

```tsx
data-context-menu="component-card"
data-component-id={comp.id}
```

建议 `defaults.tsx` 通过 `getWorkspaceState()` 查组件和当前 view 状态，不要只依赖 `actions`。这样可以让菜单根据状态裁剪。

建议菜单：

```text
组件名 / 模块 id label
Focus / Exit Focus
Fullscreen / Exit Fullscreen
Collapse / Expand
Open in Floating Window
Raise to Front
Duplicate
Visibility
  Show/Hide in Cards
  Show/Hide in Dockview
  Show/Hide in Flow
  Show/Hide in Lane
  Show/Hide in Bento
Layout
  Grid
  Focus
  Masonry / Compact if supported
Copy
  Copy Component ID
  Copy Module ID
  Copy Data JSON
Reset
  Clear Component Data
  Reset Position
Delete
```

实现细节：

- `Open in Floating Window` 不应再是 disabled stub。可复用 `useWindowControls().openComponent()`，但 builder 需要查到 `moduleId` 和标题。
- `Duplicate` 需要新增 store action，见下方。
- `Delete` 应使用 `confirm` 或 `AlertDialog`，不要误触即删。
- `Clear Component Data` 也应 confirm。
- `Fullscreen` 和 `Exit Fullscreen` 只显示其中一个。
- `Focus` 和 `Exit Focus` 只显示其中一个。
- `Collapse` 和 `Expand` 只显示其中一个。

### 工作区空白菜单 `workspace-canvas`

给主画布容器加：

```tsx
data-context-menu="workspace-canvas"
```

建议菜单：

```text
Add Node
  最近使用的节点
  按 category 分组的节点
View Mode
  Cards
  Dockview
  Flow
  Lane
  Bento
Card Layout
  Grid
  Focus
Appearance
  Background: Grid / Dot Grid / Image / None
  Card Elevation
  Action Glow
Workspace
  New Workspace
  Rename Workspace
  Copy Workspace ID
```

实现细节：

- `Add Node` 可从 `getModule` / registry 列表生成。
- `View Mode` 用 radio group。
- `Card Layout` 用 radio group，仅在 cards view 或可用时显示。
- 背景和开关用 checkbox/radio。

### 泳道菜单 `lane`

目标文件：

- `src/components/workspace/lane/Lane.tsx`
- `src/components/workspace/lane/LaneView.tsx`

给 lane root 加：

```tsx
data-context-menu="lane"
data-lane-id={lane.id}
```

建议菜单：

```text
Add Component to Lane
Rename Lane
Collapse / Expand Lane
Hide Lane
Move Lane Left / Right
Delete Lane
Copy Lane ID
```

`Delete Lane` 必须 confirm。

### Dock/Flow/Bento 特化菜单

按需给相关节点容器补 scope：

- `dock-tab`
- `flow-node`
- `bento-cell`

建议功能：

- Dock tab: Close from Dockview, Move to Floating Window, Reveal in Cards, Copy Component ID。
- Flow node: Bring to Front, Reset Flow Size, Hide from Flow, Copy Component ID。
- Bento cell: Reset Bento Layout, Hide from Bento, Copy Component ID。

这些菜单应复用组件卡片菜单的公共 builder helper，避免各视图行为分叉。

## Store action 补齐

### Duplicate component

目标文件：

- `src/store/workspace/types.ts`
- `src/store/workspace/componentSlice.ts`

新增 action：

```ts
duplicateComponent(id: string): void
```

行为：

- 找到原组件。
- 新 id 用现有 `nextComponentCounter()`。
- `moduleId`、`data`、`tags`、`size`、`flowSize`、`bentoLayout` 可复制。
- `position` / `flowPosition` 偏移 24px，避免完全重叠。
- `z` 提升到最前。
- `createdAt` / `updatedAt` 写当前时间。
- lane 中复制时插到原卡片之后。
- 不复制 `state: "fullscreen"`，新组件默认 `docked`。
- 不复制 `collapsed`，建议默认 false，或者与原组件一致，二选一并测试。

### Clear data

可复用现有：

```ts
setComponentData(id, {})
```

不用新增 action，菜单中直接调用。

### Reset position

可复用：

```ts
setComponentPosition(id, 20, 20)
setComponentFlowPos(id, 100, 100)
```

更好做法是新增：

```ts
resetComponentLayout(id: string, viewMode?: ViewMode): void
```

但这不是第一阶段必须。

## i18n keys

扩展 `src/i18n/locales/en.json` 和 `src/i18n/locales/zh.json` 的 `contextMenu`：

```json
{
  "labelComponent": "{{name}}",
  "exitFocus": "Exit Focus",
  "collapse": "Collapse",
  "raise": "Bring to Front",
  "visibility": "Visibility",
  "layout": "Layout",
  "copy": "Copy",
  "copyComponentId": "Copy Component ID",
  "copyModuleId": "Copy Module ID",
  "copyDataJson": "Copy Data JSON",
  "clearData": "Clear Data",
  "resetPosition": "Reset Position",
  "deleteConfirmTitle": "Delete component?",
  "deleteConfirmDescription": "This removes the component from the workspace.",
  "workspace": "Workspace",
  "addNode": "Add Node",
  "viewMode": "View Mode",
  "appearance": "Appearance",
  "newWorkspace": "New Workspace",
  "renameWorkspace": "Rename Workspace",
  "copyWorkspaceId": "Copy Workspace ID",
  "lane": "Lane",
  "renameLane": "Rename Lane",
  "deleteLane": "Delete Lane"
}
```

中文自行补齐。不要把显示文本硬编码在 builder 里。

## Clipboard and toast

复制类菜单建议使用：

- `navigator.clipboard.writeText(...)`
- `toast(...)` from `sonner`

项目已有 `src/components/ui/sonner.tsx`，优先用现有 toast 体系。

复制失败时：

- 不要 throw 到 React。
- toast 显示失败原因。

## Accessibility and UX

必须满足：

- editable elements 保留原生右键菜单：`input`、`textarea`、`select`、`contenteditable`、`[role="textbox"]`。
- 菜单项可键盘导航。
- destructive item 使用 destructive variant。
- shortcut 用 `ContextMenuShortcut`，不要手写右侧 `span`。
- icon 不要手写 `mr-2 size-4`，让 shadcn 菜单 CSS 处理 svg 尺寸；必要时只用 `data-icon` 或 wrapper gap。
- 不要手动写 z-index，shadcn overlay 已处理。
- `ContextMenuContent` 最小宽度建议 `min-w-48`，不要让长中文截断得太窄。
- 菜单内容多时自动滚动，保留 shadcn content 的 `max-h` 样式。

## 测试计划

更新 `src/components/context-menu/ContextMenuProvider.test.tsx`：

1. 右键 registered target 后显示 label/item/shortcut。
2. 点击普通 item 后调用 handler 并关闭菜单。
3. disabled item 不调用 handler。
4. `hidden` item 不渲染。
5. 连续 separator 被规整。
6. checkbox item 调用 `onCheckedChange`。
7. radio group 只渲染一个 group，切换调用 `onRadioChange`。
8. submenu 可以渲染 children。
9. editable target 不打开自定义菜单。
10. destructive confirm：点 Delete 先弹 AlertDialog，确认后才执行。

新增或更新 defaults 测试：

- fullscreen 状态只显示 `exitFullscreen`。
- focused 状态只显示 `exitFocus`。
- collapsed 状态只显示 `expand`。
- `openWindow` 不再 disabled。
- `duplicate` 调用 store action。

## 验证命令

```powershell
bunx --bun shadcn@latest add context-menu --dry-run
bunx --bun shadcn@latest add context-menu
bun run typecheck
bun run test:unit -- src/components/context-menu/ContextMenuProvider.test.tsx
bun run test:unit
bun run build
```

如 UI 改动较大，启动开发环境并做浏览器 QA：

```powershell
bun run dev
```

手动 QA：

- 在组件卡片上右键。
- 在卡片内部 input/textarea 上右键，确认浏览器原生菜单仍出现。
- 在空白工作区右键。
- 在 fullscreen/focus/collapsed 状态下右键，确认菜单项裁剪正确。
- 测试子菜单、checkbox、radio、Delete confirm。

## 分阶段交付

### Phase 1

- 安装 `context-menu`。
- 清理 `ContextMenuItemDef` 和 `MenuItems` 渲染逻辑。
- 修复 editable target 判断。
- 修复 radio group 聚合。
- 保留现有默认功能，但状态化显示 fullscreen/focus/collapse。
- 补 ContextMenuProvider 测试。

### Phase 2

- 补 `duplicateComponent` store action。
- 让 `openWindow` 真正可用。
- 增加 copy component id/module id/data JSON。
- Delete 和 Clear Data 加 confirm。
- 补 defaults 测试。

### Phase 3

- 增加 `workspace-canvas` 菜单。
- 增加 lane/dock/flow/bento 特化菜单。
- 将公共组件动作抽到 helper，避免每个视图重复。

## 不要做

- 不要把全局 builder 机制删掉。
- 不要在第一阶段引入大型 command palette 或全新状态管理。
- 不要把右键菜单做成普通 DropdownMenu 触发按钮。
- 不要硬编码中英文文案。
- 不要在本次改造里顺手迁移整个图标库。
- 不要破坏 input/textarea/select 的原生右键菜单。
