/**
 * PathFilter - 路径过滤器
 * 根据文件路径进行过滤
 */

import { useAtom } from 'jotai';
import { Settings } from 'lucide-react';
import { useState } from 'react';
import { filterStateAtom } from '@/nodes/czkawka/upstream/atom/filter-panel';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
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
import type { PathMatchMode } from '@/nodes/czkawka/upstream/lib/filter-panel/types';

const PATH_MODES: { value: PathMatchMode; label: string }[] = [
  { value: 'contains', label: 'Contains' },
  { value: 'notContains', label: 'Not contains' },
  { value: 'startsWith', label: 'Starts with' },
  { value: 'endsWith', label: 'Ends with' },
];

export function PathFilter() {
  const t = useT();
  const [filterState, setFilterState] = useAtom(filterStateAtom);
  const { path } = filterState;
  const [open, setOpen] = useState(false);

  const handleEnabledChange = (checked: boolean) => {
    setFilterState((prev) => ({
      ...prev,
      path: { ...prev.path, enabled: checked },
    }));
  };

  const handlePatternChange = (pattern: string) => {
    setFilterState((prev) => ({
      ...prev,
      path: { ...prev.path, pattern },
    }));
  };

  const handleModeChange = (mode: PathMatchMode) => {
    setFilterState((prev) => ({
      ...prev,
      path: { ...prev.path, mode },
    }));
  };

  const handleCaseSensitiveChange = (caseSensitive: boolean) => {
    setFilterState((prev) => ({
      ...prev,
      path: { ...prev.path, caseSensitive },
    }));
  };

  const currentMode = PATH_MODES.find((m) => m.value === path.mode);
  const label = path.pattern
    ? `${t('Path' as any) || 'Path'} ${t(currentMode?.label as any) || currentMode?.label}: "${path.pattern.slice(0, 15)}${path.pattern.length > 15 ? '...' : ''}"`
    : t('Path filter' as any) || 'Path filter';

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-2">
        <Checkbox
          id="path-filter"
          checked={path.enabled}
          onCheckedChange={(checked) => handleEnabledChange(checked === true)}
        />
        <Label
          htmlFor="path-filter"
          className="text-sm cursor-pointer truncate max-w-[200px]"
        >
          {label}
        </Label>
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-6 w-6">
            <Settings className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">
                {t('Match mode' as any) || 'Match mode'}
              </Label>
              <Select
                value={path.mode}
                onValueChange={(v) => handleModeChange(v as PathMatchMode)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PATH_MODES.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>
                      {t(label as any) || label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                {t('Pattern' as any) || 'Pattern'}
              </Label>
              <Input
                value={path.pattern}
                onChange={(e) => handlePatternChange(e.target.value)}
                placeholder={
                  t('Enter path pattern' as any) || 'Enter path pattern'
                }
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="path-case-sensitive"
                checked={path.caseSensitive}
                onCheckedChange={(checked) =>
                  handleCaseSensitiveChange(checked === true)
                }
              />
              <Label htmlFor="path-case-sensitive" className="text-xs">
                {t('CaseSensitive' as any) || 'Case Sensitive'}
              </Label>
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
