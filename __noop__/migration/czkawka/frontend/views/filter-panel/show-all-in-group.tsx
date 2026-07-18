/**
 * ShowAllInGroupToggle - 组内显示所有文件选项
 * 当过滤器激活时，是否显示匹配组中的所有文件
 */

import { useAtom, useAtomValue } from 'jotai';
import { filterStateAtom, isFilterActiveAtom } from '@/nodes/czkawka/upstream/atom/filter-panel';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useT } from '@/nodes/czkawka/upstream/hooks';

export function ShowAllInGroupToggle() {
  const t = useT();
  const [filterState, setFilterState] = useAtom(filterStateAtom);
  const isFilterActive = useAtomValue(isFilterActiveAtom);
  const { showAllInFilteredGroups } = filterState;

  const handleChange = (checked: boolean) => {
    setFilterState((prev) => ({
      ...prev,
      showAllInFilteredGroups: checked,
    }));
  };

  return (
    <div className="flex items-center space-x-2">
      <Checkbox
        id="show-all-in-group"
        checked={showAllInFilteredGroups}
        onCheckedChange={(checked) => handleChange(checked === true)}
        disabled={!isFilterActive}
      />
      <Label
        htmlFor="show-all-in-group"
        className={`text-sm cursor-pointer ${!isFilterActive ? 'text-muted-foreground' : ''}`}
      >
        {t('ShowAllInFilteredGroups' as any) ||
          'Show all files in filtered groups'}
      </Label>
    </div>
  );
}
