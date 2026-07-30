import {
  BookOpen,
  BookmarkPlus,
  ClipboardPaste,
  Copy,
  ExternalLink,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderOutput,
  PanelsTopLeft,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Scissors,
  Settings,
  ShieldAlert,
  Tags,
  Trash2,
  Undo2,
} from "lucide-react"

import type { ContextMenuItemDef } from "@/components/context-menu"
import type {
  ReaderFolderConfirmationConfig,
  ReaderFolderMigrationTarget,
} from "../../../../adapters/reader-http-client"

export interface FolderContextEntry {
  index: number
  path: string
  name: string
  kind: "file" | "directory"
  readerSupported: boolean
}

export type FolderContextAction =
  | "activate"
  | "enter-raw"
  | "new-tab"
  | "open-as-book"
  | "system-open"
  | "reveal"
  | "copy"
  | "cut"
  | "paste"
  | "copy-path"
  | "copy-name"
  | "toggle-bookmark"
  | "edit-metadata"
  | "add-classf-blacklist"
  | "rename"
  | "trash"
  | "delete"
  | "undo-delete"
  | "dissolve"
  | "migrate-picker"
  | "manage-migration-targets"
  | "refresh"
  | "reload-thumbnail"

export function buildFolderContextMenuItems(
  entry: FolderContextEntry,
  options: {
    disabled: boolean
    pending: boolean
    canCopyText: boolean
    canClipboard: boolean
    canPaste: boolean
    canOpenSystem: boolean
    canReveal: boolean
    canOpenAsBook: boolean
    canEnterRawDirectory?: boolean
    canBookmark: boolean
    canRename: boolean
    canTrash: boolean
    canDelete?: boolean
    canUndoDelete?: boolean
    confirmations?: ReaderFolderConfirmationConfig
    canEditMetadata?: boolean
    canRefresh?: boolean
    canReloadThumbnail?: boolean
    canPinTree?: boolean
    canMigrate?: boolean
    canPickMigrationDirectory?: boolean
    canManageMigrationTargets?: boolean
    migrationTargets?: readonly ReaderFolderMigrationTarget[]
    treePinned?: boolean
    onAction(action: FolderContextAction, entry: FolderContextEntry): void | Promise<void>
    onMigrateTarget?(entry: FolderContextEntry, target: ReaderFolderMigrationTarget): void | Promise<void>
    onUndoDelete?(): void | Promise<void>
    onToggleTreePin?(): void
  },
): ContextMenuItemDef[] {
  const unavailable = options.disabled || options.pending
  const primaryAction: FolderContextAction = entry.kind === "file" && !entry.readerSupported ? "system-open" : "activate"
  const trashItem = buildTrashContextMenuItem(entry, {
    disabled: unavailable || !options.canTrash,
    confirm: options.confirmations?.trash ?? false,
    onTrash: () => options.onAction("trash", entry),
  })
  const deleteItem = buildDeleteContextMenuItem(entry, {
    disabled: unavailable || !options.canDelete,
    confirm: options.confirmations?.permanentDelete ?? true,
    onDelete: () => options.onAction("delete", entry),
  })
  const migrationTargets = options.migrationTargets ?? []

  const editIcons: ContextMenuItemDef[] = [
    { id: "neoview-folder-cut", label: "剪切", icon: <Scissors />, disabled: unavailable || !options.canClipboard, onSelect: () => options.onAction("cut", entry) },
    { id: "neoview-folder-copy", label: "复制", icon: <Copy />, disabled: unavailable || !options.canClipboard, onSelect: () => options.onAction("copy", entry) },
    {
      id: "neoview-folder-paste",
      label: entry.kind === "directory" ? "粘贴到此文件夹" : "粘贴到当前文件夹",
      icon: <ClipboardPaste />,
      disabled: unavailable || !options.canPaste,
      onSelect: () => options.onAction("paste", entry),
    },
    trashItem,
    { id: "neoview-folder-rename", label: "重命名", icon: <Pencil />, disabled: unavailable || !options.canRename, onSelect: () => options.onAction("rename", entry) },
  ]

  const openIcons: ContextMenuItemDef[] = []
  if (entry.kind === "directory") {
    openIcons.push(
      { id: "neoview-folder-enter-raw", label: "进入文件夹", icon: <FolderOpen />, disabled: unavailable || !options.canEnterRawDirectory, onSelect: () => options.onAction("enter-raw", entry) },
      { id: "neoview-folder-open-new-tab", label: "在新标签页中打开", icon: <PanelsTopLeft />, disabled: unavailable, onSelect: () => options.onAction("new-tab", entry) },
      { id: "neoview-folder-open-as-book", label: "作为书籍打开", icon: <BookOpen />, disabled: unavailable || !options.canOpenAsBook, onSelect: () => options.onAction("open-as-book", entry) },
    )
  } else {
    openIcons.push(
      { id: "neoview-folder-open", label: "打开", icon: <BookOpen />, disabled: unavailable || (primaryAction === "system-open" && !options.canOpenSystem), onSelect: () => options.onAction(primaryAction, entry) },
      { id: "neoview-folder-system-open", label: "用默认软件打开", icon: <ExternalLink />, disabled: unavailable || !options.canOpenSystem, onSelect: () => options.onAction("system-open", entry) },
    )
  }
  openIcons.push({ id: "neoview-folder-reveal", label: "在资源管理器中显示", icon: <FolderOpen />, disabled: unavailable || !options.canReveal, onSelect: () => options.onAction("reveal", entry) })
  if (options.canUndoDelete) {
    openIcons.push({ id: "neoview-folder-undo-delete", label: "撤销上次删除", icon: <Undo2 />, disabled: unavailable, onSelect: options.onUndoDelete })
  }

  const openMore: ContextMenuItemDef[] = entry.kind === "directory"
    ? [
        { id: "neoview-folder-open", label: "打开", icon: <FolderOpen />, disabled: unavailable, onSelect: () => options.onAction("activate", entry) },
        { id: "neoview-folder-system-open", label: "用默认软件打开", icon: <ExternalLink />, disabled: unavailable || !options.canOpenSystem, onSelect: () => options.onAction("system-open", entry) },
      ]
    : [{ id: "neoview-folder-open-new-tab", label: "在新标签页中打开", icon: <PanelsTopLeft />, disabled: unavailable, onSelect: () => options.onAction("new-tab", entry) }]

  const migrationItems: ContextMenuItemDef[] = [
    ...migrationTargets.map((target) => ({
      id: `neoview-folder-migrate-target-${target.id}`,
      label: target.name,
      title: target.path,
      icon: <Folder />,
      disabled: unavailable,
      onSelect: () => options.onMigrateTarget?.(entry, target),
    } satisfies ContextMenuItemDef)),
    ...(migrationTargets.length ? [{ type: "separator" as const }] : [{ type: "label" as const, label: "暂无常用目录" }]),
    {
      id: "neoview-folder-migrate-picker",
      label: "选择其他目录…",
      icon: <FolderOpen />,
      disabled: unavailable || !options.canPickMigrationDirectory,
      onSelect: () => options.onAction("migrate-picker", entry),
    },
    {
      id: "neoview-folder-migrate-manage",
      label: "管理常用目录…",
      icon: <Settings />,
      disabled: unavailable || !options.canManageMigrationTargets,
      onSelect: () => options.onAction("manage-migration-targets", entry),
    },
  ]

  return [
    { type: "icon-row", id: "neoview-folder-edit-row", label: "编辑", children: editIcons },
    { type: "icon-row", id: "neoview-folder-open-row", label: "打开", children: openIcons },
    { type: "separator" },
    { id: "neoview-folder-toggle-bookmark", label: "添加/移除书签", icon: <BookmarkPlus />, disabled: unavailable || !options.canBookmark, onSelect: () => options.onAction("toggle-bookmark", entry) },
    { id: "neoview-folder-edit-metadata", label: "编辑标签与评分", icon: <Tags />, disabled: unavailable || !options.canEditMetadata, onSelect: () => options.onAction("edit-metadata", entry) },
    { id: "neoview-folder-add-classf-blacklist", label: "加入 ClassF 黑名单", icon: <ShieldAlert />, disabled: unavailable, onSelect: () => options.onAction("add-classf-blacklist", entry) },
    ...(options.canPinTree ? [{
      id: "neoview-folder-pin-tree",
      label: options.treePinned ? "取消置顶（文件树）" : "置顶到文件树",
      icon: options.treePinned ? <PinOff /> : <Pin />,
      disabled: unavailable,
      onSelect: options.onToggleTreePin,
    } satisfies ContextMenuItemDef] : []),
    {
      type: "submenu",
      id: "neoview-folder-migrate",
      label: "迁移到指定目录",
      icon: <FolderOutput />,
      disabled: unavailable || !options.canMigrate,
      children: migrationItems,
    },
    ...(entry.kind === "directory" ? [{
      id: "neoview-folder-dissolve",
      label: "解散当前文件夹",
      icon: <FolderInput />,
      disabled: unavailable,
      confirm: {
        title: "解散当前文件夹？",
        description: `“${entry.name}”中的内容将移到上级目录，随后删除该文件夹。可通过 Dissolvef 操作历史撤销。`,
        confirmLabel: "解散当前文件夹",
        cancelLabel: "取消",
      },
      onSelect: () => options.onAction("dissolve", entry),
    } satisfies ContextMenuItemDef] : []),
    { type: "separator" },
    { type: "submenu", id: "neoview-folder-open-more", label: "打开方式", icon: <ExternalLink />, children: openMore },
    {
      type: "submenu",
      id: "neoview-folder-copy-info",
      label: "复制信息",
      icon: <Copy />,
      children: [
        { id: "neoview-folder-copy-path", label: "复制路径", icon: <Copy />, disabled: unavailable || !options.canCopyText, onSelect: () => options.onAction("copy-path", entry) },
        { id: "neoview-folder-copy-name", label: "复制名称", icon: <FileText />, disabled: unavailable || !options.canCopyText, onSelect: () => options.onAction("copy-name", entry) },
      ],
    },
    { id: "neoview-folder-refresh", label: "刷新当前目录", icon: <RefreshCw />, disabled: unavailable || !options.canRefresh, onSelect: () => options.onAction("refresh", entry) },
    { id: "neoview-folder-reload-thumbnail", label: "重载缩略图", icon: <RefreshCw />, disabled: unavailable || !options.canReloadThumbnail, onSelect: () => options.onAction("reload-thumbnail", entry) },
    deleteItem,
    { type: "separator" },
    { id: "neoview-folder-entry-name", type: "label", label: entry.name },
  ]
}

