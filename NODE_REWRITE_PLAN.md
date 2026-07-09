# 节点 UI 重写任务规划

## 总览

按 trename 标准重写所有节点的 4 视图（Collapsed/Compact/Portrait/Full），每个节点针对功能定制独特布局，不套模板。

### 进度

| 状态 | 节点 |
|------|------|
| ✅ 已完成 | cleanf, coveru, crashu, dissolvef |
| ⏳ 待重写 | bandia, encodeb, enginev, envuconfig, findz, formatv, gifu, jellypot, kavvka, lata, linku, linedup, lorat, marku, migratef, movea, mvz, nameu, owithu, rawfilter, recycleu, repacku, scoolp, seriex, simiu, smartzip, snf, synct, timeu |
| 🔀 交其他模型 | classf, classq, audiov, bitv, transq |
| ✅ 已达标 | trename, sleept |

**待重写：25 个节点，分 5 批，每批 5 个并行子智能体。**

---

## 通用设计标准

### 视图骨架（所有节点共用）

```
useNodeSurface() → surface.mode: collapsed | compact | portrait | regular | expanded | workspace

const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
const forceCollapsedSurface = compactSurface && surface.height > 0 && surface.height < 160
const portraitCompact = surface.mode === "portrait" || (surface.mode === "compact" && surface.width < 560 && surface.height >= 300)

surface.mode === "collapsed" || forceCollapsedSurface → CollapsedView
compactSurface && portraitCompact → PortraitCompactView
compactSurface && !portraitCompact → CompactView
else → FullView
```

### 关键约束

- `createViewProps` 聚合所有视图 props，类型和结构不变
- 核心逻辑函数（patch/execute/buildInput/statusFromState 等）完全不动
- 保持所有现有控件引用
- 只重写 4 个视图函数 + 可新增局部辅助组件
- 用 `@container/<节点名>` 做容器查询
- 顶部保留 `radial-gradient` 背景（改 chart 色彩区分节点）

### 可用组件

**shadcn UI**：全套（tabs/button/badge/card/scroll-area/separator/alert-dialog/progress/select/switch/input/textarea/popover/tooltip/dialog 等）

**magicui 组件**（from `@/components/ui/*`）：

| 组件 | import | 用途 |
|------|--------|------|
| MagicCard | `@/components/ui/magic-card` | 鼠标跟随光晕卡片，包裹关键区域 |
| GridPattern | `@/components/ui/grid-pattern` | SVG 网格背景纹理 |
| BorderBeam | `@/components/ui/border-beam` | 边框流光动画，运行时启用 |
| AnimatedCircularProgressBar | `@/components/ui/animated-circular-progress-bar` | 环形进度 |
| NumberTicker | `@/components/ui/number-ticker` | 数字滚动动画 |
| AnimatedList | `@/components/ui/animated-list` | 列表项入场动画 |
| BlurFade | `@/components/ui/blur-fade` | 淡入动画 |

**项目共享**：`RunningTint` from `@/nodes/shared/controls`

### 设计差异化要点

- **FullView 禁止用"左配置+右Tabs"模板**——必须针对节点功能定制
- 每个节点的 FullView 布局结构要独特（管道流/三栏/瀑布流/网格/时间轴等）
- CompactView 和 PortraitCompactView 也要差异化（不是简单去掉 FullView 的某些部分）
- CollapsedView 保持单行胶囊，但可加节点特色图标/动画

---

## 批次 2

### bandia — 归档管道

**功能**：使用 Bandizip 批量解压/压缩/重打包归档并生成路径映射。核心是 extract→映射→repack 管道流。

**FullView 设计**：三阶段管道横向流
- 左栏 InputSilo（输入料仓）：归档/源路径列表，GridPattern 背景，NumberTicker 计数
- 中栏 ProcessingChamber（处理室）：ModePicker + PrimarySwitches + 执行闸门，MagicCard 包裹，运行时 BorderBeam
- 右栏 MappingOutput（映射产出）：archivePath↔extractedPath 双列映射视图 + 结果表
- 底部 LogsStrip（最近5条日志横滚）

### encodeb — 乱码修复

**功能**：修复压缩包内中/日/韩文乱码文件名（cp437→cp936/932/949 编码转换重命名）。

**FullView 设计**：编码转换对比台
- 左栏：归档路径输入 + 编码选择（源编码→目标编码）
- 中栏：乱码→修复 文件名对比列表（before/after 双列），用 AnimatedList 入场
- 右栏：执行 + 结果统计 + 日志
- 可用 NumberTicker 显示修复文件数

