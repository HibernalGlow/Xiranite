# Czkawka fork → Xiranite 功能迁移清单

## 1. 基线与完成定义

- 权威功能基线：`D:\1VSCODE\Projects\ImageAll\czkawka-tauri`
- fork：`HibernalGlow/czkawka-tauri`
- 分支：`origin/main`
- 基线提交：`bbe1969`（tag `1.3.4`）
- 上游参考：`shixinhuang99/czkawka-tauri` 的 `upstream/main`
- 审计日期：2026-07-14

### 按提交作者确定的 fork 增强边界

按作者从最新提交向历史回溯：

- 边界前一提交：`210823a`，作者 `GitButler <gitbutler@gitbutler.com>`，`GitButler Workspace Commit`
- 边界后第一条用户提交：`4d7b960`，作者 `HibernalGlow <3090253564@qq.com>`，`feat: add custom theme management and settings`
- 当前终点：`bbe1969`，作者 `HibernalGlow <3090253564@qq.com>`，`prepare release 1.3.4`
- fork 增强区间：`210823a..bbe1969`
- 区间规模：98 个提交；仅 `ui/src` 与 `tauri/src` 已涉及 169 个文件、约 21,903 行新增和 1,983 行删除

fork 与当前 `upstream/main` 已经没有共同 merge-base，因此不再使用 `upstream/main...main` 推断增强内容。本文件以以下两类证据为准：

1. 完整功能对等：fork `1.3.4` 当前源码树。
2. 用户 fork 的改进功能：`210823a..bbe1969` 的提交和文件差异。

可重复审计命令：

```powershell
git log 210823a..bbe1969 --format="%h %an <%ae> %s"
git diff --name-status 210823a..bbe1969 -- ui/src tauri/src
```

迁移完成必须同时满足：

1. 11 个工具的扫描参数、结果字段和工作流达到 fork 功能对等。
2. GUI、CLI、OpenTUI 共享同一套 TypeScript 领域模型和操作逻辑。
3. Rust 仅保留 `czkawka_core` 扫描和无法用宿主 API 替代的原生桥接；删除、移动、导出、筛选、排序、选择、统计、持久化全部使用 TypeScript。
4. GUI 使用 React Compiler 友好写法：纯渲染、不可变更新、渲染期派生状态、必要且原始的 effect 依赖，不以手写 `useMemo/useCallback` 代替 Compiler。
5. 每个清单项必须有测试或真实渲染/交互证据；“存在 UI”不等于完成。

状态定义：

- `[x]` 已完成并有验证证据
- `[-]` 已有基础实现，但与 fork 不对等
- `[ ]` 尚未迁移
- `[~]` 明确改用 Xiranite 通用能力，仍需验证功能对等

## 2. 当前架构边界

| 层 | 职责 | 目标状态 |
| --- | --- | --- |
| `native/czkawka-core` | 调用 `czkawka_core` scanner、转换输入输出 | 冻结；只修阻塞性桥接缺陷 |
| `native/czkawka-node` | 将 Rust core 暴露为 Node-API | 冻结；最终仅做 release 构建 |
| `packages/czkawka-native` | 加载 `.node`、部署 dav1d DLL、TS 类型 | 原生加载边界 |
| `packages/nodes/czkawka` | 领域模型、过滤、排序、选择、操作、CLI、TUI | 主要后端逻辑所在地 |
| `src/nodes/czkawka` | Xiranite React GUI | fork GUI 功能对等实现 |
| `src/nodes/shared` | 图片直通等节点通用能力 | 不得写死 Czkawka |

## 3. 11 个工具与专属参数

权威来源：fork `ui/src/views/tool-settings.tsx`、11 个结果 view、`tauri/src/*.rs`。

| ID | 状态 | 工具 / 能力 | fork 关键参数 | Xiranite 验收标准 |
| --- | --- | --- | --- | --- |
| T01 | `[x]` | 重复文件 | name/size/size+name/hash；Blake3/CRC32/XXH3；大小写；最小组大小；prehash；hard link | 原生扫描参数进入 Node-API；最小组过滤由 TS core 处理；结果按组保留参考项 |
| T02 | `[x]` | 空文件夹 | 递归、排除项、删除时仅空层级校验 | 列表和删除策略可区分文件夹，不依赖 Rust 删除 helper |
| T03 | `[x]` | 大文件 | 最大/最小模式、行数 | 两种排序方向与数量限制真实影响 native 扫描 |
| T04 | `[x]` | 空文件 | 通用路径/扩展名/递归过滤 | 扫描、显示、选择、操作均可用 |
| T05 | `[x]` | 临时文件 | 通用目录过滤 | 扫描、显示、选择、操作均可用 |
| T06 | `[x]` | 相似图片 | hash size；hash 算法；resize 算法；差异度；忽略同尺寸；文件夹阈值；自定义预设 | 参数完整；预设持久化；图片组和相似文件夹视图可切换 |
| T07 | `[x]` | 相似视频 | 差异度；忽略同尺寸；skip forward；hash duration；crop detect | 参数完整传到 core；结果可播放并显示视频元数据 |
| T08 | `[x]` | 重复音频 | tags/fingerprint；近似标签；title/artist/bitrate/genre/year/length；指纹差异和片段时长 | 两种算法模式、字段列、音频预览/打开能力对等 |
| T09 | `[x]` | 无效符号链接 | 通用过滤 | 显示 link/target/reason，操作不误处理 target |
| T10 | `[x]` | 损坏文件 | audio/PDF/archive/image 类型开关 | 类型开关进入 native；结果显示错误类型与详情 |
| T11 | `[x]` | 不正确扩展名 | 当前扩展名、正确扩展名、批量重命名 | 支持预览、冲突处理、dry-run 和真实重命名 |

T01 验证证据（2026-07-15）：重复文件的 check method、hash type、名称大小写、prehash、hard link 与 reference 参数由 `CZKAWKA_TOOL_OPTIONS` 唯一驱动三端并传入冻结的 Node-API；fork 的最小组大小属于结果策略，由共享 TS core 在 native 分组返回后过滤。真实 release Node-API smoke 使用隔离目录验证 name/size/size+name/hash 四种方法，CRC32/XXH3/BLAKE3 三种哈希均找到内容副本，大小写开关只在预期模式合并 `Same.txt`/`same.txt`，prehash 开关不改变正确性，hard link 开关决定同 inode 项是否成组，`--min-group 3` 从三项组和两项组中只保留三项组；reference 目录结果保持一项 `isReference` 标记。TS 单测另覆盖最小组过滤和 reference 回收空间计算，Rust 无新增业务逻辑。

