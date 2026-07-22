# Xiranite 全局设置中心规划

更新时间：2026-07-22

## 目标

解决 XR 全局设置（`ThemeSettings`）「有 tab 仍难找、单页过长、单体文件过大」的问题，并统一为可滚动的时间线浏览结构。

非目标：NeoView Reader 设置窗口（`ReaderSettingsWindow`）保持独立，不并入本规划。

## 约束

| 项 | 规则 |
|---|---|
| 单文件行数 | **生产源码硬上限 1000 行**（`.ts` / `.tsx` 实现文件）；测试文件可放宽 |
| 组件来源 | 禁止手搓时间线/进度条；优先 Aceternity / Magic UI / 项目已有 `ui/*` |
| 动画 | 使用 `motion/react` 与 Magic UI 动效组件，不新增第二套动画运行时 |
| 持久化 | 继续走 workspace store / Local Backend，不改配置协议 |
| 测试 | 以挂载与关键导航 smoke 为主；不要求逐控件截图像素对比 |

## 信息架构

**按需挂载**：任意时刻只渲染当前阶段的 Section，禁止一次挂载全部阶段（会卡死）。

左侧快切轨（阶段 + 子步骤）+ 右侧当前阶段内容：

```text
[ 01 外观 ]── 主题 / 颜色 / 字体语言 / 氛围 / 导入JSON
[ 02 工作区 ] 背景 / 操作栏 / 字母索引     ← 仅展开当前阶段的子步骤
[ 03 视图 ]
[ 04 运行时 ]
[ 05 数据 ]
```

## 组件选型

| 能力 | 组件 | 来源 |
|---|---|---|
| 阶段/子步骤快切 | `SettingsStageNav` | 基于 `SETTINGS_STAGES` 注册表 |
| 表面模式 | `useNodeSurface` | 与节点卡同一套 collapsed/compact/portrait/regular/expanded/workspace |
| 滚动进度 | `ScrollProgress` | Magic UI，`containerRef` 指向当前内容区 |
| 步骤卡入场 | `BlurFade`（轻量） | 项目已有 Magic UI |
| 高级折叠 | `Collapsible` | shadcn / Radix |
| 双入口 | Overlay + `settings` 模块节点 | `OverlayViewModules.SettingsModule` 与侧栏共用 `ThemeSettings` |

表面模式 → 导航形态：

| mode | nav | 说明 |
|---|---|---|
| collapsed | select | 阶段/子分类下拉，极小卡片 |
| compact / portrait | chips | 顶栏阶段+子步骤 chip |
| regular | rail | 侧轨；高度够时 expandAll 子步骤 |
| expanded / workspace | rail expandAll | 侧轨全展开 + 搜索 + 说明 |

禁止：全量挂载所有 Section；忽略 `useNodeSurface` 另起一套断点；对每张设置卡挂连续 beam 动画。

## 目录结构

```text
src/components/ui/timeline.tsx              # Aceternity Timeline（通用）
src/components/ui/scroll-progress.tsx       # Magic UI ScrollProgress（通用）
src/components/views/ThemeSettings.tsx      # re-export
src/components/views/settings/
  ThemeSettings.tsx                         # 壳：Timeline + ScrollProgress
  types.ts                                  # 阶段 / 步骤注册表
  themeMeta.ts                              # 主题图标与常量
  primitives.tsx                            # SettingsStepCard / rows
  AppearanceSection.tsx
  WorkspaceSection.tsx
  ViewSection.tsx
  RuntimeSection.tsx
  DataSection.tsx
```

硬规则：

- 上述任一实现文件 **≤ 1000 行**；逼近 900 行时先拆子文件再加功能。
- 新设置项必须登记到 `types.ts` 的 `SETTINGS_STAGES`，再落到对应 Section。
- 不得把业务 section 重新塞回 `ThemeSettings.tsx` 单体。

## 实现状态

- [x] 拆分原 `ThemeSettings.tsx`（~1400 行）为 `settings/*` 模块
- [x] 阶段 + 子步骤快切轨 `SettingsStageNav`（解决无快切 / 无子分类）
- [x] **仅挂载当前阶段 Section**（解决全量渲染卡顿）
- [x] 接入 Magic UI `ScrollProgress`（当前内容区）
- [x] 步骤卡使用轻量表面 + `BlurFade` + `Collapsible`（去掉 per-card MagicCard/BorderBeam）
- [x] 重划阶段：外观 / 工作区 / 视图 / 运行时 / 数据
- [x] i18n：`settings.timeline.*`、`settings.sections.workspace`、`settings.search.*`
- [x] 设置搜索：切阶段后 `scrollIntoView` 到 `data-settings-step`
- [x] 深链：`?settings=<sectionId>` 打开 overlay 并只挂载对应阶段

## 验收

1. 打开设置可见左侧阶段轨；当前阶段展开子步骤，可一键切换。
2. DOM 中任意时刻只有一个 `data-settings-active-section`；切换阶段后旧阶段步骤卡卸载。
3. 搜索「操作栏」会切到工作区并滚到 chrome 步骤。
4. `?settings=workspace` 只挂载工作区内容。
5. `src/components/views/settings/**` 实现文件均 ≤ 1000 行。

## 测试策略（放宽）

- smoke：挂载、快切、子步骤、搜索、深链；断言「未挂载其他阶段」。
- 不强制：逐滑条、WebView2 保存、主题 JSON round-trip、截图回归。

## 后续扩展

- [x] 设置搜索 + 深链（见上）。
- 节点级设置仍留在节点卡内；全局设置只放跨节点 / 工作区 / 运行时项。