### enginev — Wallpaper Engine 管理

**功能**：Wallpaper Engine 工坊目录扫描/筛选/重命名/导出清单/删除项目。

**FullView 设计**：项目网格管理器
- 顶部：扫描目录 + 筛选条件
- 主体：壁纸项目卡片网格（MagicCard 包裹每个项目，显示缩略图占位+标题+大小）
- 右侧/底部：批量操作工具栏（重命名/导出/删除）
- 运行时 BorderBeam 扫描动画

### envuconfig — 配置备份

**功能**：扫描 EnvU 配置文件并生成清单/执行备份到备份目录。

**FullView 设计**：配置清单+备份流向
- 左栏：扫描目录 + 备份目标
- 中栏：配置文件清单表（路径+大小+修改时间）
- 右栏：备份执行 + 进度 + 结果
- GridPattern 背景体现"系统配置"感

### findz — 文件搜索

**功能**：文件搜索（支持压缩包成员展开、嵌套归档检测、SQL 过滤器，输出 text/json/csv/efu）。

**FullView 设计**：搜索控制台
- 顶部：搜索路径 + WHERE 条件 + 输出格式
- 主体：搜索结果 DataTable（已有）+ 压缩包成员展开树
- 右栏：操作（搜索/导出/复制）+ 统计
- AnimatedList 结果入场动画

---

## 批次 3

### formatv — .nov 后缀管理

**功能**：视频文件 .nov 后缀管理（扫描/添加/移除 .nov、查重）。

**FullView 设计**：后缀切换面板
- 左栏：扫描目录 + 操作模式（添加/移除/查重）
- 主体：文件列表（显示当前后缀状态 + 预览变更后状态）
- 底部：执行 + 统计
- BorderBeam 运行时扫描动画

### gifu — 图片转动画

**功能**：图片序列转 GIF/WebP/APNG/视频动画（检查归档/生成计划/调用 gifu 生成）。

**FullView 设计**：帧序列预览台
- 左栏：归档路径 + 输出格式 + 参数
- 中栏：图片帧序列缩略图条（横向滚动预览）
- 右栏：生成计划 + 执行 + 结果
- MagicCard 包裹帧预览区

### jellypot — 媒体播放配置

**功能**：PotPlayer 媒体播放、Jellyfin 打开与注册表配置导入。

**FullView 设计**：播放器配置中心
- 左栏：媒体路径 + 播放器选择
- 中栏：注册表配置预览/导入
- 右栏：操作 + 日志
- GridPattern 背景体现"系统配置"感

### kavvka — 重复画师扫描

**功能**：Czkawka 重复画师文件夹扫描/预演/移动兄弟目录到 #compare。

**FullView 设计**：重复检测面板
- 左栏：扫描目录 + 阈值
- 主体：重复组列表（每组显示文件夹+大小+文件数，可展开）
- 右栏：预演/执行 + 移动目标
- NumberTicker 显示重复组数

### lata — 任务执行

**功能**：lata 任务加载/预览命令/执行任务。

**FullView 设计**：任务运行台
- 左栏：任务列表/选择
- 中栏：命令预览（终端样式）
- 右栏：执行 + 输出日志
- BorderBeam 执行时动画

---

## 批次 4

### linku — 符号链接管理

**功能**：符号链接管理（查询路径信息/创建链接/移动并链接/列出链接）。

**FullView 设计**：链接关系图
- 左栏：路径输入 + 操作模式
- 主体：链接关系可视化（源→目标 箭头列表）
- 右栏：执行 + 结果
- 可用 GridPattern 体现"文件系统"感

### linedup — 文本行过滤

**功能**：文本行过滤去重排序（按过滤词 token 过滤源文本行，支持大小写与排序）。

**FullView 设计**：双栏文本对比
- 左栏：源文本输入
- 中栏：过滤词输入 + 开关
- 右栏：过滤结果（保留/移除 高亮对比）
- 纯前端工具，无需运行时动画

### lorat — LoRA 模型扫描

**功能**：LoRA 模型扫描与触发词推断/应用 TriggerDB/写入 sidecar/导出。

**FullView 设计**：模型卡片网格
- 顶部：扫描目录 + 选项
- 主体：LoRA 模型卡片网格（模型名+触发词+sidecar状态）
- 右栏：批量操作 + TriggerDB
- MagicCard 包裹每个模型卡