T02/T03 验证证据（2026-07-15）：空文件夹与大文件继续使用已冻结的 basic scanner Node-API，不增加 Rust 业务逻辑；递归、排除项、结果数量和最大/最小方向均由 `CZKAWKA_TOOL_OPTIONS` 与通用扫描字段驱动 GUI、CLI、OpenTUI。文件操作仍完全位于 TypeScript：空文件夹 live 删除会在执行瞬间递归检查整棵目录树只包含目录，符号链接或任何文件都会拒绝删除；pipe CLI 操作新增通用 `--tool`，因此 `delete --tool empty-folders` 与 GUI/OpenTUI 一样保留该安全语义。真实 release Node-API smoke 构造 100/50/1 字节文件，`--count 2 --biggest-first` 只返回 100/50，`--no-biggest-first` 只返回 1/50；空目录扫描同时验证递归关闭、排除规则、成功删除纯空目录树，以及扫描后新增文件时 live 删除返回逐项 error 且文件仍存在。

T06 验证证据（2026-07-15）：fork 原先在 Tauri Rust 中按父目录计数并硬编码阈值 2，前端再按设置二次过滤。Xiranite 将该逻辑迁为 `@xiranite/node-czkawka/similar-folders` 纯 TS 模块，一次生成路径、图片数、体积、涉及组数和非 reference 优先预览图，并按本次 `similarImagesFolderThreshold` 直接写入共享 `CzkawkaData.similarFolders`。CLI、guided 结果、OpenTUI 分析卡和 GUI 图片/文件夹分段视图消费同一字段；GUI 文件夹行提供缩略图、数量、组数、体积、复制路径、打开和定位，并持久化视图模式。纯函数/core/GUI 测试覆盖 Windows/POSIX 路径、阈值、排序、reference 预览替换、结果挂载、筛选、宿主操作和模式恢复；真实 Chromium 在 420×720 portrait 直接进入相似文件夹视图，边界、可访问名称和 console 均健康。真实 release Node-API smoke 使用脚本内生成的 256×256 BMP 渐变及变体，逐项验证 4 种 hash size、6 种 hash algorithm、5 种 resize algorithm、差异度、同尺寸忽略和文件夹阈值，Rust 无新增业务逻辑。

T07 验证证据（2026-07-15）：similar-videos 的 tolerance、同尺寸排除、skip forward、hash duration 和 crop detect 继续由统一 TS 参数 schema 驱动三端并原样映射到 Czkawka core；视频播放、缩略图、路径操作与媒体信息继续复用通用本地媒体组件。为补齐 core 已用于匹配但未导出的距离，最小 Rust bridge 以 reference 或组内首项为基准，调用同一 `VideoHash.hamming_distance` 并按该库固定 1000-bit hash 归一化为百分比字符串；不修改 vendor，不在前端猜测。真实 smoke 用 FFmpeg 生成 6 秒 testsrc2 视频及轻微亮度变体，验证 letterbox/motion/none 三种 crop 均成组且返回 `0.00` 与非零距离，skip 0/duration 2 和 skip 2/duration 4 均生效，tolerance 0 与 ignore-same-size 都按预期移除结果。release `.node` 为 21.32 MiB，含 dav1d ZIP 为 8.75 MiB，预编译 manifest/SHA 已刷新。

T08 验证证据（2026-07-15）：重复音频继续由统一 TS 参数 schema 驱动 GUI、CLI、OpenTUI，并只把 tags/fingerprint 扫描及元数据提取交给冻结的 Node-API。真实 release smoke 使用 FFmpeg 生成带 title、artist、genre、year、length、bitrate 的 FLAC，tags 模式完整返回六类字段；关闭近似标签时 `Near Song` 与 `Near Song (Live)` 不成组，开启后按 core 原有的括号附加标题归一化规则成组；fingerprint 模式在开启和关闭相似标题约束时都正确识别相同音频，并验证差异阈值和最小片段参数。修复了 vendor 进度上报在同时比较多个标签字段时可能超过总文件数并触发进程 abort 的缺陷：只将已检查数量饱和到本阶段总数，不改变扫描结果。更新后的 release 预编译 ZIP 为 8.74 MiB，manifest/SHA 已刷新；音频播放、打开和字段展示继续复用三端共享 TS 领域数据与通用本地媒体组件。

T10 验证证据（2026-07-15）：broken-files 的 audio/PDF/archive/image 四个布尔开关来自同一 `CZKAWKA_TOOL_OPTIONS`，GUI、CLI、OpenTUI 与 Node-API DTO 不维护重复枚举。真实 smoke 分别构造带对应文件头但主体损坏的 MP3、PDF、ZIP、PNG，每轮显式关闭其余三类检查；四轮扫描都只返回目标文件，且 core 错误文本完整进入共享 `detail`。CLI 逐行输出、OpenTUI inspector 和 GUI 损坏文件详情列直接消费该字段，不增加 Rust 错误解释层。

## 4. 通用扫描配置

权威来源：`ui/src/views/bottom-bar.tsx`、`file-filter*.tsx`、`basic-filter.tsx`、`settings.tsx`。

| ID | 状态 | 能力 | 验收标准 |
| --- | --- | --- | --- |
| S01 | `[x]` | 包含目录 | 目录选择器、粘贴多路径、移除、去重、持久化 |
| S02 | `[x]` | 参考目录 | 可逐项/全选标记 reference，供相似图片与选择规则使用 |
| S03 | `[x]` | 排除目录 | 独立管理表、批量增加/移除、持久化 |
| S04 | `[x]` | 排除项目 | 支持多规则输入并保持 fork 语义 |
| S05 | `[x]` | 扩展名过滤 | allowed/excluded 双向过滤、格式 token、重置 |
| S06 | `[x]` | 文件大小范围 | 最小/最大值校验并进入所有适用 scanner |
| S07 | `[x]` | 递归扫描 | GUI/CLI/TUI 统一默认值和开关 |
| S08 | `[x]` | 缓存开关 | GUI/CLI/TUI 统一默认值和开关 |
| S09 | `[x]` | 线程数 | TS 设置持久化；必要时只通过现有 native 初始化入口 |
| S10 | `[x]` | 扫描停止 | core 支持取消令牌；GUI/CLI/TUI 可停止并得到 stopped 状态 |
| S11 | `[x]` | 进度 | 至少阶段进度、总体进度、步骤文本；不能只有 5%/100% 合成进度 |
| S12 | `[x]` | 扫描配置预设 | 新建、覆盖、删除、导入、导出、启动时恢复 |

来源输入证据（2026-07-15）：`packages/nodes/czkawka/src/source-inputs.ts` 复刻 fork 的 `splitStr` 语义，统一处理换行/逗号/分号、Unicode 方向隔离符、Windows 双引号路径和精确去重；GUI、OpenTUI/guided contract、扫描预设及 pipe CLI 共用该纯 TS 边界。GUI 的包含/排除目录均为独立持久化列表，支持宿主目录选择器、拖放、批量粘贴、逐项删除、勾选后批量删除和清空；包含目录支持逐项星标及全选/取消 reference，删除目录会同步清理悬空 reference。排除项目以多规则 token 显示，缺少 `*` 且非 `DEFAULT` 的规则明确标红；allowed/excluded 扩展名按 token 去点、去重、删除和重置，并提示 core 的 allowed 优先语义。CLI 新增可重复的 `--reference`、`--exclude-dir`、`--exclude-item`、`--allow`、`--exclude-ext` 和 `--threads`，OpenTUI 使用相同 parser。纯模型 4 项、包级 110 项、OpenTUI 1 项及 GUI 19 项 Vitest 通过，GUI 测试覆盖选择器、混合分隔粘贴、去重、reference 全选/删除联动、规则和扩展名重置后的最终扫描 DTO。

