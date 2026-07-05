# Spatial Canvas 项目架构上下文（给模型接手用）

## 1. 项目目标
Spatial Canvas 是一个前端交互式工作台应用，核心是“同一组面板在多种布局模式间切换且状态不丢失”。

核心体验：
- 面板可在 free、grid、stack、split、focus 之间切换
- 组件实例不重建，内部状态持续保留
- 支持多 tab 空间（spaces），每个 tab 保留独立布局与面板集

---

## 2. 当前运行模式（重要）
当前项目已按传统 Vite SPA 运行：
- 开发：pnpm run dev
- 构建：pnpm run build
- 预览：pnpm run preview
- 产物目录：dist

入口链路：
1) index.html
2) src/main.tsx
3) src/router.tsx
4) src/routeTree.gen.ts（由插件生成）
5) src/routes/__root.tsx
6) src/routes/index.tsx

---

## 3. 技术栈
- React 19
- TypeScript
- Vite 8
- TanStack Router（文件路由）
- TanStack Query（在根路由注入 QueryClient）
- Tailwind CSS 4
- motion/react（动画与拖拽）

Vite 插件：
- @tanstack/router-plugin/vite
- vite-tsconfig-paths
- @vitejs/plugin-react
- @tailwindcss/vite

---

## 4. 目录结构（架构视角）

src/
- main.tsx：浏览器入口，挂载 RouterProvider
- router.tsx：创建 router + queryClient 上下文
- routeTree.gen.ts：路由自动生成文件（不要手改）
- routes/
  - __root.tsx：根路由，错误页、404、QueryClientProvider
  - index.tsx：首页路由，注入 ThemeProvider + WorkspaceProvider
- workspace/
  - Workspace.tsx：主工作台容器（顶部栏、布局模式切换、画布、弹层）
  - store.tsx：全局状态（tabs + panels + mode + focus + fullscreen）
  - layout.ts：纯函数布局引擎 computeLayout
  - Panel.tsx：单面板外壳，拖拽、窗口控制、动画
  - components.tsx：业务示例组件集合（Notes、Kanban 等）
  - registry.tsx：组件注册表（kind -> title/glyph/render）
  - CommandPalette.tsx：命令面板（插入、切布局、切 tab、切主题）
  - TabBar.tsx：tab 管理（新建、切换、重命名、关闭）
  - theme.tsx、ThemeMenu.tsx：主题状态与 UI

---

## 5. 状态模型
状态定义在 src/workspace/store.tsx。

顶层是 AppState：
- tabs: Tab[]
- activeTabId: string

Tab 包含：
- panels: Panel[]
- mode: LayoutMode
- focusedId: string | null
- fullscreenId: string | null
- zCounter: number

Panel 包含：
- id
- kind
- title
- collapsed
- free: {x,y,w,h}
- z

关键思想：
- 所有面板操作只作用于当前 active tab
- 切 tab 不会重置其他 tab 的状态
- zCounter 单调增长用于层级管理

---

## 6. 布局引擎
核心函数：src/workspace/layout.ts 的 computeLayout。

输入：
- panels
- mode
- focusedId
- fullscreenId
- 画布宽高 W/H

输出：
- 每个 panel 的 ComputedLayout（x/y/w/h/scale/opacity/z/state/interactive）

规则优先级：
1) fullscreen 优先于所有模式
2) free 使用 panel.free 坐标并支持焦点弱化
3) grid 自动网格分布
4) stack 级联卡片
5) split 双列纵向切分
6) focus 主面板 + 右侧缩略条

这个文件是布局行为调整的第一入口。

---

## 7. 面板渲染与状态保活
核心在 src/workspace/Panel.tsx。

保活策略：
- 面板组件始终挂载
- 布局切换只更新容器几何与视觉状态
- 不通过条件渲染销毁组件

结果：
- Notes 文本、Counter 数值、Kanban 卡片等内部状态在布局切换后仍保留

窗口控制：
- collapse
- focus
- fullscreen
- close
- free 模式支持拖拽并回写坐标

---

## 8. 组件注册机制
src/workspace/registry.tsx 维护 REGISTRY：
- kind
- title
- glyph
- render

新增组件最短路径：
1) 在 src/workspace/components.tsx 新增组件
2) 在 registry.tsx 增加一个 kind 映射
3) 如需默认出现，可在 src/routes/index.tsx 的 seed 中添加

---

## 9. 命令系统
src/workspace/CommandPalette.tsx 负责命令构建与执行。

命令来源：
- Insert：来自 REGISTRY
- Layout：5 种布局切换
- Spaces：新建 tab、切换 tab
- Theme：切换主题

交互：
- Ctrl/Cmd + K 打开
- 上下键移动
- Enter 执行
- Esc 关闭

---

## 10. 主题系统
- 主题定义：src/workspace/theme.tsx
- 主题菜单：src/workspace/ThemeMenu.tsx
- CSS 变量：src/styles.css

策略：
- ThemeProvider 通过 data-theme 写到 documentElement
- 样式用 CSS 变量驱动主题切换

---

## 11. 路由与页面
目前文件路由只有一个页面：
- /

对应文件：
- src/routes/index.tsx

要新增页面：
- 在 src/routes 下新增文件路由
- 由 TanStack Router 插件自动更新 routeTree.gen.ts

---

## 12. 迁移后遗留与边界（很重要）
仓库仍存在历史 SSR 相关文件，但当前 SPA 主链路不会使用：
- src/server.ts
- src/start.ts

这些是旧的 TanStack Start/Nitro 逻辑。若目标是纯 SPA，可后续清理；若需要恢复 SSR，可基于它们重建服务链。

另外，依赖中仍有部分历史包（如 react-start、nitro、lovable 相关）。目前不阻塞 SPA 构建。

---

## 13. 给其他模型的任务提示模板
可直接复制下面文本给其他模型：

你现在接手一个 Vite + React + TanStack Router 的 SPA 项目，核心是 workspace 面板系统。请先阅读以下文件并建立心智模型：
- src/main.tsx
- src/router.tsx
- src/routes/__root.tsx
- src/routes/index.tsx
- src/workspace/store.tsx
- src/workspace/layout.ts
- src/workspace/Workspace.tsx
- src/workspace/Panel.tsx
- src/workspace/registry.tsx
- src/workspace/components.tsx

要求：
1) 不修改 routeTree.gen.ts（自动生成）
2) 以 store.tsx + layout.ts 为行为基线
3) 保持“布局切换不丢面板内部状态”这个核心约束
4) 若要新增组件，走 components.tsx + registry.tsx 路径
5) 默认使用 pnpm run dev / pnpm run build 验证

---

## 14. 快速核对清单
- 是否能启动开发服务器
- 是否能构建出 dist/index.html
- 是否能新增面板并在切换布局后保持状态
- tab 切换后是否保留各自状态
- 命令面板是否可执行布局切换/新增组件/切主题

以上内容覆盖了当前项目可维护的核心架构与接手边界。