export function findFolderContextMenuItem(items: readonly ContextMenuItemDef[], id: string): ContextMenuItemDef | undefined {
  for (const item of items) {
    if (item.id === id) return item
    if (item.children?.length) {
      const nested = findFolderContextMenuItem(item.children, id)
      if (nested) return nested
    }
  }
  return undefined
}

export function buildTrashContextMenuItem(
  entry: FolderContextEntry,
  options: { disabled: boolean; confirm?: boolean; onTrash(): void | Promise<void> },
): ContextMenuItemDef {
  return {
    id: "neoview-folder-trash",
    label: "移到回收站",
    icon: <Trash2 />,
    destructive: true,
    disabled: options.disabled,
    ...(options.confirm === false ? {} : { confirm: {
      title: "移到回收站？",
      description: `“${entry.name}”将移到系统回收站。NeoView 无法直接撤销此操作。`,
      confirmLabel: "移到回收站",
      cancelLabel: "取消",
    } }),
    onSelect: options.onTrash,
  }
}

export function buildDeleteContextMenuItem(
  entry: FolderContextEntry,
  options: { disabled: boolean; confirm?: boolean; onDelete(): void | Promise<void> },
): ContextMenuItemDef {
  return {
    id: "neoview-folder-delete",
    label: "永久删除",
    icon: <Trash2 />,
    destructive: true,
    disabled: options.disabled,
    ...(options.confirm === false ? {} : { confirm: {
      title: "永久删除？",
      description: `“${entry.name}”将被永久删除，无法从回收站恢复。`,
      confirmLabel: "永久删除",
      cancelLabel: "取消",
    } }),
    onSelect: options.onDelete,
  }
}