验证证据（2026-07-15）：Node-API v4 为三类 scanner 建立一次性 `scanId` session，直接把同一个 `AtomicBool` 交给 `czkawka_core::Search::search`，并把 core 的 `ProgressData` 连续转发为阶段、阶段序号、条目数和字节数；扫描结束即清理 session。TS platform 每 100ms 查询进度并在宿主取消令牌触发时调用 native cancel，core 将连续 native 进度映射为 3%–98% 的节点事件并保留停止时的部分结果。线程数进入 GUI、CLI、OpenTUI、扫描预设和统一 input contract，Rust 线程池仅在进程首次扫描时初始化；GUI 明示改变后需重启。GUI 主视图和折叠视图均在运行期间切换为停止动作，CLI 捕获 SIGINT/SIGTERM，OpenTUI 使用共享 definition 的 `cancel`。缓存 JSON、过期清理、目录路径及 duplicate KiB 阈值也由三类 DTO 透传。TS build/typecheck、Czkawka 包测试和 React Compiler 边界审计通过；release native smoke 实测 `CollectingFiles` 连续进度、取消返回 `stopped: true` 且 session 释放。

## 5. 结果表基础设施

权威来源：`ui/src/components/data-table.tsx`、各工具 view、提交 `c9b303c`、`5e12565`、`42ef8d3`。

| ID | 状态 | 能力 | 验收标准 |
| --- | --- | --- | --- |
| R01 | `[x]` | 工具专属列 | 11 个工具分别显示完整字段，不再共用“路径/大小/详情”最小列集 |
| R02 | `[x]` | 虚拟化 | 万级结果滚动流畅，DOM 行数受限 |
| R03 | `[x]` | 列排序 | 多工具排序状态隔离，表头可切换方向 |
| R04 | `[x]` | 列宽拖动 | 列宽可调且不会破坏缩略图行高 |
| R05 | `[x]` | 行复选 | 单行选择与全选 |
| R06 | `[x]` | Shift 范围选择 | Shift+Click 选择连续可见范围 |
| R07 | `[x]` | Ctrl 切换选择 | Ctrl+Click 不丢失现有选择 |
| R08 | `[x]` | 框选 | 鼠标拖框与虚拟行相交选择 |
| R09 | `[x]` | 分组轨道/分隔 | 分组结构可见；参考项和普通项语义明确 |
| R10 | `[x]` | 右键菜单 | 选中/取消整组、复制路径、复制文件、打开路径 |
| R11 | `[x]` | 行操作 | 打开、定位、复制路径/名称、预览 |
| R12 | `[x]` | 搜索命中联动 | 顶栏搜索实时过滤当前工具且保持分组合法 |
| R13 | `[x]` | 每工具状态隔离 | 数据、排序、过滤、选择在切换工具后保留 |
| R14 | `[x]` | 空态/错误态/停止态 | 三类状态均有明确文案与恢复入口 |

验证证据（2026-07-14）：`src/nodes/czkawka/result-table.tsx` 为 11 个工具定义独立列集，并以工具 ID 隔离排序、过滤、列宽、滚动窗口和选择锚点；固定 52px 行高的纯 TS 虚拟窗口仅渲染可视范围加 overscan。拖框按虚拟行全局坐标求交，支持替换、Ctrl/Shift 追加、Alt 移除且跳过参考项。每组有连续色轨和起始分隔，参考项有不可选 Badge。节点顶栏与表内搜索共享按工具隔离的受控状态，过滤后仍以完整组对象构造合法结果。空结果、错误和停止状态显示独立文案，错误/停止提供重新扫描入口，core 的 `stopped` 标志映射为 GUI `stopped` phase。每行右键菜单提供整组选择/取消、复制路径/名称、系统打开和文件管理器定位；文件对象剪贴板在通用 host 尚无该能力时明确禁用。`result-table.test.ts` 覆盖列映射、列排序、Shift/Ctrl 选择、框选三种模式/参考项和 10,000 行窗口计算；`result-table.component.test.tsx` 覆盖 520,000px 总滚动高度、滚动后窗口由第 0 行更新至第 73 行且 DOM 始终少于 80 行、列宽由 160px 拖至 240px 时行高不变、分组起始轨道、状态恢复、受控搜索、真实拖框与右键 Host 回调以及跨工具过滤/排序恢复；`Component.test.tsx` 覆盖跨工具结果、选择和搜索恢复及停止状态映射。

## 6. 多维筛选与格式筛选

权威来源：`ui/src/lib/filter-panel/*`、`views/filter-panel/*`、`atom/format-filter.ts`、提交 `bc292a0`。

| ID | 状态 | 能力 | 验收标准 |
| --- | --- | --- | --- |
| F01 | `[x]` | 快速文本筛选 | 当前已有路径/详情文本过滤；补正则、大小写与字段范围 |
| F02 | `[x]` | 标记状态筛选 | 已选、未选、全部 |
| F03 | `[x]` | 分组数量筛选 | 按组内项目数范围 |
| F04 | `[x]` | 分组体积筛选 | 按组总大小范围 |
| F05 | `[x]` | 文件大小筛选 | 带 B/KB/MB/GB/TB 单位 |
| F06 | `[x]` | 扩展名筛选 | include/exclude 与实时格式统计联动 |
| F07 | `[x]` | 日期筛选 | 预设和自定义范围 |
| F08 | `[x]` | 路径筛选 | contains/starts/ends/regex 等模式 |
| F09 | `[x]` | 相似度筛选 | 相似图片/视频差异范围 |
| F10 | `[x]` | 分辨率/宽高比筛选 | 图片和视频维度筛选 |
| F11 | `[x]` | 只看已选/未选 | 与表格选择实时联动 |
| F12 | `[x]` | 过滤组内显示全部 | 命中组后可显示组内未命中项 |
| F13 | `[x]` | 筛选预设 | 预设、重置、导入/导出、持久化 |
| F14 | `[x]` | 格式 Badge 筛选 | 图片/视频/音频/文档/压缩包/文件夹类别及单格式选择 |
| F15 | `[x]` | 筛选统计 | 原始/命中组数、文件数、体积实时显示 |
| F16 | `[x]` | 快捷键 | 展开、重置、应用等与 fork 一致的快捷操作 |

