import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { currentToolDataAtom } from '@/nodes/czkawka/upstream/atom/tools';
import type { BaseEntry } from '@/nodes/czkawka/upstream/types';

export interface FormatStat {
  format: string;
  count: number;
  size: number;
  percent: number;
}

export function useFormatStats() {
  const data = useAtomValue(currentToolDataAtom) as (BaseEntry & {
    size?: string | number;
    raw?: { size: number };
  })[];

  const stats = useMemo(() => {
    if (!data || data.length === 0) return [];

    const formatMap = new Map<string, { count: number; size: number }>();
    let totalSize = 0;

    for (const item of data) {
      if ('hidden' in item && item.hidden) continue;

      // Extract extension
      const path = item.path || '';
      let ext = 'unknown';

      // 检查是否为目录
      if ('folderName' in item || (item as any).isFolder) {
        ext = 'folder';
      } else {
        const match = path.match(/\.([^.]+)$/);
        ext = (match ? match[1].toLowerCase() : 'unknown').trim() || 'unknown';
      }

      // Get size
      let size = 0;
      if (item.raw && typeof item.raw.size === 'number') {
        size = item.raw.size;
      } else if (typeof item.size === 'number') {
        size = item.size;
      } else if (typeof item.size === 'string') {
        const sizeStr = item.size.toLowerCase();
        const numMatch = sizeStr.match(/[\d.]+/);
        if (numMatch) {
          const num = Number.parseFloat(numMatch[0]);
          if (sizeStr.includes('gb')) size = num * 1024 * 1024 * 1024;
          else if (sizeStr.includes('mb')) size = num * 1024 * 1024;
          else if (sizeStr.includes('kb')) size = num * 1024;
          else size = num;
        }
      }

      const current = formatMap.get(ext) || { count: 0, size: 0 };
      formatMap.set(ext, {
        count: current.count + 1,
        size: current.size + size,
      });
      totalSize += size;
    }

    const result: FormatStat[] = Array.from(formatMap.entries())
      .map(([format, { count, size }]) => ({
        format,
        count,
        size,
        percent: totalSize > 0 ? (size / totalSize) * 100 : 0,
      }))
      .sort((a, b) => b.size - a.size);

    return result;
  }, [data]);

  return stats;
}
