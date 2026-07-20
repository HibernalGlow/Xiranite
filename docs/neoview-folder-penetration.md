# NeoView 文件夹穿透模式设计

## 目标

穿透模式用于把目录条目解析为可直接阅读的终点，同时保留正常进入目录的能力。它不得改变 File Card 的基本边界：普通 list/grid/details 始终只显示当前目录直接子项，Folder Tree 独立，穿透只影响条目激活和连续阅读目标解析。

穿透模式必须拆成三个独立层次：

1. `ReaderFolderPenetrationResolver`：解析单个目录能否直接打开。
2. `ReaderHierarchicalBookTraversal`：定义上一本/下一本在目录层级中的顺序。
3. Reader 页面边界：最后一页是否调用下一本，第一页是否调用上一本。

任何一层都不得复用递归搜索结果代替自己的状态机。

## 旧版行为与问题

旧版提供：

- 标签级穿透开关。
- 最大深度 `1/2/3/5/10/无限`，默认 3。
- 内部压缩包显示 `none/penetrate/always`。
- 内部压缩包范围 `single/all`。
- 纯媒体文件夹直接作为书籍打开。
- 单击穿透，普通目录导航作为失败回退。

旧实现存在以下结构性问题：

- 点击穿透和文件夹条目提示分别扫描目录，判定规则不同。
- 辅助文件扩展名函数没有真正用于递归解析。
- “纯媒体”只检查无子目录、无压缩包且存在任意文件，纯 JSON/TXT 目录会误判。
- 每个可见文件夹条目独立发起异步 `browseDirectory`，没有统一 Abort、singleflight、generation 或 watcher 失效。
- 标签开关、全局 localStorage 设置、History/Bookmark 设置分散在多套 store。
- “无限”只是 99，没有 canonical path 循环检测；Windows junction 可循环。
- 穿透 Reader 资源和 File Card browser session 所有权混合，删除路径前需要 UI 手动关闭书籍和清缓存。
- 在穿透模式中，上一本/下一本把“可解析目录”当书籍，却可能跳过包含多个项目的普通目录。

迁移不得复制这些实现，只保留用户可见语义。

## 统一解析规则

解析输入为一个目录路径、一份策略和 `AbortSignal`。输出必须包含原始入口、终点、经过的目录链和明确原因。

```ts
type ReaderFolderPenetrationResolution = {
  status: "resolved" | "branch" | "empty" | "blocked"
  originPath: string
  terminal?: {
    kind: "archive" | "document" | "media-directory" | "file"
    path: string
  }
  chain: Array<{
    path: string
    canonicalPath: string
    ignoredSidecars: number
  }>
  reason:
    | "archive"
    | "document"
    | "media-directory"
    | "multiple-primary-items"
    | "empty"
    | "depth-limit"
    | "cycle"
    | "permission"
    | "unsupported-content"
}
```

每一层按以下顺序分类：

1. 目录。
2. Reader 支持的压缩包或文档。
3. Reader 支持的图片/视频。
4. 明确的辅助文件，例如字幕、NFO、日志、URL 和元数据。
5. 其他阻塞文件。

解析规则：

- 无目录、无压缩包且至少有一个媒体文件，其他文件均为辅助文件：当前目录是 `media-directory`。
- 无目录且恰好一个压缩包/文档，其他文件均为媒体封面或辅助文件：解析为该文件。
- 恰好一个子目录、无压缩包/文档和阻塞文件：进入该子目录继续解析。该层媒体文件按封面/辅助资源处理。
- 多个压缩包、多个子目录、目录与压缩包混合、存在阻塞文件：返回 `branch`，不得猜测目标。
- 空目录返回 `empty`。
- 权限、循环、取消和深度上限返回明确状态；取消必须抛出 AbortError，不得降级成普通分支。

`single/all` 只控制内部压缩包提示的显示范围。多个候选永远不能因 `all` 而自动选择其中一个。

## 点击与键盘

正常模式：

- 单击文件夹：进入文件夹。
- 单击文件：打开文件。

穿透模式：

- 单击可穿透文件夹：打开解析终点。
- 单击不可穿透文件夹：进入文件夹。
- 双击任何文件夹：强制进入原文件夹，绕过穿透。
- `Enter`：执行智能穿透。
- `Alt+Enter` 或 `ArrowRight`：进入原文件夹。
- 右键菜单必须提供“进入此文件夹”。
- Ctrl/Meta/Shift 和显式多选模式只改变选择，不触发打开。

浏览器必须区分 click 与 double-click。第一次点击启动预解析但延迟提交；同一路径第二次点击在系统双击间隔内到达时，取消预解析并进入原文件夹。协调器位于 BrowserPane，不得放在可能被虚拟化卸载的行组件中。请求身份绑定 `path + browser generation`。双击的第二次 `click` 不得再次启动解析；`dblclick` 提交原目录导航后，任何迟到的解析结果都必须因请求身份失效而丢弃。

触屏不依赖双击；目录条目保留明确的“进入文件夹”按钮或上下文菜单。

## 上一本、下一本与翻页

