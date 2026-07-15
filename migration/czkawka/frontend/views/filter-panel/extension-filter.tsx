/**
 * ExtensionFilter - 扩展名过滤器
 * 根据文件扩展名进行过滤
 */

import { useAtom } from 'jotai';
import { Settings } from 'lucide-react';
import { useState } from 'react';
import { filterStateAtom } from '@/nodes/czkawka/upstream/atom/filter-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import { EXTENSION_PRESETS } from '@/nodes/czkawka/upstream/lib/filter-panel/utils';

export function ExtensionFilter() {
  const t = useT();
  const [filterState, setFilterState] = useAtom(filterStateAtom);
  const { extension } = filterState;
  const [inputValue, setInputValue] = useState('');
  const [open, setOpen] = useState(false);

  const handleEnabledChange = (checked: boolean) => {
    setFilterState((prev) => ({
      ...prev,
      extension: { ...prev.extension, enabled: checked },
    }));
  };

  const handleAddExtension = () => {
    if (!inputValue.trim()) return;
    const ext = inputValue.trim().toLowerCase().replace(/^\./, '');
    if (!extension.extensions.includes(ext)) {
      setFilterState((prev) => ({
        ...prev,
        extension: {
          ...prev.extension,
          extensions: [...prev.extension.extensions, ext],
        },
      }));
    }
    setInputValue('');
  };

  const handleRemoveExtension = (ext: string) => {
    setFilterState((prev) => ({
      ...prev,
      extension: {
        ...prev.extension,
        extensions: prev.extension.extensions.filter((e) => e !== ext),
      },
    }));
  };

  const handlePresetClick = (presetExts: readonly string[]) => {
    setFilterState((prev) => ({
      ...prev,
      extension: {
        ...prev.extension,
        extensions: [...new Set([...prev.extension.extensions, ...presetExts])],
      },
    }));
  };

  const label =
    extension.extensions.length > 0
      ? `${t('Extensions' as any) || 'Extensions'}: ${extension.extensions.slice(0, 3).join(', ')}${extension.extensions.length > 3 ? '...' : ''}`
      : t('Extension filter' as any) || 'Extension filter';

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-2">
        <Checkbox
          id="extension-filter"
          checked={extension.enabled}
          onCheckedChange={(checked) => handleEnabledChange(checked === true)}
        />
        <Label htmlFor="extension-filter" className="text-sm cursor-pointer">
          {label}
        </Label>
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-6 w-6">
            <Settings className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-3">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">
                {t('Add extension' as any) || 'Add extension'}
              </Label>
              <div className="flex gap-2">
                <Input
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="jpg, png..."
                  onKeyDown={(e) => e.key === 'Enter' && handleAddExtension()}
                  className="flex-1"
                />
                <Button size="sm" onClick={handleAddExtension}>
                  {t('Add' as any) || 'Add'}
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">
                {t('Presets' as any) || 'Presets'}
              </Label>
              <div className="flex flex-wrap gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePresetClick(EXTENSION_PRESETS.images)}
                >
                  {t('Images' as any) || 'Images'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePresetClick(EXTENSION_PRESETS.videos)}
                >
                  {t('Videos' as any) || 'Videos'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePresetClick(EXTENSION_PRESETS.audio)}
                >
                  {t('Audio' as any) || 'Audio'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePresetClick(EXTENSION_PRESETS.documents)}
                >
                  {t('Documents' as any) || 'Documents'}
                </Button>
              </div>
            </div>

            {extension.extensions.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">
                  {t('Selected' as any) || 'Selected'}
                </Label>
                <div className="flex flex-wrap gap-1">
                  {extension.extensions.map((ext) => (
                    <Badge
                      key={ext}
                      variant="secondary"
                      className="cursor-pointer"
                      onClick={() => handleRemoveExtension(ext)}
                    >
                      .{ext} ×
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
