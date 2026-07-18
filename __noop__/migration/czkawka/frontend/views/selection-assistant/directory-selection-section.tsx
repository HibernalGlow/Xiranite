/**
 * 目录选择区域
 * 实现按目录选择文件的功能
 */

import { open } from '@/nodes/czkawka/upstream/adapters/tauri-dialog';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { Check, FolderOpen, Plus, Trash2 } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import {
  currentSelectionAtom,
  directoryRuleConfigAtom,
} from '@/nodes/czkawka/upstream/atom/selection-assistant';
import {
  currentToolFilteredDataAtom,
  currentToolRowSelectionAtom,
} from '@/nodes/czkawka/upstream/atom/tools';
import { Select } from '@/nodes/czkawka/upstream/components/one-select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import { DirectorySelectionRule } from '@/nodes/czkawka/upstream/lib/selection-assistant/rules/directory-rule';
import type {
  DirectoryMode,
  SelectionAction,
} from '@/nodes/czkawka/upstream/lib/selection-assistant/types';
import type { BaseEntry, RefEntry } from '@/nodes/czkawka/upstream/types';

export function DirectorySelectionSection() {
  const t = useT();
  const [config, setConfig] = useAtom(directoryRuleConfigAtom);
  const currentSelection = useAtomValue(currentSelectionAtom);
  const currentToolData = useAtomValue(currentToolFilteredDataAtom);
  const setSelection = useSetAtom(currentToolRowSelectionAtom);

  // 模式选项
  const modeOptions = useMemo(
    () => [
      { label: t('Keep one per directory'), value: 'keepOnePerDirectory' },
      { label: t('Select all in directory'), value: 'selectAllInDirectory' },
      { label: t('Exclude directory'), value: 'excludeDirectory' },
    ],
    [t],
  );

  // 是否需要指定目录
  const needsDirectories =
    config.mode === 'selectAllInDirectory' ||
    config.mode === 'excludeDirectory';

  // 更新模式
  const handleModeChange = useCallback(
    (mode: string) => {
      setConfig((prev) => ({
        ...prev,
        mode: mode as DirectoryMode,
      }));
    },
    [setConfig],
  );

  // 更新保持已选择
  const handleKeepExistingChange = useCallback(
    (checked: boolean) => {
      setConfig((prev) => ({ ...prev, keepExistingSelection: checked }));
    },
    [setConfig],
  );

  // 添加目录
  const handleAddDirectory = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: true,
      });
      if (selected) {
        const dirs = Array.isArray(selected) ? selected : [selected];
        setConfig((prev) => ({
          ...prev,
          directories: [...new Set([...prev.directories, ...dirs])],
        }));
      }
    } catch (error) {
      console.error('Failed to select directory:', error);
    }
  }, [setConfig]);

  // 移除目录
  const handleRemoveDirectory = useCallback(
    (dir: string) => {
      setConfig((prev) => ({
        ...prev,
        directories: prev.directories.filter((d) => d !== dir),
      }));
    },
    [setConfig],
  );

  // 清空目录
  const handleClearDirectories = useCallback(() => {
    setConfig((prev) => ({ ...prev, directories: [] }));
  }, [setConfig]);

  // 执行选择
  const executeSelection = useCallback(
    (action: SelectionAction) => {
      const rule = new DirectorySelectionRule(config);
      const data = currentToolData as (BaseEntry &
        RefEntry & { raw: Record<string, unknown> })[];

      // 构建当前选择集合
      const currentSet = new Set<string>();
      for (const key of Object.keys(currentSelection)) {
        if (currentSelection[key]) {
          currentSet.add(key);
        }
      }

      const context = {
        data,
        currentSelection: currentSet,
        keepExistingSelection: config.keepExistingSelection,
        action,
      };

      const result = rule.execute(context);

      // 转换 Set 为 Record
      const newSelection: Record<string, boolean> = {};
      for (const path of result.selection) {
        newSelection[path] = true;
      }
      setSelection(newSelection);
    },
    [config, currentToolData, currentSelection, setSelection],
  );

  // 执行标记
  const handleMark = useCallback(() => {
    executeSelection('mark');
  }, [executeSelection]);

  // 执行取消标记
  const handleUnmark = useCallback(() => {
    executeSelection('unmark');
  }, [executeSelection]);

  const isValid = !needsDirectories || config.directories.length > 0;

  return (
    <div className="space-y-3">
      {/* 模式选择 */}
      <div className="space-y-1.5">
        <Label className="text-xs">{t('Mode')}</Label>
        <Select
          value={config.mode}
          onChange={handleModeChange}
          options={modeOptions}
        />
      </div>

      {/* 目录列表（仅在需要时显示） */}
      {needsDirectories && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">{t('Directories')}</Label>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2"
                onClick={handleAddDirectory}
              >
                <Plus className="h-3 w-3 mr-1" />
                {t('Add')}
              </Button>
              {config.directories.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2"
                  onClick={handleClearDirectories}
                >
                  {t('Clear all')}
                </Button>
              )}
            </div>
          </div>

          {config.directories.length > 0 ? (
            <ScrollArea className="h-32 rounded-md border">
              <div className="p-2 space-y-1">
                {config.directories.map((dir) => (
                  <div
                    key={dir}
                    className="flex items-center gap-2 text-xs group"
                  >
                    <FolderOpen className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    <span className="flex-1 truncate" title={dir}>
                      {dir}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 opacity-0 group-hover:opacity-100"
                      onClick={() => handleRemoveDirectory(dir)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <div className="h-32 rounded-md border flex items-center justify-center">
              <span className="text-xs text-muted-foreground">
                {t('Please add path')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 保持已选择 */}
      <div className="flex items-center space-x-2">
        <Checkbox
          id="keep-existing-dir"
          checked={config.keepExistingSelection}
          onCheckedChange={handleKeepExistingChange}
        />
        <Label htmlFor="keep-existing-dir" className="text-xs cursor-pointer">
          {t('Keep existing selection')}
        </Label>
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1"
          disabled={!isValid}
          onClick={handleMark}
        >
          <Check className="h-3 w-3 mr-1" />
          {t('Mark')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          disabled={!isValid}
          onClick={handleUnmark}
        >
          {t('Unselect')}
        </Button>
      </div>
    </div>
  );
}