### marku — Markdown 处理

**功能**：Markdown 文本处理多模块（标题列表互转/连续标题清理/去重/表格转换/内容替换等）。

**FullView 设计**：多模块工作台
- 左栏：模块选择（ModePicker 风格）
- 主体：输入文本 + 输出文本 双栏对比
- 右栏：选项 + 执行
- 纯前端文本处理

### migratef — 文件迁移

**功能**：文件迁移（保持结构/扁平/直接模式，移动或复制）。

**FullView 设计**：迁移流向图
- 左栏：源路径 + 目标路径 + 迁移模式 + 动作(移动/复制)
- 主体：迁移文件列表（源→目标 映射）
- 右栏：执行闸门 + 进度
- BorderBeam 迁移时动画

---

## 批次 5

### movea — 归档移动

**功能**：归档压缩包移动到目标子文件夹（扫描/正则匹配/执行移动）。

**FullView 设计**：正则匹配移动台
- 左栏：扫描目录 + 正则模式 + 目标规则
- 主体：匹配结果列表（归档→目标文件夹）
- 右栏：执行 + 统计
- NumberTicker 匹配数

### mvz — 压缩包内操作

**功能**：压缩包内文件提取/移动/删除/正则重命名。

**FullView 设计**：压缩包内容浏览器
- 左栏：压缩包路径 + 操作模式
- 主体：包内文件树 + 操作预览
- 右栏：执行 + 结果
- 可用 ScrollArea + 树形结构

### nameu — PackuWorkbench 包装

**功能**：按 NameU 规则重命名画师归档目录（status/plan/run）。

**特殊**：需脱离 PackuWorkbench，独立实现 4 视图。

**FullView 设计**：重命名预览台
- 左栏：路径 + 规则配置
- 主体：before→after 文件名对比列表
- 右栏：plan/run 执行 + 结果
- AnimatedList 对比项入场

### owithu — 右键菜单注册

**功能**：Windows 右键菜单注册表项注册/注销（TOML 配置预览/写入/移除）。

**FullView 设计**：注册表编辑器风格
- 左栏：TOML 配置输入
- 主体：注册表项预览（树形结构）
- 右栏：注册/注销 + 日志
- GridPattern 体现"系统注册"感

### rawfilter — 相似归档过滤

**功能**：原始/重复归档相似度过滤（扫描分组/生成保留移动计划/执行过滤）。

**FullView 设计**：相似度分组面板
- 左栏：扫描目录 + 阈值
- 主体：分组列表（每组：保留项 + 待移项）
- 右栏：执行过滤 + 统计
- NumberTicker 分组数

---

## 批次 6

### recycleu — 回收站清理

**功能**：回收站定时自动/立即清理与状态检查。

**FullView 设计**：回收站监控台
- 左栏：清理模式（立即/定时）+ 选项
- 主体：回收站状态（项目数+大小，AnimatedCircularProgressBar）
- 右栏：执行 + 日志
- 定时模式可显示倒计时环

### repacku — 归档重打包

**功能**：归档重打包（分析/完整流程/按配置压缩/单层打包/画集打包）。

**FullView 设计**：打包流程步骤器
- 顶部：步骤指示器（分析→配置→打包→验证）
- 主体：当前步骤内容区
- 右栏：执行 + 进度
- BorderBeam 打包时动画

### scoolp — Scoop 包管理

**功能**：Scoop 包管理（状态/列包/同步 Bucket/缓存扫描备份删除）。

**FullView 设计**：包管理控制台
- 左栏：操作模式选择
- 主体：包列表/缓存列表
- 右栏：执行 + 输出
- 终端风格日志区

### seriex — 系列归档分组

**功能**：系列归档分组移动（预览计划/执行移动/应用计划）。

**FullView 设计**：分组移动计划
- 左栏：扫描目录 + 分组规则
- 主体：分组预览（每组：归档列表→目标目录）
- 右栏：执行 + 结果
- AnimatedList 分组入场

### simiu — 相似图片分组

**功能**：相似图片分组（扫描/按大小签名分组/移动复制链接）。

**FullView 设计**：图片分组网格
- 左栏：扫描目录 + 分组阈值 + 操作模式
- 主体：图片缩略图分组网格（MagicCard 包裹每组）
- 右栏：执行 + 统计
- 每组显示代表图 + 数量

---

## 批次 7

### smartzip — SmartZip 归档

**功能**：SmartZip 归档解压/打包/代码页解压/打开设置。

