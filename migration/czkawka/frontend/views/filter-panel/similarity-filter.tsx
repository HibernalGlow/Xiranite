/**
 * SimilarityFilter - 相似度过滤器
 * 根据相似度进行过滤（仅相似图片/视频工具）
 */

import { useAtom, useAtomValue } from 'jotai';
import { Settings } from 'lucide-react';
import { useState } from 'react';
import { filterStateAtom } from '@/nodes/czkawka/upstream/atom/filter-panel';
import { currentToolAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Tools } from '@/nodes/czkawka/upstream/consts';
import { useT } from '@/nodes/czkawka/upstream/hooks';

export function SimilarityFilter() {
  const t = useT();
  const [filterState, setFilterState] = useAtom(filterStateAtom);
  const currentTool = useAtomValue(currentToolAtom);
  const { similarity } = filterState;
  const [open, setOpen] = useState(false);

  // 只在相似图片/视频工具中显示
  if (
    currentTool !== Tools.SimilarImages &&
    currentTool !== Tools.SimilarVideos
  ) {
    return null;
  }

  const handleEnabledChange = (checked: boolean) => {
    setFilterState((prev) => ({
      ...prev,
      similarity: { ...prev.similarity, enabled: checked },
    }));
  };

  const handleRangeChange = (values: number[]) => {
    setFilterState((prev) => ({
      ...prev,
      similarity: { ...prev.similarity, min: values[0], max: values[1] },
    }));
  };

  const label = `${t('Similarity' as any) || 'Similarity'}: ${similarity.min}% - ${similarity.max}%`;

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-2">
        <Checkbox
          id="similarity-filter"
          checked={similarity.enabled}
          onCheckedChange={(checked) => handleEnabledChange(checked === true)}
        />
        <Label htmlFor="similarity-filter" className="text-sm cursor-pointer">
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
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span>
                  {t('Min' as any) || 'Min'}: {similarity.min}%
                </span>
                <span>
                  {t('Max' as any) || 'Max'}: {similarity.max}%
                </span>
              </div>
              <Slider
                value={[similarity.min, similarity.max]}
                onValueChange={handleRangeChange}
                min={0}
                max={100}
                step={1}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => handleRangeChange([90, 100])}
              >
                {t('High' as any) || 'High'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => handleRangeChange([70, 90])}
              >
                {t('Medium' as any) || 'Medium'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => handleRangeChange([0, 70])}
              >
                {t('Low' as any) || 'Low'}
              </Button>
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