验证证据（2026-07-14）：高级筛选核心位于 `packages/nodes/czkawka/src/filters.ts`，与 React 无关，作为 GUI、CLI 和 OpenTUI 后续共用的唯一领域实现；当前 GUI 已接入，CLI/OpenTUI 的交互入口仍由 C07 跟踪。不同类别使用 AND、组状态内部使用对应组语义，组数量/体积在原始组上计算，条目命中后可恢复整组。`filter-panel.tsx` 提供标记/选择、组数量、组体积、文件大小及单位、扩展名 include/exclude、日期预设/自定义范围、5 种路径模式、相似度、分辨率/宽高比和组展开控件；快速文本支持包含/正则、大小写及名称/路径/媒体元数据/详情字段范围组合；图片、视频、音频、文档、压缩包、文件夹、其他及单扩展名 Badge 与原始/过滤计数实时联动。内置及自定义预设支持覆盖保存、删除、JSON 导入/导出，并随每工具筛选状态写入节点数据；Ctrl/Cmd+F、Ctrl/Cmd+Shift+F、Ctrl/Cmd+R、Escape 按节点焦点隔离。`filters.test.ts` 以 19 项定向用例覆盖边界、字段范围、类别、预设序列化和组合语义，连同包内测试共 34 项通过；GUI 23 项测试覆盖真实 Popover、统计、字段/类别/单格式切换、媒体专属条件、状态持久化、预设覆盖/删除/导入导出和快捷键。

## 7. 智能选择助手

权威来源：`ui/src/lib/selection-assistant/*`、`views/selection-assistant/*`、提交 `9ce201d`、`00fe804`、`4c54da7`。

| ID | 状态 | 能力 | 验收标准 |
| --- | --- | --- | --- |
| A01 | `[x]` | 每组除首项 | TypeScript 纯函数并有测试 |
| A02 | `[x]` | 保留最新/最旧 | TypeScript 纯函数并有测试 |
| A03 | `[x]` | 保留最大/最小 | TypeScript 纯函数并有测试 |
| A04 | `[x]` | 4 种组选择模式 | 替换、添加、移除、交集语义与 fork 对等 |
| A05 | `[x]` | 多级排序条件 | 可增删/拖动优先级，作用于组内候选 |
| A06 | `[x]` | 文本规则 | 文件名/路径字段、匹配模式、包含/排除 |
| A07 | `[x]` | 目录规则 | 包含目录、排除目录、reference 规则 |
| A08 | `[x]` | 选择历史 | undo/redo，切换工具隔离 |
| A09 | `[x]` | 清空/反选/全选 | 当前有清空/全选；补反选和可见范围语义 |
| A10 | `[x]` | 选择统计 | 已选数量、大小、预计回收空间 |
| A11 | `[x]` | 配置持久化 | 助手规则和展开状态持久化 |
| A12 | `[x]` | 选择快捷键 | 应用、撤销、重做、清空 |

验证证据（2026-07-15）：选择领域逻辑位于 `packages/nodes/czkawka/src/selection-assistant.ts`，与 React 无关。候选层实现每组除一项、每组一项、每目录除一项、除一个匹配集外全部四种模式，多级排序支持 10 个字段、方向、空值优先和附加过滤；合并层独立实现 replace/add/remove/intersect。文本规则支持文件名/文件夹/完整路径、五种条件、正则、大小写和整列匹配；目录规则支持保留一项、包含、排除，并统一保护 reference。纯 TS 历史按工具保存 50 步 undo/redo，统计数量、体积和预计回收空间，配置可序列化导入导出。`selection-assistant.tsx` 提供排序条件增删、上下移动及 HTML 拖动、规则页签、全选/反选/清空和节点焦点隔离快捷键；配置和展开状态写入节点数据。共享包 40 项测试、GUI 28 项相关测试通过，其中组件测试覆盖真实规则编辑、配置往返、快捷键和表格历史同步。

## 8. 图片、视频与音频预览

权威来源：`dynamic-preview-cell.tsx`、`thumbnail-*.tsx`、`video-player-dialog.tsx`、sidebar/floating preview views、提交 `911f1a8` 至 `b1f988b`。

| ID | 状态 | 能力 | 验收标准 |
| --- | --- | --- | --- |
| P01 | `[x]` | 通用本地图片直通 | `LocalImagePreview` 供所有节点复用；支持 AVIF/JXL；失败回退有测试 |
| P02 | `[x]` | 结果表图片缩略图 | 预览列宽、缩略图和虚拟行高联动；图片 lazy、视频 metadata preload |
| P03 | `[x]` | 视频缩略图 | 不依赖 fork 本地 HTTP server，改用 Xiranite 通用本地媒体 URL |
| P04 | `[x]` | 图片点击预览 | 对话框/侧栏/浮动卡片至少一种完整模式，支持上一个/下一个 |
| P05 | `[x]` | 视频播放器 | 横竖屏自适应、自定义进度、播放状态、跳转、音量、全屏 |
| P06 | `[x]` | 音频预览 | 重复音频可播放并显示 tag/fingerprint 信息 |
| P07 | `[x]` | 侧栏预览开关 | 当前工具独立状态和持久化 |
| P08 | `[x]` | 图片/视频信息卡 | 路径、大小、分辨率、修改时间、相似度等 |
| P09 | `[x]` | 缩略图缓存 | 浏览器响应缓存 + 有界虚拟窗口；真实 Chromium 跨页面缓存命中 |
| P10 | `[x]` | 预览列覆盖 | 重复文件、相似图片、相似视频、音频及其他媒体结果统一动态 preview cell |

验证证据（2026-07-15）：图片、视频、音频和统一媒体单元格均位于 `src/nodes/shared`，通过宿主 `getFileUrl` 直通本地媒体，不引入 Czkawka 私有 HTTP server、Rust 缩略图管理器或 canvas/base64 中转。图片组件识别 AVIF/JXL，支持 lazy/eager 加载、异步解码和失败回退；视频缩略图只在虚拟窗口内挂载，以 metadata preload 加载并跳转至代表帧。结果表按媒体类型提供可访问的预览/播放按钮，对话框按当前筛选和排序后的同类可见结果循环导航，预览状态按工具隔离。视频播放器使用 object-contain 适配横竖屏，提供自定义播放/暂停、进度、跳转、音量/静音和全屏控制；图片与视频信息卡均展示路径、大小、分辨率、修改时间、相似度和组号。重复音频播放器提供播放/暂停、进度跳转、音量/静音和前后导航，信息卡展示 core 返回的标题、艺术家、流派、年份、码率、时长，并在指纹模式展示最大差异、最小片段和相似标题限制；core 不暴露原始 fingerprint，前端不伪造该值。预览列宽按工具隔离，默认维持 36px 缩略图/52px 虚拟行，拖动放大时缩略图与行高同步变化。固定预览开关写入 `previewPanelEnabledByTool`，按 11 个工具隔离；图片、视频和音频共用 `LocalMediaPreviewPanel`，启用时在结果侧栏内导航，禁用时仍保留对话框工作流。39 项相关 Vitest 测试通过；10,000 张图片仍只创建少于 80 个 DOM 图片和宿主 URL。`local-media-cache.spec.ts` 使用真实 Chromium 和真实 `/local-files` 端点验证 `private, max-age=60`/ETag：两个独立页面均成功加载同一图片，后端只收到一次媒体请求。M4 的 P01–P10 已全部完成。

## 9. 文件操作与安全性

