import type { Row, Table as TTable } from '@tanstack/react-table';
import { ipc } from '@/nodes/czkawka/upstream/ipc';
import type { BaseEntry, RefEntry } from '@/nodes/czkawka/upstream/types';
import { ContextMenuItem, ContextMenuSeparator } from './shadcn/context-menu';

interface RightClickMenuProps<T> {
  row: Row<T>;
  table: TTable<T>;
}

type GroupedEntry = BaseEntry &
  Partial<RefEntry> & {
    fileName?: string;
    groupId?: number;
    _isGroupEnd?: boolean;
  };

/**
 * 通用右键菜单：选择该组 + 复制路径 + 复制文件
 * 适用于所有带分组的 DataTable 视图
 */
export function GroupedRightClickMenu<T extends GroupedEntry>({
  row,
  table,
}: RightClickMenuProps<T>) {
  const handleSelectGroup = () => {
    const groupId = row.original.groupId;
    if (groupId === undefined) return;
    const allRows = table.getRowModel().rows;
    const groupRows = allRows.filter(
      (r) =>
        r.original.groupId === groupId &&
        !r.original.isRef &&
        !r.original.hidden,
    );
    const newSelection = { ...table.getState().rowSelection };
    groupRows.forEach((r) => {
      newSelection[r.id] = true;
    });
    table.setRowSelection(newSelection);
  };

  const handleDeselectGroup = () => {
    const groupId = row.original.groupId;
    if (groupId === undefined) return;
    const allRows = table.getRowModel().rows;
    const groupRows = allRows.filter(
      (r) =>
        r.original.groupId === groupId &&
        !r.original.isRef &&
        !r.original.hidden,
    );
    const newSelection = { ...table.getState().rowSelection };
    groupRows.forEach((r) => {
      delete newSelection[r.id];
    });
    table.setRowSelection(newSelection);
  };

  const handleCopyPath = () => {
    navigator.clipboard.writeText(row.original.path);
  };

  const handleCopyFileToClipboard = async () => {
    try {
      await ipc.copyFileToClipboard(row.original.path);
    } catch (error) {
      // 回退到复制路径
      await navigator.clipboard.writeText(row.original.path);
    }
  };

  return (
    <>
      <ContextMenuItem onClick={handleSelectGroup}>选中该组</ContextMenuItem>
      <ContextMenuItem onClick={handleDeselectGroup}>
        取消选中该组
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={handleCopyPath}>复制文件路径</ContextMenuItem>
      <ContextMenuItem onClick={handleCopyFileToClipboard}>
        复制文件到剪贴板
      </ContextMenuItem>
    </>
  );
}

// 保持向后兼容，DuplicateFilesRightClickMenu 直接导出 GroupedRightClickMenu
export const DuplicateFilesRightClickMenu = GroupedRightClickMenu;
