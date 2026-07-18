/**
 * MarkStatusFilter - 标记状态过滤器
 * 根据文件的标记状态进行过滤
 */

import { useAtom } from 'jotai';
import { filterStateAtom } from '@/nodes/czkawka/upstream/atom/filter-panel';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import type { MarkStatusOption } from '@/nodes/czkawka/upstream/lib/filter-panel/types';

const MARK_STATUS_OPTIONS: { value: MarkStatusOption; labelKey: string }[] = [
  { value: 'marked', labelKey: 'Marked' },
  { value: 'unmarked', labelKey: 'Unmarked' },
  { value: 'groupHasSomeMarked', labelKey: 'Group Has Some Marked' },
  { value: 'groupAllUnmarked', labelKey: 'Group All Unmarked' },
  { value: 'groupSomeNotAll', labelKey: 'Group Some Not All' },
  { value: 'groupAllMarked', labelKey: 'Group All Marked' },
  { value: 'protected', labelKey: 'Protected' },
];

export function MarkStatusFilter() {
  const t = useT();
  const [filterState, setFilterState] = useAtom(filterStateAtom);
  const { markStatus } = filterState;

  const handleOptionChange = (option: MarkStatusOption, checked: boolean) => {
    setFilterState((prev) => {
      const newOptions = checked
        ? [...prev.markStatus.options, option]
        : prev.markStatus.options.filter((o) => o !== option);

      return {
        ...prev,
        markStatus: {
          enabled: newOptions.length > 0,
          options: newOptions,
        },
      };
    });
  };

  return (
    <div className="space-y-2">
      {MARK_STATUS_OPTIONS.map(({ value, labelKey }) => (
        <div key={value} className="flex items-center space-x-2">
          <Checkbox
            id={`mark-status-${value}`}
            checked={markStatus.options.includes(value)}
            onCheckedChange={(checked) =>
              handleOptionChange(value, checked === true)
            }
          />
          <Label
            htmlFor={`mark-status-${value}`}
            className="text-sm cursor-pointer"
          >
            {t(labelKey as any) || labelKey}
          </Label>
        </div>
      ))}
    </div>
  );
}
