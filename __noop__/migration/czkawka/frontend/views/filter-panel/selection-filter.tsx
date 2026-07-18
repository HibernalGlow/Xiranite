/**
 * SelectionFilter - 已选择项过滤器
 * 只显示已选择的项目
 */

import { useAtom, useAtomValue } from 'jotai';
import { filterStateAtom, filterStatsAtom } from '@/nodes/czkawka/upstream/atom/filter-panel';
import { currentToolRowSelectionAtom } from '@/nodes/czkawka/upstream/atom/tools';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useT } from '@/nodes/czkawka/upstream/hooks';

export function SelectionFilter() {
  const t = useT();
  const [filterState, setFilterState] = useAtom(filterStateAtom);
  const selection = useAtomValue(currentToolRowSelectionAtom);
  const stats = useAtomValue(filterStatsAtom);
  const { selectionOnly } = filterState;

  const handleChange = (checked: boolean) => {
    setFilterState((prev) => ({
      ...prev,
      selectionOnly: checked,
    }));
  };

  const selectionCount = selection ? Object.keys(selection).length : 0;

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-2">
        <Checkbox
          id="selection-filter"
          checked={selectionOnly}
          onCheckedChange={(checked) => handleChange(checked === true)}
          disabled={selectionCount === 0}
        />
        <Label
          htmlFor="selection-filter"
          className={`text-sm cursor-pointer ${selectionCount === 0 ? 'text-muted-foreground' : ''}`}
        >
          {t('ShowSelectedOnly' as any) || 'Show Selected Only'}
        </Label>
      </div>

      {selectionCount > 0 && (
        <Badge variant="secondary" className="text-xs">
          {selectionCount}
        </Badge>
      )}
    </div>
  );
}