权威来源：`operations.tsx`、`delete-files.tsx`、`move-files.tsx`、`organize-similar-groups.tsx`、`rename-ext.tsx`、`right-click-menu.tsx`。

| ID | 状态 | 能力 | 验收标准 |
| --- | --- | --- | --- |
| O01 | `[x]` | dry-run 默认开启 | GUI/CLI/TUI 均不得默认真实修改文件 |
| O02 | `[x]` | 删除 | 当前支持永久删除；补回收站模式、空目录语义和详细结果 |
| O03 | `[x]` | 移动 | 当前单目标扁平移动；补复制模式、保留结构、覆盖策略、冲突提示 |
| O04 | `[x]` | 分组归档到多目标 | 每组/每项独立 destination，一次执行 |
| O05 | `[x]` | 相似组自动整理 | 按组生成目录并预览目标路径 |
| O06 | `[x]` | 导出结果 | 当前 JSON/CSV 路径列表；补当前视图/选择/全部范围和完整字段 |
| O07 | `[x]` | 不正确扩展名重命名 | 单项/批量、冲突检测、撤销提示 |
| O08 | `[x]` | 系统打开/定位 | 使用 Xiranite host API，不新增 Rust |
| O09 | `[x]` | 复制路径/名称 | 使用 clipboard host API |
| O10 | `[x]` | 复制文件到剪贴板 | 平台支持时使用通用 host；能力缺失时显式禁用 |
| O11 | `[x]` | 删除确认 | GUI 有破坏性确认；CLI/TUI 需要 `--live`/显式确认 |
| O12 | `[x]` | 操作结果详情 | 成功、跳过、错误、源/目标路径可展开查看 |

验证证据（2026-07-15）：通用 `NodeLocalFilesCapability` 暴露 `openPath`/`revealPath`，Wails 桌面端通过系统 `file:` URL 打开文件或父目录，浏览器模式回退到本地文件服务；Czkawka 只消费 Host 回调，不引入 Rust 文件操作。`NodeClipboardCapability.writeFiles` 新增通用本地文件对象剪贴板边界，Windows Bun/Node 后端校验路径后通过 STA PowerShell 写入系统 `CF_HDROP`，使用 JSON 环境变量传递路径而不拼接命令；前端只在 Windows 本地宿主声明能力，其他平台的菜单保持显式禁用。后端 26 项测试覆盖鉴权、请求校验、路径去重/存在性、特殊字符和平台限制，宿主/结果表 19 项测试覆盖能力检测、启用回调及缺失能力禁用；Czkawka 仍不包含平台脚本或 Rust 文件操作。

验证证据（2026-07-15）：文件操作控制面全部位于 `@xiranite/node-czkawka` TypeScript core/platform。删除默认进入 Windows 回收站，永久删除必须显式选择；空文件夹执行前会递归确认目录树只含空目录，避免扫描后状态变化导致误删。移动支持复制模式、根目录相对结构、`skip`/`overwrite`/`rename`/`error` 四种冲突策略、批次内目标占用检测和跨卷 `copy + remove` 回退。dry-run 与 live 共用逐项结果契约，记录 operation/status/source/target/error；GUI 提供完整设置和可展开详情，CLI 输出逐项状态，OpenTUI 通过共享 interaction schema 执行同一契约。包级 70 项 Vitest、真实文件原语测试、OpenTUI Bun 测试、GUI 14 项组件测试、应用 typecheck、React Compiler boundary audit 与 node architecture audit 均通过。

验证证据（2026-07-15）：共享 move 输入新增 `destinationItems`，可在一次 dry-run/live 调用中为每项指定独立目标目录，仍复用相同复制、移动、冲突和结果详情实现。纯 TS `buildCzkawkaGroupOrganizePlan` 按 fork 行为从任一选中项扩展整组、排除参考项、按“组 + 原父目录”生成目标子目录、支持 `{groupId}` 模板/非法字符清理/跳过单文件来源目录。GUI 相似图片操作卡展示组数、项目数和目标目录数并在确认后发送多目标计划；包级计划/执行测试和 GUI 组件测试覆盖完整链路。

验证证据（2026-07-15）：导出不再依赖 Rust scanner 的 `PrintResults`，由 TypeScript core 对 `CzkawkaEntry` 完整字段生成结构化 JSON 或固定列 CSV；GUI 支持选择项、当前过滤视图、全部结果三种范围，CLI/OpenTUI 使用相同 `exportScope`/`exportEntries` 契约。扩展名修正同样完全由 TS 计划和文件系统原语执行，支持每项不同 `properExtension`、单项/批量、默认 dry-run、`skip`/`overwrite`/`rename`/`error` 冲突策略、逐项源/目标/错误详情，以及 GUI 反向改名撤销提示；CLI 提供 `rename <extension> <paths...>`，OpenTUI 接受 Tab 分隔的路径与扩展名。包级 74 项 Vitest、OpenTUI Bun 测试、GUI 16 项组件测试、应用 typecheck、React Compiler boundary audit 与 node architecture audit 均通过。

验证证据（2026-07-15）：`scan-presets.ts` 以 canonical `CzkawkaInput` 保存扫描配置，不绑定 GUI 控件状态；操作/导出字段在入库前剔除，全部工具专属字段由 `CZKAWKA_TOOL_OPTIONS` 自动双向映射。版本化 JSON 文档支持新建、覆盖、删除、合并/替换导入、导出和格式/大小校验。GUI 活动预设、已应用字段和预设集合写入节点状态，重开节点自动恢复；CLI/OpenTUI 可从相同 config 中的 `scan_presets`/`active_scan_preset_id` 恢复到共享 interaction schema。包级 78 项 Vitest和 GUI 17 项组件测试覆盖 canonical round-trip 与完整管理生命周期。

## 10. 分析、统计和卡片系统

权威来源：`useFormatStats.ts`、`useSimilarityStats.ts`、`views/cards/*`、`card-panel-manager.tsx`、提交 `7b8fcd5` 至 `abb1458`。

| ID | 状态 | 能力 | 验收标准 |
| --- | --- | --- | --- |
| D01 | `[x]` | 基础统计 | 文件数、组数、总大小、预计回收空间 |
| D02 | `[x]` | 格式占比 | donut chart 与数据表一致 |
| D03 | `[x]` | 格式体积分布 | bar chart 与过滤后数据联动 |
| D04 | `[x]` | 相似度分布 | 图片等级/差异区间与归一化视频 hash 距离区间均由共享 TS 分析生成 |
| D05 | `[x]` | 选择统计 | 数量、体积、回收空间实时联动 |
| D06 | `[x]` | 浮动分析面板 | 可移动/缩放且不超出节点卡片可视区域 |
| D07 | `[x]` | 统一卡片注册表 | 设置、预览、分析、日志可由 registry 组合 |
| D08 | `[x]` | 卡片可见/折叠/高度 | 配置持久化 |
| D09 | `[x]` | 卡片拖动排序和跨面板移动 | 键盘/鼠标可访问，顺序持久化 |
| D10 | `[x]` | 日志视图 | 扫描和操作日志可复制、清空、过滤 |