**FullView 设计**：解压打包双模台
- 左栏：路径 + 操作模式（解压/打包/代码页解压）
- 主体：操作预览
- 右栏：执行 + 结果
- BorderBeam 运行时动画

### snf — PackuWorkbench 包装

**功能**：修复编号目录顺序，保持序列连续可追踪。

**特殊**：需脱离 PackuWorkbench，独立实现 4 视图。

**FullView 设计**：编号序列修复台
- 左栏：路径 + 修复规则
- 主体：before→after 编号对比列表
- 右栏：plan/run 执行 + 结果
- NumberTicker 修复数

### synct — PackuWorkbench 包装

**功能**：按提取时间戳归档文件或目录。

**特殊**：需脱离 PackuWorkbench，独立实现 4 视图。

**FullView 设计**：时间戳归档台
- 左栏：路径 + 时间戳规则
- 主体：文件列表（按时间戳排序 + 目标归档名预览）
- 右栏：plan/run 执行 + 结果
- 时间轴风格布局

### timeu — PackuWorkbench 包装

**功能**：备份或恢复文件时间戳。

**特殊**：需脱离 PackuWorkbench，独立实现 4 视图。

**FullView 设计**：时间戳备份恢复台
- 左栏：路径 + 模式（备份/恢复）
- 主体：文件列表（原时间戳↔目标时间戳 对比）
- 右栏：plan/run 执行 + 结果
- GridPattern 体现"系统属性"感

---

## 子智能体任务模板

每个节点复制以下模板，替换 `{节点名}` 和设计方向，分发给子智能体：

```
## 任务
重写 {节点名} 节点的 Component.tsx，实现4视图差异化设计。

## 文件位置
- 主组件：d:\1VSCODE\Projects\Xiranite\src\nodes\{节点名}\Component.tsx
- 同目录下的 types.ts / constants.ts / controls.tsx / ResultPanels.tsx 等全部文件都要读

## 设计标准（参考 trename 节点 d:\1VSCODE\Projects\Xiranite\src\nodes\trename\Component.tsx）
关键模式：
1. 使用 useNodeSurface() 获取 surface.mode（collapsed/compact/portrait/regular/expanded/workspace）
2. 4个视图函数：CollapsedView / CompactView / PortraitCompactView / FullView
3. compactSurface = mode === "compact" || mode === "portrait"
4. forceCollapsedSurface = compactSurface && height > 0 && height < 160
5. portraitCompact = mode === "portrait" || (mode === "compact" && width < 560 && height >= 300)
6. createViewProps 聚合所有视图需要的 props
7. 每个视图针对节点功能定制独特布局，不要套模板

## 可用组件
- shadcn UI: 全套（tabs/button/badge/card/scroll-area/separator/alert-dialog/progress 等）
- magicui: MagicCard, GridPattern, BorderBeam, AnimatedCircularProgressBar, NumberTicker, AnimatedList, BlurFade (all from @/components/ui/*)
- RunningTint from "@/nodes/shared/controls"

## {节点名}功能与设计方向
{填入上方对应节点的功能描述和 FullView 设计方向}

## 关键约束
- 保持核心逻辑不变（patch/execute/buildInput/statusFromState 等函数完全不动）
- 保持 createViewProps 的 props 类型和结构不变
- 保持所有现有控件引用
- 只重写4个视图函数 + 可新增局部辅助组件
- 用 @container/{节点名} 做容器查询
- 顶部 radial-gradient 背景保留
- FullView 禁止用"左配置+右Tabs"模板

## 验证
完成后运行：bun run tsgo --noEmit
确保类型检查通过。如果有错误，修复后再次运行直到通过。
然后运行：bun run vitest run src/nodes/{节点名}
确保测试通过。
```

### PackuWorkbench 包装节点额外说明

对于 snf/synct/timeu/nameu 这类 PackuWorkbench 包装节点，任务模板需追加：

```
## 额外要求（PackuWorkbench 包装节点）
当前节点是 PackuWorkbench 薄包装，需脱离独立实现：
- 从 d:\1VSCODE\Projects\Xiranite\src\nodes\shared\packu\Workbench.tsx 提取核心逻辑
- 复用 shared/packu 的控件（ActionPicker/PathsInput/OptionsPopover/StatusStrip 等），但布局独立
- 保持 PackuCardState 类型
- 参考 coveru 的重写方式（已完成的范例）：d:\1VSCODE\Projects\Xiranite\src\nodes\coveru\Component.tsx
```
