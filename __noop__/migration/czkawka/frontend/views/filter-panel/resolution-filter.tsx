/**
 * ResolutionFilter - 分辨率过滤器
 * 根据图片/视频分辨率进行过滤
 */

import { useAtom, useAtomValue } from 'jotai';
import { Settings } from 'lucide-react';
import { useState } from 'react';
import { filterStateAtom } from '@/nodes/czkawka/upstream/atom/filter-panel';
import { currentToolAtom } from '@/nodes/czkawka/upstream/atom/primitive';
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
import { Tools } from '@/nodes/czkawka/upstream/consts';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import type { AspectRatioType } from '@/nodes/czkawka/upstream/lib/filter-panel/types';

export function ResolutionFilter() {
  const t = useT();
  const [filterState, setFilterState] = useAtom(filterStateAtom);
  const currentTool = useAtomValue(currentToolAtom);
  const { resolution } = filterState;
  const [open, setOpen] = useState(false);

  // 只在图片/视频工具中显示
  const imageVideoTools: string[] = [Tools.SimilarImages, Tools.SimilarVideos];
  if (!imageVideoTools.includes(currentTool)) {
    return null;
  }

  const handleEnabledChange = (checked: boolean) => {
    setFilterState((prev) => ({
      ...prev,
      resolution: { ...prev.resolution, enabled: checked },
    }));
  };

  const handleMinWidthChange = (value: string) => {
    const num = Number.parseInt(value, 10);
    setFilterState((prev) => ({
      ...prev,
      resolution: {
        ...prev.resolution,
        minWidth: Number.isNaN(num) ? undefined : num,
      },
    }));
  };

  const handleMinHeightChange = (value: string) => {
    const num = Number.parseInt(value, 10);
    setFilterState((prev) => ({
      ...prev,
      resolution: {
        ...prev.resolution,
        minHeight: Number.isNaN(num) ? undefined : num,
      },
    }));
  };

  const handleMaxWidthChange = (value: string) => {
    const num = Number.parseInt(value, 10);
    setFilterState((prev) => ({
      ...prev,
      resolution: {
        ...prev.resolution,
        maxWidth: Number.isNaN(num) ? undefined : num,
      },
    }));
  };

  const handleMaxHeightChange = (value: string) => {
    const num = Number.parseInt(value, 10);
    setFilterState((prev) => ({
      ...prev,
      resolution: {
        ...prev.resolution,
        maxHeight: Number.isNaN(num) ? undefined : num,
      },
    }));
  };

  const handleAspectRatioChange = (value: AspectRatioType) => {
    setFilterState((prev) => ({
      ...prev,
      resolution: { ...prev.resolution, aspectRatio: value },
    }));
  };

  // 构建显示标签
  const buildLabel = () => {
    const parts: string[] = [];
    if (resolution.minWidth || resolution.minHeight) {
      parts.push(`≥${resolution.minWidth || 0}x${resolution.minHeight || 0}`);
    }
    if (resolution.maxWidth || resolution.maxHeight) {
      parts.push(
        `≤${resolution.maxWidth || '∞'}x${resolution.maxHeight || '∞'}`,
      );
    }
    if (resolution.aspectRatio && resolution.aspectRatio !== 'any') {
      parts.push(resolution.aspectRatio);
    }
    return parts.length > 0
      ? parts.join(', ')
      : t('Resolution' as any) || 'Resolution';
  };

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-2">
        <Checkbox
          id="resolution-filter"
          checked={resolution.enabled}
          onCheckedChange={(checked) => handleEnabledChange(checked === true)}
        />
        <Label htmlFor="resolution-filter" className="text-sm cursor-pointer">
          {buildLabel()}
        </Label>
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-6 w-6">
            <Settings className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-3">
          <div className="space-y-4">
            {/* 最小分辨率 */}
            <div className="space-y-2">
              <Label className="text-xs">
                {t('MinResolution' as any) || 'Min Resolution'}
              </Label>
              <div className="flex gap-2 items-center">
                <Input
                  type="number"
                  placeholder="Width"
                  value={resolution.minWidth || ''}
                  onChange={(e) => handleMinWidthChange(e.target.value)}
                  className="h-8"
                />
                <span>×</span>
                <Input
                  type="number"
                  placeholder="Height"
                  value={resolution.minHeight || ''}
                  onChange={(e) => handleMinHeightChange(e.target.value)}
                  className="h-8"
                />
              </div>
            </div>

            {/* 最大分辨率 */}
            <div className="space-y-2">
              <Label className="text-xs">
                {t('MaxResolution' as any) || 'Max Resolution'}
              </Label>
              <div className="flex gap-2 items-center">
                <Input
                  type="number"
                  placeholder="Width"
                  value={resolution.maxWidth || ''}
                  onChange={(e) => handleMaxWidthChange(e.target.value)}
                  className="h-8"
                />
                <span>×</span>
                <Input
                  type="number"
                  placeholder="Height"
                  value={resolution.maxHeight || ''}
                  onChange={(e) => handleMaxHeightChange(e.target.value)}
                  className="h-8"
                />
              </div>
            </div>

            {/* 宽高比 */}
            <div className="space-y-2">
              <Label className="text-xs">
                {t('AspectRatio' as any) || 'Aspect Ratio'}
              </Label>
              <Select
                value={resolution.aspectRatio || 'any'}
                onValueChange={handleAspectRatioChange}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">
                    {t('Any' as any) || 'Any'}
                  </SelectItem>
                  <SelectItem value="16:9">16:9</SelectItem>
                  <SelectItem value="4:3">4:3</SelectItem>
                  <SelectItem value="1:1">1:1</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 快捷预设 */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 text-xs"
                onClick={() => {
                  setFilterState((prev) => ({
                    ...prev,
                    resolution: {
                      ...prev.resolution,
                      minWidth: 1920,
                      minHeight: 1080,
                    },
                  }));
                }}
              >
                ≥1080p
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 text-xs"
                onClick={() => {
                  setFilterState((prev) => ({
                    ...prev,
                    resolution: {
                      ...prev.resolution,
                      minWidth: 3840,
                      minHeight: 2160,
                    },
                  }));
                }}
              >
                ≥4K
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
