# Xlchemy GUI 高还原迁移清单

本清单是 Xlchemy GUI 重构的完成门槛。来源以原项目 `D:/1VSCODE/Projects/ImageAll/Xlchemy/frontend/src` 为准；`ref/node3/xlchemcy` 仅提供视觉参考，不覆盖真实工程功能。相同功能优先逐组件从 Svelte 转换为 React，不重新发明交互。

## 验收规则

- [x] 每个功能同时具备 React 实现、交互测试和“原项目参考图 + 当前节点 UI”对照证据。
- [x] 不因节点化删除原项目功能；确实不适用的应用壳功能必须写明替代位置。
- [x] 使用 Xiranite 已安装的 shadcn 组件，禁止手搓 Tabs、Switch、Select、Checkbox、Progress。
- [x] collapsed / compact / portrait / regular / expanded / workspace 全部可用。
- [x] workspace 宽屏不能压成三条窄栏；主输入区必须拥有最大可用宽度。
- [x] 不以折叠隐藏常用配置；低频配置进入共享配置管理，而不是“更多”菜单。

## 证据台账（未完成视觉列不得关闭任务）

| 区域 | React 实现 | 交互测试 | 对照图 | 当前结论 |
| --- | --- | --- | --- | --- |
| 输入文件表格/文件树 | 已迁移工具栏、拖入、公共根目录、半选/全选、Niko Table、预览、右键、底部执行/取消；picker 后立即读取本地元数据 | `Component.test.tsx` 覆盖六尺寸、原生 picker 持久化、文件夹递归展开、真实大小、列表/树、排序、选择删除和选中执行 | `xlchemy-final-comparison-6.jpg` | 已验收 |
| 输入格式标签 | 官方 `ToggleGroup`，主题 `primary` 选中态，16 种完整格式与顺序；发现层使用同一扩展集合 | GUI 交互测试 + `core.test.ts` 16 格式发现测试 | `xlchemy-final-comparison-6.jpg` | 已验收 |
| 进度与取消 | 官方 `Progress`，原比例统计、真实前后大小、显示项配置、节点内取消 | GUI 主动取消；`platform.test.ts` 真实启动并终止 10 秒子进程；CLI 信号和离线/后端 TUI 均接入取消 | GUI 三联图 + OpenTUI `image-transcode.png` | 已验收 |
| 多彩日志 | 官方 Input/ToggleGroup/Checkbox，INF/WRN/ERR/OK 语义色与三列对齐 | 搜索、级别过滤、复制、清空、计数与两种空态均有交互覆盖 | `xlchemy-final-comparison-6.jpg` | 已验收 |
| 宽屏/窄屏结构 | 宽屏 58/42 可拖拽工作区；compact/portrait 保留完整文件管理 | 六种 surface 渲染测试通过 | `xlchemy-final-comparison-6.jpg` 同图含 portrait/workspace | 已验收 |

最终证据由 `scripts/qa-card.mjs` 为 Xlchemy 生成“原项目截图 + `ref/node3/xlchemcy/2` 原型 + 当前节点矩阵”三联图；当前节点矩阵必须至少包含 portrait 与 workspace。

## 1. 输入文件工作区（必须忠实迁移）

来源：`cards/InputFilesCard.svelte`

- [x] 完整工具栏：添加文件、添加文件夹、清空、移除已完成、删除已选、显示/隐藏原图预览。
- [x] 摘要 Badge：项目总数、总大小、已选数量。
- [x] 排序字段：名称、扩展名、大小、目录。
- [x] 升序/降序切换。
- [x] 列表/文件树使用明确的选中态切换器。
- [x] 列表模式使用真实 Table：批量选择、缩略图、名称、扩展名、大小、目录。
- [x] 表头可排序并显示方向。
- [x] 文件行多选、右键菜单和路径提示。
- [x] 文件树模式保留公共根目录、文件夹展开、层级缩进、文件夹半选/全选、文件数量与聚合大小。
- [x] 文件与文件夹选择会同步到转换输入，而不是仅改变视觉状态。
- [x] 原图缩略图使用 `host.localFiles.getUrl()`，失败时退化为文件图标。
- [x] 空态保留说明、添加文件和添加文件夹两个主动作。
- [x] 运行时底部动作变为主动取消；空输入时禁用转换。
- [x] compact/portrait 不删除文件管理能力，可切换为精简行或底部 Sheet。

## 2. 输入格式过滤（标签式，不改成文本框）

来源：`cards/InputFilterCard.svelte`

- [x] 所有允许格式显示为可点击标签：JXL/JPG/JPEG/JFIF/JIF/JPE/PNG/APNG/GIF/WebP/JP2/BMP/ICO/TIFF/TIF/AVIF 等。
- [x] 启用与排除状态颜色、边框和可访问名称明确。
- [x] 支持键盘切换；不能用自由文本代替格式标签。
- [x] 处理顺序完整：原始、路径升/降序、大小升/降序、随机、顺序。
- [x] 标签状态进入共享 TS input/schema，并实际影响文件发现。

## 3. 进度与主动取消

来源：`cards/ProgressCard.svelte`

- [x] 运行状态标题与待机/运行/完成 Badge。
- [x] 官方 Progress 组件。
- [x] 进度计数、已用时间、ETA 三项统计保持原比例。
- [x] 速度、百分比、当前文件、尺寸变化、摘要、两行原始输出。
- [x] 显示项配置：计数、摘要、ETA、格式、编码器、原始日志。
- [x] GUI、CLI、TUI 都有主动取消，并真正终止子进程。

## 4. 多彩转换日志（不得退化为纯文本）

来源：`cards/ConversionLogCard.svelte`

