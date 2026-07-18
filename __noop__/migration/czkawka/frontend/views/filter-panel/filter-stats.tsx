/**
 * FilterStats - 过滤统计信息
 * 显示过滤前后的项目数量和大小
 */

import { useAtomValue } from 'jotai';
import { filterStatsAtom, isFilterActiveAtom } from '@/nodes/czkawka/upstream/atom/filter-panel';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import { formatBytes } from '@/nodes/czkawka/upstream/lib/filter-panel/utils';

export function FilterStats() {
  const t = useT();
  const stats = useAtomValue(filterStatsAtom);
  const isFilterActive = useAtomValue(isFilterActiveAtom);

  if (!isFilterActive) {
    return (
      <div className="text-xs text-muted-foreground">
        {stats.totalItems} {t('Items' as any) || 'items'} • {stats.totalGroups}{' '}
        {t('Groups' as any) || 'groups'}
      </div>
    );
  }

  return (
    <div className="text-xs space-y-1">
      <div className="flex justify-between">
        <span className="text-muted-foreground">
          {t('Items' as any) || 'Items'}:
        </span>
        <span>
          <span className="text-primary font-medium">
            {stats.filteredItems}
          </span>
          <span className="text-muted-foreground"> / {stats.totalItems}</span>
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">
          {t('Groups' as any) || 'Groups'}:
        </span>
        <span>
          <span className="text-primary font-medium">
            {stats.filteredGroups}
          </span>
          <span className="text-muted-foreground"> / {stats.totalGroups}</span>
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">
          {t('Size' as any) || 'Size'}:
        </span>
        <span>
          <span className="text-primary font-medium">
            {formatBytes(stats.filteredSize)}
          </span>
          <span className="text-muted-foreground">
            {' '}
            / {formatBytes(stats.totalSize)}
          </span>
        </span>
      </div>
    </div>
  );
}