验证证据（2026-07-15）：统计算法位于 `packages/nodes/czkawka/src/analysis.ts`，不依赖 React、GUI 或原生绑定；按扩展名生成数量/体积/双百分比，按 fork 的 8/16/32/64 hash 阈值生成图片相似度等级，并按归一化 VideoHash Hamming 百分比生成视频距离区间，同时直接复用选择助手的回收空间算法。GUI 的 `CzkawkaAnalysisView` 消费当前过滤后的 groups，使用同一数据绘制 CSS conic-gradient 环图、格式体积条、相似度条和实时选择卡；CLI 文本摘要、交互模式结果和 OpenTUI 主要格式卡也调用同一函数。单测覆盖图片和视频两套区间，真实视频 smoke 证明 DTO 同时包含零与非零距离，D04 已完成。

活动日志证据（2026-07-15）：`packages/nodes/czkawka/src/activity-log.ts` 定义与 UI 无关的扫描/进度/操作/系统日志、四级状态、200 条有界历史、过滤、序列化和跨端文本格式。GUI 将扫描开始、所有 progress/log 事件、停止/完成/错误以及删除/移动/导出结果写入节点 `activityLog`，查看器支持按工具/级别/操作/消息过滤、复制全文和清空；CLI 与 OpenTUI 复用同一消息格式化函数。Czkawka 包 46 项 Vitest、1 项 OpenTUI Bun 测试、GUI 日志/节点 11 项测试和 TS 构建通过。

卡片系统证据（2026-07-15）：`packages/nodes/czkawka/src/card-layout.ts` 提供六张卡片的注册表、`source`/`analysis` 面板、版本 1 布局、缺失卡片迁移、可见/折叠/高度边界、顺序与跨面板移动；不依赖 React 或 dnd 库。GUI 的 `CzkawkaCardStack` 实际组合扫描设置、固定预览、统计、日志、选择和文件操作卡片；头部管理器可切换可见性、面板归属和恢复默认布局。卡片原生 drag/drop 支持同面板排序和跨面板移动，同时提供上移/下移按钮；高度 range、折叠标题、管理器操作均具备可访问名称。所有变化同步写入节点 `cardLayout`，纯模型 4 项测试和 GUI/宿主持久化测试覆盖顺序、高度、折叠、隐藏及跨面板拖动。

浮动面板证据（2026-07-15）：`packages/nodes/czkawka/src/floating-panel.ts` 以节点 surface 而非浏览器窗口作为 viewport，纯函数处理默认位置、持久化状态归一化、移动、八方向缩放、正常最小/最大尺寸以及小节点降级。`CzkawkaFloatingAnalysisPanel` 复用 analysis 卡片栈，打开时固定分析列让出空间；标题支持指针拖动和方向键移动，八个可访问 separator 支持缩放，Alt+方向键提供键盘缩放。状态写入 `floatingAnalysisPanel`，节点尺寸缩小时渲染期重新约束；4 项几何测试及 GUI/宿主测试覆盖四边裁剪、东南/西北缩放、小 surface、持久化移动/缩放与关闭。除 D04 的视频距离字段外，M5 其余项目均已完成。

## 11. 布局、设置与桌面体验

权威来源：`app.tsx`、`app-header.tsx`、`app-sidebar.tsx`、`theme-panel.tsx`、`settings.tsx`。

Xiranite 是节点式宿主，不直接复制 fork 的全窗口壳；下列能力需要映射到节点卡片和宿主，而不是再造一层 Tauri 窗口。

| ID | 状态 | 能力 | Xiranite 映射 / 验收标准 |
| --- | --- | --- | --- |
| U01 | `[x]` | 11 工具切换 | full/compact/portrait 在标题栏使用同一个扫描器选择器；collapsed 显示当前工具 |
| U02 | `[x]` | 条件/分析列宽 | 条件和分析面板可调并持久化；不再为扫描器独占一栏 |
| U03 | `[x]` | 可调底部面板 | 条件、设置、日志、助手面板高度可调，双击复位 |
| U04 | `[x]` | 面板最小化/恢复 | 保持结果区可用且状态持久化 |
| U05 | `[x]` | 主题 | 继承 Xiranite 全局主题，不复制 fork 主题引擎 |
| U06 | `[x]` | 自定义背景/模糊/遮罩 | 由宿主主题能力决定；节点自身保持透明层级正确 |
| U07 | `[x]` | 中英文 | 接入 Xiranite i18n；不能硬编码中文业务文案 |
| U08 | `[x]` | 窗口控制 | 完全交给 Xiranite 桌面壳，不迁入节点 |
| U09 | `[x]` | 设置持久化 | 节点 config/state schema 有版本，升级可迁移 |
| U10 | `[x]` | full/compact/collapsed | 三种节点 surface 均可渲染 |
| U11 | `[x]` | 小尺寸可用性 | 无重叠、横向滚动陷阱和不可达操作 |
| U12 | `[x]` | 无障碍 | 键盘焦点、label、tooltip、dialog、menu 基本语义通过 |

中英文证据（2026-07-15）：GUI 主工作区、11 工具、扫描参数、来源编辑、结果表、预览、筛选、相似文件夹、分析、日志、卡片管理、文件操作和选择助手全部接入 `module.czkawka`；工具、结果列、算法字段、排序字段和匹配条件按稳定 ID 翻译，不复制业务枚举。英文组件测试真实切换 Xiranite i18n，覆盖主工作区、完整高级筛选、无扩展名稳定哨兵和选择助手；选择助手成功/错误状态不再依赖中文字符串，共享 TS core 对可翻译目录错误返回稳定 `errorCode`。pipe CLI 支持 `--lang zh|en`，扫描摘要、格式、相似度等级、相似文件夹和操作摘要按语言格式化；OpenTUI 直接消费同一个 `TerminalLanguage` 和 interaction schema，英文整帧测试覆盖工具轨、输入、结果、分析、检查器、空态和媒体元数据，并断言帧内不存在汉字。生产代码汉字审计仅保留 i18n fallback、双语 schema、兼容旧筛选预设的中文哨兵和不直接渲染的稳定 ID 默认标签。

Surface 与无障碍证据（2026-07-15）：`Component.test.tsx` 以 `NODE_SURFACE_TEST_MODES` 实际渲染 collapsed、compact、portrait、regular、expanded、workspace 六种 surface；Czkawka 设计约束固化在 `docs/node-ui-designs/czkawka.md`，UI quality audit 对本节点不再报告 surface/design 警告。`scripts/qa-czkawka.mjs` 通过完整 desktop dev backend 在真实 Chromium 中注入 420×720 portrait 节点，切换相似图片、全选 reference、打开/关闭管理卡片 dialog，并在结果 tab 直接执行键盘焦点和边界测量；脚本验证 document 无横向溢出、surface 的 client/scroll 边界均为 420×720、主扫描按钮完整可见、所有可交互控件均有可访问名称，console error/warning 均为 0。Playwright 先后发现并修复 portrait 主操作裁剪和结果表最小内容宽度向父级传播的问题；最终截图为 `output/playwright/czkawka-portrait-interaction.png`。