- [x] 搜索框。
- [x] INF / WRN / ERR / OK 四个彩色级别过滤器。
- [x] 信息、警告、错误、成功使用主题语义色，兼容所有主题。
- [x] 时间、级别、消息三列保持等宽字体与对齐。
- [x] 复制过滤后日志、清空日志。
- [x] 自动滚动开关。
- [x] 显示“过滤后条数 / 总条数”。
- [x] 空日志与无匹配是两个不同空态。

## 5. 数据分析

来源：`cards/DataAnalysisCard.svelte`

- [x] 输入/输出分析是真正的官方 Tabs。
- [x] 节省空间、输出大小、成功计数。
- [x] 输入大小范围、扩展名/目录分布。
- [x] 输出速度、平均耗时、总耗时、格式分布。
- [x] 转换前/后大小条形对比。
- [x] 数据来自真实结果，不能用固定演示值。

## 6. 格式与编码器能力

来源：`cards/OutputFormatCard.svelte` 与原 Go/TS orchestrator。

- [x] JPEG XL、AVIF、JPEG、WebP、PNG、无损 JPEG 转码、JPEG 重建。
- [x] 根据格式显示/隐藏无损、质量、力度，不能展示无效组合。
- [x] JXL：Modular、PNG 回退、完整性校验、标准化开关/时机、智能力度。
- [x] AVIF：AOM/SVT、位深、色度采样、IQ tune。
- [x] JPEG：JPEGLI/libjpeg、渐进式、色度采样。
- [x] 最小格式池与比较策略。
- [x] 编码器不可用时给出具体工具名与修复建议。

## 7. 转换、保存与结果策略

- [x] 线程数支持直接输入、步进与滚轮。
- [x] 同名策略：覆盖、跳过、自动改名。
- [x] 源文件旁/指定目录是明确选中态切换器。
- [x] 指定目录路径选择与校验。
- [x] 保留目录结构。
- [x] 删除原图及“回收站/永久删除”策略；回收站不能伪装成永久删除。
- [x] 保留较大结果、较大时复制原图。
- [x] 危险动作必须确认，预演不写文件。

## 8. 缩小与元数据

- [x] 缩小模式：分辨率、百分比、目标文件大小、最短边、最长边、百万像素。
- [x] 每种模式显示正确参数，不显示无关字段。
- [x] 重采样选项完整并实际传入 ImageMagick。
- [x] 元数据：编码器清除/保留、ExifTool 清除/保留/完全清除/自定义。
- [x] 保留时间戳。
- [x] 自定义参数只进入配置管理，不要求用户每次执行手输。

## 9. 预设、配置与系统状态

- [x] 预设保存完整 output/modify/app 配置，而不是只存格式和质量。
- [x] 新建、应用、更新、删除、导入、导出预设。
- [x] 使用共享 NodeConfigPopover 的保存/恢复/打开/分享流程。
- [x] 工具链状态：cjxl/djxl/avifenc/avifdec/cjpegli/ImageMagick/ExifTool/oxipng。
- [x] CPU、线程与当前编码器状态。
- [x] Help 使用 `packages/nodes/xlchemy/src/help.ts`，GUI/CLI/TUI 共用。

## 10. 布局与视觉完成门槛

- [x] 宽屏：宽输入文件工作区 + 配置工作区 + 不挤压主操作的运行反馈；禁止三个等宽窄栏。
- [x] 中宽：输入与配置两栏，运行反馈并入结果区域。
- [x] 竖屏：输入管理优先，配置与结果按任务顺序纵向排列。
- [x] 所有面板使用主题语义 token，不复制原项目专属颜色变量。
- [x] 控件密度、行高、工具栏比例与原 Svelte 截图相当。
- [x] 最终同图必须同时包含：原项目截图、相关参考图、当前 workspace/portrait UI。
- [x] 若任一关键功能或视觉关系不一致，继续迭代，不得标记完成。

## 当前状态

- [x] 原生 TypeScript 基础发现/计划/编码器运行层已建立。
- [x] pipe/gd/OpenTUI 基础入口已建立。
- [x] React GUI 已通过原项目 + 原型 + 当前 portrait/workspace 三联视觉验收。
- [x] 专项后端能力已补齐：无损 JPEG checksum 重建、最小格式池、真实回收站、子进程取消、自定义参数、RAM 策略、六种缩小与六种元数据策略。

## 最终证据（2026-07-13）

- 类型与测试：全项目 `tsc --noEmit`；Xlchemy 包 38 项；GUI 25 项；Bun/OpenTUI 2 项；OpenTUI 视觉 1 项。
- 实际编码：`scripts/qa-xlchemy-formats.ts` 13/13，包含 AOM、SVT 与 `C:\Windows\System32\slimg_cffi.dll`，所有 AVIF 均由 `avifdec` 解码。
- 无损校验：JPEG → JXL → JPEG 的 SHA-256 均为 `7e4c692c2eaa4f120975bfdd55e7f81f8fcae21c86f49f4d4c13ade4cece5a52`。
- 缩小：`scripts/qa-xlchemy-downscale.ts` 6/6；元数据：`scripts/qa-xlchemy-metadata.ts` 6/6；较大结果：`scripts/qa-xlchemy-larger-output.ts` 2/2。
- 文件策略：`scripts/qa-xlchemy-file-policies.ts` 7/7，覆盖预演不写、目录结构、时间戳、skip、rename、永久删除和 Windows 回收站。
- CLI：构建产物使用 Bun shebang；工具链 13/13；CLI slimg AVIF 实际编码并由 `avifdec` 解码为 64×48、10-bit YUV444。
- TUI：`artifacts/cli/xlchemy/image-transcode.png`；四配置页、Plan/Convert/Diagnose、Help、任务队列和本地/后端取消均可用。
- GUI 三联图：`D:\1Dev\Python\temp\xlchemy-final-comparison-6.jpg`。
