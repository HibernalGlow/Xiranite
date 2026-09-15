import type { ReaderDirectorySortFieldDto } from "../../../../adapters/reader-http-client"

/**
 * ClipM 临时屏蔽开关（NeoView 侧）。
 *
 * 背景：clipm 节点已在 `xiranite.build.toml` 的 `[nodes].disabled` 中临时禁用，
 * 因此 NeoView 不得再向该节点发起评分 RPC，也不再展示 ClipM 列、排序、徽标与评分入口。
 *
 * 本开关集中登记所有屏蔽点，实现代码全部保留、未删除任何 ClipM 能力：
 *  - `FolderClipmContext.tsx`                 徽标与内联评分器不再渲染
 *  - `useFolderClipmController.tsx`           不再请求目录评分，也不再打开单本评分
 *  - `FolderDislikedTrashMenuItem.tsx`        「将评分为 N 的项目移到回收站」入口下线
 *  - `FolderDetailsView.tsx`                  详情表不再注册 ClipM 列
 *  - `FolderBrowserPaneView.tsx`              排序字段不再提供 CM 评分
 *  - `search/folderSearchModel.ts`            搜索面板默认排序回退中不再包含 CM 评分
 *  - `packages/nodes/neoview/src/platform.ts` 不再创建默认 ClipM 评分 provider
 *    （原实现保留在 `.../platform/clipm/PlatformReaderDirectoryClipmScoreProvider.ts` 末尾的注释块）
 *
 * 恢复步骤：
 *  1. 从 `xiranite.build.toml` 的 `[nodes].disabled` 移除 `"clipm"`，重跑 `bun run generate:node-registries`；
 *  2. 把此处改回 `true`，并移除 ClipM 测试文件中的 skip 守卫。
 */
export const FOLDER_CLIPM_ENABLED = false

/**
 * 屏蔽期间从目录排序字段中隐藏 CM 评分。
 * 已被持久化的 cmRating 排序规则继续按文件名评分生效，不改写用户布局数据。
 */
export function visibleFolderSortFields(
  fields: readonly ReaderDirectorySortFieldDto[],
): readonly ReaderDirectorySortFieldDto[]
export function visibleFolderSortFields(
  fields: readonly ReaderDirectorySortFieldDto[] | undefined,
): readonly ReaderDirectorySortFieldDto[] | undefined
export function visibleFolderSortFields(
  fields: readonly ReaderDirectorySortFieldDto[] | undefined,
): readonly ReaderDirectorySortFieldDto[] | undefined {
  return FOLDER_CLIPM_ENABLED || !fields ? fields : fields.filter((field) => field !== "cmRating")
}
