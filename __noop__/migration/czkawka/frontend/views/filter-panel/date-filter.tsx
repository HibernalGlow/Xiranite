/**
 * DateFilter - 日期过滤器
 * 根据文件修改日期进行过滤
 */

import { useAtom } from 'jotai';
import { Settings } from 'lucide-react';
import { useState } from 'react';
import { filterStateAtom } from '@/nodes/czkawka/upstream/atom/filter-panel';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import type { DatePreset } from '@/nodes/czkawka/upstream/lib/filter-panel/types';

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'last7days', label: 'Last 7 days' },
  { value: 'last30days', label: 'Last 30 days' },
  { value: 'lastYear', label: 'Last year' },
  { value: 'custom', label: 'Custom' },
];

export function DateFilter() {
  const t = useT();
  const [filterState, setFilterState] = useAtom(filterStateAtom);
  const { modifiedDate } = filterState;
  const [open, setOpen] = useState(false);

  const handleEnabledChange = (checked: boolean) => {
    setFilterState((prev) => ({
      ...prev,
      modifiedDate: { ...prev.modifiedDate, enabled: checked },
    }));
  };

  const handlePresetChange = (preset: DatePreset) => {
    setFilterState((prev) => ({
      ...prev,
      modifiedDate: { ...prev.modifiedDate, preset },
    }));
  };

  const currentPreset = DATE_PRESETS.find(
    (p) => p.value === modifiedDate.preset,
  );
  const label =
    modifiedDate.enabled && currentPreset
      ? `${t('Modified date' as any) || 'Modified date'}: ${t(currentPreset.label as any) || currentPreset.label}`
      : t('Date filter' as any) || 'Date filter';

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-2">
        <Checkbox
          id="date-filter"
          checked={modifiedDate.enabled}
          onCheckedChange={(checked) => handleEnabledChange(checked === true)}
        />
        <Label htmlFor="date-filter" className="text-sm cursor-pointer">
          {label}
        </Label>
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-6 w-6">
            <Settings className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">
                {t('Date range' as any) || 'Date range'}
              </Label>
              <Select
                value={modifiedDate.preset}
                onValueChange={(v) => handlePresetChange(v as DatePreset)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATE_PRESETS.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>
                      {t(label as any) || label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setOpen(false)}>
                {t('Done' as any) || 'Done'}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
