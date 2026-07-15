import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { currentToolAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { settingsAtom } from '@/nodes/czkawka/upstream/atom/settings';
import { currentToolDataAtom, currentToolRowSelectionAtom } from '@/nodes/czkawka/upstream/atom/tools';
import type { BaseEntry } from '@/nodes/czkawka/upstream/types';

export interface SelectionStats {
  count: number;
  totalSize: number;
  formats: string[];
  deleteMode: 'trash' | 'permanent';
}

/**
 * 获取当前工具的文件选中统计信息
 */
export function useTableSelectionStats(): SelectionStats | null {
  const currentTool = useAtomValue(currentToolAtom);
  const settings = useAtomValue(settingsAtom);
  const data = useAtomValue(currentToolDataAtom) as BaseEntry[];
  const rowSelection = useAtomValue(currentToolRowSelectionAtom);

  const stats = useMemo(() => {
    if (!data?.length || !Object.keys(rowSelection).length) {
      return null;
    }

    // 获取选中的文件
    const selectedItems = data.filter(
      (item, index) => rowSelection[item.path] || rowSelection[index],
    );

    if (!selectedItems.length) {
      return null;
    }

    // 计算总大小
    const totalSize = selectedItems.reduce((sum, item) => {
      // 尝试从不同的属性中获取文件大小
      const size =
        ('size' in item ? item.size : 0) ||
        ('fileSize' in item ? item.fileSize : 0) ||
        0;

      // 处理字符串格式的大小（如 "1.5 MB"）
      if (typeof size === 'string') {
        const sizeStr = size.toLowerCase();
        const numMatch = sizeStr.match(/[\d.]+/);
        if (!numMatch) return sum;

        const num = Number.parseFloat(numMatch[0]);
        if (sizeStr.includes('gb')) return sum + num * 1024 * 1024 * 1024;
        if (sizeStr.includes('mb')) return sum + num * 1024 * 1024;
        if (sizeStr.includes('kb')) return sum + num * 1024;
        return sum + num;
      }

      return sum + (typeof size === 'number' ? size : 0);
    }, 0);

    // 提取文件格式（不限制数量）
    const formats = Array.from(
      new Set(
        selectedItems
          .map((item) => {
            // 从文件名或路径中提取扩展名
            const fileName =
              ('fileName' in item ? String(item.fileName) : '') ||
              ('name' in item ? String(item.name) : '') ||
              String(item.path);
            const match = fileName.match(/\.([^.]+)$/);
            return match ? match[1].toLowerCase() : '';
          })
          .filter(Boolean),
      ),
    );

    return {
      count: selectedItems.length,
      totalSize,
      formats,
      deleteMode: settings.moveDeletedFilesToTrash
        ? ('trash' as const)
        : ('permanent' as const),
    };
  }, [data, rowSelection, settings.moveDeletedFilesToTrash]);

  return stats;
}
