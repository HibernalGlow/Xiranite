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

## 缓存边界

只有 L3、TTL、pin、dispose 或多个普通 metadata/byte LRU 需要统一时，才评估
`lru-cache`。它必须位于 `ReaderPresentationCache` adapter 后，并使用基于 size 的
admission 和 disposal hook。

不得用它替换 `SolidArchiveCache`、thumbnail context 注册表或
`FolderRepresentativeIndex`。这些组件还负责 singleflight、引用、取消、lease 和
generation invalidation；在出现上述额外缓存需求前，当前 weighted presentation cache
仍是合适的实现。