布局与迁移证据（2026-07-15）：`CzkawkaWorkspaceLayout` v1 继续兼容旧工具轨道字段，但运行时只消费扫描条件和分析面板宽度及最小化状态；两个桌面 separator 支持指针、方向键、Shift 步进和双击复位，compact/portrait 不应用桌面列宽。卡片栈继续作为条件、设置、日志、助手和操作面板的唯一布局实现，高度滑杆支持双击恢复注册表默认值，折叠状态保持结果区可用。`CzkawkaCardState.schemaVersion` 与迁移补丁会补齐并修复旧状态而不丢失业务字段；纯函数、状态迁移和组件交互测试共覆盖默认值、clamp、持久化、最小化/恢复及双击复位。

宿主映射证据（2026-07-15）：full 与 compact 真实组件测试从标题栏选择器逐一定位 11 个扫描工具，collapsed 保留当前工具、状态和扫描/停止主动作；选择器复用稳定工具 ID，切换后继续隔离结果、筛选、选择、预览和缩略图状态。节点根层从会遮挡工作区的 `bg-background` 修正为 `bg-transparent text-foreground`，主题来源标记直接使用 `host.env.theme`，内部面板只消费 Xiranite 语义色，因此全局主题、自定义背景、模糊和遮罩均由宿主统一控制，不复制 fork 主题引擎。组件测试验证 dark 宿主映射、透明层级且节点内不存在最小化/最大化/关闭窗口动作；窗口控制继续完全属于 Xiranite 桌面壳。

## 12. CLI 与 OpenTUI 对等

| ID | 状态 | 能力 | 验收标准 |
| --- | --- | --- | --- |
| C01 | `[x]` | 11 工具扫描入口 | CLI 可用 tool 名称和别名运行 |
| C02 | `[x]` | 配置文件/交互参数 | 复用统一 input contract |
| C03 | `[x]` | 删除/移动/导出 | 默认 dry-run，`--live` 才真实执行 |
| C04 | `[x]` | 完整工具专属参数 | 与 GUI 的参数模型同源，不手写第二套 |
| C05 | `[x]` | 停止和连续进度 | Ctrl+C 安全取消并打印最终状态 |
| C06 | `[x]` | OpenTUI 11 工具导航 | 键盘与鼠标可切换 |
| C07 | `[x]` | OpenTUI 条件/结果/日志 | 已有基础 tabs；补高级筛选、选择和操作结果 |
| C08 | `[x]` | OpenTUI 预览元数据 | 终端不渲染图片时显示完整媒体信息和可打开操作 |
| C09 | `[x]` | 帮助文档自动生成 | 从统一 schema 生成 GUI label、CLI help、TUI fields |

参数与帮助证据（2026-07-15）：`CZKAWKA_TOOL_OPTIONS` 是 33 个工具专属参数的唯一声明，包含适用工具、双语 label、控件类型、默认值、范围/选项和 CLI flag。GUI 按当前工具从该表渲染控件，OpenTUI/guided mode 从该表生成带 `visibleWhen` 的 interaction fields，pipe CLI 从同一表解析正向/`--no-*` 布尔参数和值参数；`NodeHelp.fields` 及中英文说明也由同一表生成。共享 terminal help renderer 已支持结构化 fields，真实 `xczkawka --help` 会列出重复、图片、视频、音频和损坏文件的全部专属 flag，不再维护第二份帮助清单。测试逐项核对 GUI/TUI field、CLI parser、帮助字段和 33 个 flag 的 round-trip。

OpenTUI 对等证据（2026-07-15）：目录页覆盖包含、reference、排除、线程、递归和缓存，过滤页覆盖排除规则、allowed/excluded 扩展名、大小范围和结果文本，算法页仍由统一 33 参数 schema 动态生成，操作页消费共享 `selectedPathsText` 与安全操作字段。结果工作台提供全部/已选/操作三种视图，鼠标行选择和 Tab+↑↓/jk/Space/a/s/c/o 键盘流；`s` 直接调用共享 `smartSelect`，选择同步回操作 contract。Inspector 提供元数据、逐项操作结果和日志三页，展示路径、分组、大小、修改时间、分辨率、相似度、Hash、reference、音频标签、码率、正确扩展名、状态、目标、冲突和错误；`openPath` 由 TS platform 注入，Windows 使用 `explorer.exe`/`rundll32`，不进入 Rust。3 项真实 OpenTUI Vitest 覆盖 11 工具/条件 tab、媒体结果选择与完整元数据、打开回调、move dry-run 状态/目标/冲突及进度日志。

## 13. 测试与交付门槛

| ID | 状态 | 门槛 |
| --- | --- | --- |
| Q01 | `[x]` | TS core 单测覆盖 normalize、scan、操作、基础智能选择 |
| Q02 | `[x]` | CLI 单测和 OpenTUI Bun 测试 |
| Q03 | `[x]` | GUI 组件测试存在；需按本清单补主要交互 |
| Q04 | `[x]` | `LocalImagePreview` 共享组件成功/失败/禁用测试 |
| Q05 | `[x]` | 11 工具参数 contract → native DTO 映射测试 |
| Q06 | `[x]` | 高级筛选 property tests 或等价覆盖 |
| Q07 | `[x]` | 智能选择规则与历史 property tests 或等价覆盖 |
| Q08 | `[x]` | 真实 Browser GUI：加载、无 overlay、控制台健康、至少一条交互链、截图 |
| Q09 | `[x]` | CLI 真实 smoke：至少 basic、duplicate、media 三类入口 |
| Q10 | `[x]` | debug `.node` 可由 Bun 加载，dav1d DLL 可部署 |
| Q11 | `[x]` | 最终一次 release Node-API 构建、体积记录、Node/Bun smoke |
| Q12 | `[x]` | node architecture/test/React Compiler audits 全通过 |

Q11 验证证据（2026-07-15）：Windows x64 Release `.node` 为 21.32 MiB，`dav1d.dll` 为 1.70 MiB，二者的发布 ZIP 为 8.75 MiB；Bun smoke 返回 API v4 / Czkawka 10.0.0，覆盖 duplicate、basic、image/video media 三类入口，并真实观测 `CollectingFiles` 进度、取消和 session 清理。构建直接复用仓库 `native/vendor/dav1d-windows-x64.zip` 中的开发包，通过 `PKG_CONFIG_PATH` 定位 `dav1d.pc`，不安装 VCPKG；预编译 ZIP 与 SHA-256 manifest 已由 `packages/czkawka-native/prebuilt/win32-x64` 固化，embedded smoke 也成功加载 API v4。

