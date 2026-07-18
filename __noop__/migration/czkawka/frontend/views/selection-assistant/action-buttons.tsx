/**
 * 操作按钮组件
 * 包含清空选择、反选等全局操作
 */

import { useAtomValue, useSetAtom } from 'jotai';
import { RotateCcw, ToggleLeft } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import {
  clearAllSelectionAtom,
  currentSelectionAtom,
  invertSelectionAtom,
} from '@/nodes/czkawka/upstream/atom/selection-assistant';
import { currentToolFilteredDataAtom } from '@/nodes/czkawka/upstream/atom/tools';
import { Button } from '@/components/ui/button';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import type { BaseEntry, RefEntry } from '@/nodes/czkawka/upstream/types';

export function ActionButtons() {
  const t = useT();
  const currentSelection = useAtomValue(currentSelectionAtom);
  const filteredData = useAtomValue(currentToolFilteredDataAtom);
  const [, clearAll] = [null, useSetAtom(clearAllSelectionAtom)];
  const [, invert] = [null, useSetAtom(invertSelectionAtom)];

  // 计算选中数量
  const selectedCount = useMemo(() => {
    return Object.keys(currentSelection).filter((k) => currentSelection[k])
      .length;
  }, [currentSelection]);

  // 总数量 (反映过滤后的)
  const totalCount = filteredData.length;

  // 清空所有选择
  const handleClearAll = useCallback(() => {
    clearAll();
  }, [clearAll]);

  // 反选
  const handleInvert = useCallback(() => {
    const data = filteredData as (BaseEntry & Partial<RefEntry>)[];
    const allPaths = data.map((item) => item.path);
    invert(allPaths);
  }, [filteredData, invert]);

  return (
    <div className="space-y-2">
      {/* 选择统计 */}
      <div className="text-xs text-muted-foreground text-center">
        {t('Selected')}: {selectedCount} / {totalCount}
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={selectedCount === 0}
          onClick={handleClearAll}
        >
          <RotateCcw className="h-3 w-3 mr-1" />
          {t('Clear all')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={totalCount === 0}
          onClick={handleInvert}
        >
          <ToggleLeft className="h-3 w-3 mr-1" />
          {t('Invert selection')}
        </Button>
      </div>
    </div>
  );
}
