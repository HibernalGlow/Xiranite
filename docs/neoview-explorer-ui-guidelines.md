# NeoView Explorer UI 规范

NeoView 是 Reader Explorer，不是通用文件管理器。前端必须由现有 Xiranite
基础组件组合 Explorer UI，不能让 SVAR、Chonky 或其他完整 File Manager 成为数据或
交互核心。

## 组件组合

- Tree、breadcrumb、menu、dialog 和 command 使用 shadcn/Radix。
- `@dnd-kit` 只用于显式布局编辑和被支持的 item action。
- 可取消的控制面读取使用 TanStack Query；大型 Explorer catalog renderer 使用 React
  Virtuoso。
- 缩略图和页面 asset 继续走 Reader HTTP 与浏览器 `<img>` 主链；前端 store 不保存
  Blob、ImageBitmap、archive bytes 或 file handle。

Tree、breadcrumb、list/grid、context menu 和 preview 可以参考成熟 File Manager 的交互，
但状态必须继续由 NeoView 持有。第三方组件不得引入第二套文件系统、选择、请求、拖拽
或缓存 store。

## Explorer Catalog

前端只消费应用层 DTO，不能取得 `fs.Dirent` 或 archive provider 实例。catalog item 应有
稳定 ID、generation、capability，以及任意 renderer 所需的摘要数据：

```ts
type ExplorerItemKind =
  | "directory"
  | "book"
  | "archive"
  | "library-item"
  | "remote-result";

interface ExplorerItem {
  id: string;
  kind: ExplorerItemKind;
  displayName: string;
  capabilities: readonly ("open" | "preview" | "favorite" | "export")[];
  contentVersion?: string;
}
```

本地目录、CBZ/ZIP、最近阅读、收藏、Everything 结果和未来网络源必须使用同一份
catalog contract：稳定 ID、generation、cursor pagination、selection、focus 和
sort/filter state。Tree、封面网格、详情表和预览只替换 renderer，不能复制 catalog 或
创建独立 store。

## File Presentation

文件条目展示必须由共享 File Presentation resolver 和 renderer/control 驱动。File Card
提供展示基线；History、Bookmark 等虚拟 catalog 默认继承，只把用户明确修改的字段保存为
稀疏 override。当前共享字段包括视图模式、内容预览宽度、缩略图宽度和横幅宽度。

实现必须满足：

- Card 把完整有效 presentation 对象交给共用布局和条目表面，不得重新硬编码行高、列宽或缩略图尺寸。
- 共用尺寸控件同时服务 File Card 和虚拟 catalog；“恢复继承”删除 override 叶子。
- File Card、History Card 和 Bookmark Card 均在“更多 -> 项目尺寸”承载共用控件；共享菜单项必须由同一组件提供，Card 不得复制菜单结构。File Card 的文件系统专属项仍留在自身“更多”菜单中。
- 新共享字段只在共享 schema、resolver、renderer/control 中接线一次，Card 不维护字段白名单。
- 数据源通过 capability 决定 renderer 或动作是否可用；不支持的视图使用文档化映射，不能静默创建另一套布局算法。
- 文件系统导航、目录树、写操作和业务 Card 动作不进入 presentation，也不能因为展示继承而泄漏能力。

规范 TOML、旧 History 格式兼容和冲突优先级见 `docs/neoview-config-format.md`。

## 缓存边界

只有 L3、TTL、pin、dispose 或多个普通 metadata/byte LRU 需要统一时，才评估
`lru-cache`。它必须位于 `ReaderPresentationCache` adapter 后，并使用基于 size 的
admission 和 disposal hook。

不得用它替换 `SolidArchiveCache`、thumbnail context 注册表或
`FolderRepresentativeIndex`。这些组件还负责 singleflight、引用、取消、lease 和
generation invalidation；在出现上述额外缓存需求前，当前 weighted presentation cache
仍是合适的实现。
