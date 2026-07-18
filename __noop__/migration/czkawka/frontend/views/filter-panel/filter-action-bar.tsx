/**
 * FilterActionBar - 过滤器操作栏
 * 提供刷新和清除过滤器功能
 */

import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { RefreshCw, X } from 'lucide-react';
import {
  activeFilterCountAtom,
  filterStateAtom,
  isFilterActiveAtom,
} from '@/nodes/czkawka/upstream/atom/filter-panel';
import { Button } from '@/components/ui/button';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import { defaultFilterState } from '@/nodes/czkawka/upstream/lib/filter-panel/presets';

export function FilterActionBar() {
  const t = useT();
  const setFilterState = useSetAtom(filterStateAtom);
  const isFilterActive = useAtomValue(isFilterActiveAtom);
  const activeFilterCount = useAtomValue(activeFilterCountAtom);

  // 清除所有过滤器
  const handleClear = () => {
    setFilterState(defaultFilterState);
  };

  // 刷新过滤器（重新应用当前过滤条件）
  const handleRefresh = () => {
    // 触发重新计算，通过设置相同状态
    setFilterState((prev) => ({ ...prev }));
  };

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          className="h-7"
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1" />
          {t('Refresh' as any) || 'Refresh'}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={handleClear}
          disabled={!isFilterActive}
          className="h-7"
        >
          <X className="h-3.5 w-3.5 mr-1" />
          {t('ClearFilters' as any) || 'Clear'}
        </Button>
      </div>

      {isFilterActive && (
        <span className="text-xs text-muted-foreground">
          {activeFilterCount} {t('ActiveFilters' as any) || 'active'}
        </span>
      )}
    </div>
  );
}