Q05/Q09/Q12 验证证据（2026-07-15）：表驱动测试对 11 个工具分别执行共享 contract 构造、normalize 和对应 duplicate/basic/media native DTO 映射，并逐工具覆盖通用路径/过滤字段及所有专属参数；包级 Node Vitest 为 105 项，OpenTUI Vitest 为 1 项。`packages/nodes/czkawka/scripts/smoke-cli.mjs` 使用真实 release Node-API 和临时文件夹分别运行 `duplicate-files`、`empty-files`、`bad-extensions` 三条 pipe CLI JSON 链路，实测得到 1 个重复组、1 个空文件和 1 个错误扩展名结果。OpenTUI 测试已从 `bun:test` 迁到由 Bun 运行的 Vitest，Czkawka 在 node test matrix 的 core、CLI、app component、real run、Vitest、无 `bun:test` 六列全部通过；node architecture、应用 typecheck 和 React Compiler boundary audit 同时通过。

## 14. 推进顺序

后续实现严格按以下批次推进，每完成一批即更新本清单、运行对应测试并单独提交：

1. **M1：契约和结果表底座** — T01/T03/T06/T07/T08/T10/T11、R01–R14、Q05。
2. **M2：高级筛选** — F01–F16，尽量移植 fork 的 TS 纯逻辑和 property tests。
3. **M3：智能选择助手** — A04–A12，复用 fork 规则管线思想，不复制 Jotai 绑定。
4. **M4：媒体直通与预览** — P01–P10，抽到共享宿主能力后再接入 Czkawka。
5. **M5：文件操作** — O02–O12，全部 TypeScript，保持 dry-run 安全边界。
6. **M6：AST 前端源码迁移与宿主适配** — 先完整复制 fork 前端源码和状态层，再用 AST 改写模块边界；仅在 Tauri/窗口/宿主能力处增加适配层，在此基础上完成 D02–D10、U01–U12。
7. **M7：CLI/TUI 对等和最终交付** — C04–C09、Q03–Q12、release 原生构建。

## 15. 明确不照搬的内容

- Tauri 自定义标题栏、最小化/最大化/关闭按钮：由 Xiranite 桌面壳负责。
- fork 的本地视频 HTTP server：改用 Xiranite 通用本地文件/媒体 URL。
- fork 的 Jotai 状态树先随前端源码完整迁入，作为兼容层保留组件能力；通过单一节点状态桥接器同步 Xiranite config/state，稳定后再按证据决定是否收敛，不手工重写整套组件状态。
- fork 的 Rust 删除、移动、保存、预设逻辑：统一改为 TypeScript。
- fork 的 thumbnail Rust manager：优先共享图片直通；只有性能证据证明必要时才增加通用缓存层。
- fork 的独立主题系统：继承 Xiranite 设计 token 和宿主主题。

## 16. AST 前端源码迁移轨道

用户 fork 的 `ui/src` 是 GUI 功能和视觉结构的权威实现。后续不再以截图重新拼装同名界面，而是把原组件作为主线源码迁移；Xiranite 已有 TypeScript 领域逻辑继续作为 GUI、CLI、OpenTUI 的共享后端。

| ID | 状态 | 工作项 | 验收标准 |
| --- | --- | --- | --- |
| AST01 | `[x]` | 通用前端源码迁移器 | `@xiranite/tauri-migrate frontend` 递归复制 TS/TSX/JS/样式资源，仅通过 AST 改写 import/export module specifier，并输出 JSON/Markdown 报告 |
| AST02 | `[x]` | Czkawka 完整源码快照 | `migration/czkawka/frontend` 由 fork `ui/src` 生成；源码、组件、atoms、hooks、views 和 shadcn 依赖树不靠手抄 |
| AST03 | `[ ]` | Tauri Host adapters | 报告列出的 core/event/window/dialog/opener/clipboard 等边界映射到 Xiranite Host；不得在迁入组件内散改 invoke |
| AST04 | `[ ]` | Jotai 节点状态桥 | fork atoms 保留，统一桥接 `NodeComponentHost` 的 config/state、扫描结果、选择和布局持久化 |
| AST05 | `[ ]` | 原版 App shell 嵌入节点 | 直接复用 `AppSidebar`、`AppBody`、`BottomBar`、Operations、ToolSettings、FilterPanel、SelectionAssistant；仅移除窗口标题栏职责 |
| AST06 | `[ ]` | 共享 TS 后端接线 | `ipc.scan/move/delete/save/rename` 适配到现有 `@xiranite/node-czkawka` 与 Node-API，GUI/CLI/TUI 不维护多套业务逻辑 |
| AST07 | `[ ]` | Playwright 视觉与交互验收 | 以 `migration/czkawka/image.png` 和原项目实际运行结果对照；允许宿主化改良，但所有差异必须是明确决策而非遗漏 |

当前生成命令：

```powershell
bun packages/tauri-migrate/src/cli.ts frontend ../ImageAll/czkawka-tauri/ui/src `
  --out migration/czkawka/frontend `
  --config migration/czkawka/frontend-migration.json `
  --force
```

2026-07-15 首次完整生成结果：224 个源文件、711 处 AST import/export 改写、16 个源文件包含 Tauri 边界、未映射 Tauri import 为 0、未解析 `~/` alias 为 0。生成树包含 fork 自带的 UI primitives，避免相对导入遗漏；已将 `framer-motion` AST 映射到宿主现有的 `motion/react`。`frontend-port.json` 用于机器审计，`REPORT.md` 用于人工检查；后续先完成 AST03/AST04，再把生成树接入编译，避免一边手改组件一边丢失 fork 功能。

## 17. XR 分栏恢复与 AST 功能吸收

2026-07-15 决定不再把 AST 生成树作为第二套运行时前端接入。Czkawka 节点以标题栏扫描器选择器、扫描条件、结果表、分析/操作三栏为唯一 GUI；`migration/czkawka/frontend` 保留为 fork 功能审计快照。

- `[x]` 相似度与 Hash Size 速查表：从共享 `analysis.ts` 阈值生成，GUI 不复制规则。
- `[x]` 反向路径显示：仅改变表格展示，复制、打开、定位、筛选和选择仍使用真实路径。
- `[x]` 表格文字折行：使用统一 72px 虚拟行高和两行截断，保留万级结果虚拟化性能。
- `[x]` 显示偏好写入现有节点状态并提供中英文文案，不引入 fork Jotai 状态树或第二套组件库。
- `[x]` 11 个扫描器收进标题栏选择器，删除独占工具轨道；compact/portrait 使用同一选择器。
- `[x]` 参考路径关键词自动标记：默认 `#compare`，仅对新加入且命中关键词的目录自动设为参考。
- `[x]` 多目录一次选择：桌面 Wails Host 使用原生多选目录；后端降级选择器仍返回其可提供的目录列表。
- `[x]` 重复文件、相似图片、相似视频分别持久化缩略图开关；关闭时移除整列并维持固定虚拟行高。
- `[x]` 缓存高级设置：Core/Node-API v4 支持保存 JSON、清理过期项、自定义缓存/配置路径和 Hash/Prehash 最小缓存大小；GUI、CLI、TUI 共用同一 TS contract。缓存/配置路径由 TS 在首次 native scan 前通过环境变量设置，vendor 的 OnceCell 限制后续修改需重启 backend。