“穿透解析”和“连续阅读顺序”必须分离。不可穿透目录是分支节点，不是失败，也不能静默跳过。

连续阅读采用按当前排序的懒加载深度优先遍历：

```text
root
|- A/ -> book-a.cbz
|- B/
|  |- book-b1.cbz
|  `- book-b2.cbz
`- C/ -> nested/ -> book-c.cbz

顺序：A/book-a -> B/book-b1 -> B/book-b2 -> C/nested/book-c
```

- 可穿透目录作为一个原子书籍目标。
- 不可穿透目录 push 一个目录帧并继续查找第一个目标。
- 分支耗尽后 pop，继续父目录的下一个条目。
- 空目录跳过并计入摘要。
- 权限错误默认暂停并提示“重试/跳过”，不得静默丢失目录。
- 上一本优先使用实际访问历史；超过历史后执行反向层级遍历。
- 每个帧保存目录路径、generation、排序描述和当前稳定 entry path，不能只保存 index。

```ts
type ReaderBookTraversalFrame = {
  directoryPath: string
  generation: number
  sort: ReaderDirectorySort
  currentEntryPath: string
}
```

页面翻页仍只改变当前书籍页码。到边界时根据设置处理：

- `stop`：停在最后/第一页。
- `loop-book`：当前书内循环。
- `continue-book`：调用层级遍历器。

下一本默认恢复已保存进度，否则第一页；上一本默认打开最后一页。跨书切换必须先成功创建新 Reader session，再更新 File Card 焦点并释放旧 session。失败时保持当前页面和目录状态。

## File Card 状态

穿透终点和用户点击的外层条目必须分别记录：

```ts
type ReaderActivationProvenance = {
  terminalPath: string
  browserOriginPath: string
  browserOriginEntryPath: string
}
```

Reader 打开深层终点时，File Card 保持在 `browserOriginPath` 并选中 `browserOriginEntryPath`，不能因 Reader `sourcePath` 变化自动导航到深层目录。

穿透开关是标签运行状态；默认策略持久化到 TOML。History、Bookmark 和 Search 可以调用相同 resolver，但不得创建自己的穿透 store 或伪造文件夹标签。

## 配置

```toml
[nodes.neoview.folder.penetration]
default_mode = "off"
max_depth = 3
follow_links = false
terminal_targets = ["archive", "document", "media_directory"]
sidecar_policy = "reader"
show_internal_archives = "when_enabled"
internal_archive_scope = "single"
pure_media_action = "open_book"

[nodes.neoview.navigation]
page_boundary = "stop"
traversal_scope = "current_directory"
previous_book_position = "last_page"
next_book_position = "saved_or_first"
```

标签状态仅保存 `penetrationOverride = inherit/off/on`。旧 localStorage 在一次性迁移后必须删除，不能长期双写。

## 性能与生命周期

- Resolver 最多读取 `maxDepth + 1` 个单层目录，不使用递归搜索结果。
- “无限”在 UI 中显示，但后端硬限制为 32 层。
- canonical path visited-set 防止 symlink/junction 循环；默认不跟随链接。
- 单项点击为高优先级解析。
- 可见提示使用最多 64 项的批量 describe，并发最多 4；不可为每个 React 行创建独立扫描状态机。
- 解析结果使用 canonical root + policy hash 的 LRU/singleflight 缓存。
- watcher 只失效受影响路径和祖先链。
- 滚出视口、切标签、关闭 Card、策略变化时 Abort。
- browser session 拥有目录 listing；Reader session 拥有打开终点。删除路径由应用服务协调资源释放，不由 UI 清 PageManager cache。

## API 与共享入口

建议接口：

- `POST /reader/browser/s/:sessionId/penetration/resolve`：单项高优先级解析。
- `POST /reader/browser/s/:sessionId/penetration/describe`：可见项批量提示，最多 64 项。
- Headless/CLI/TUI 调用同一 application service。

CLI/TUI 至少提供解析、策略查看和层级 next/previous 命令。GUI 不得成为唯一实现。

## 验收矩阵

必须覆盖：

- 唯一压缩包、唯一文档、纯图片、图片与字幕、视频与字幕。
- 只有 JSON/TXT/NFO 的目录不得视为纯媒体。
- 唯一目录链与封面/辅助文件共存。
- 多压缩包、多目录、压缩包与目录混合。
- 精确深度边界、32 层硬上限。
- Windows junction、symlink 循环和大小写路径身份。
- 权限错误、空目录、取消、策略变化和 watcher 失效。
- 单击穿透、双击进入、Enter、Alt+Enter、右键进入、多选排除。
- 当前标签和新标签打开优先级。
- 上/下一本跨可穿透目录和普通分支均不漏项。
- 最后一页连续到下一本、第一页返回上一本最后一页。
- File Card browser session、滚动、选择和缩略图身份不重挂。
- desktop 与 420x360 Chromium、CLI、TUI。

只有 resolver、遍历、配置、GUI、CLI/TUI、两视口和资源生命周期全部闭环后，`folder.penetrate.*` 才能标记 complete。
