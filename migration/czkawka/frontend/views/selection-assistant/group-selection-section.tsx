/**
 * 组选择区域
 * 实现按组选择文件的功能
 * 支持与过滤面板集成，过滤器激活时只操作过滤后的数据
 */

import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { AlertTriangle, Check, Plus } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import {
  activeFilterCountAtom,
  filteredDataAtom,
  isFilterActiveAtom,
} from '@/nodes/czkawka/upstream/atom/filter-panel';
import { currentToolAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import {
  currentSelectionAtom,
  groupRuleConfigAtom,
} from '@/nodes/czkawka/upstream/atom/selection-assistant';
import {
  currentToolFilteredDataAtom,
  currentToolRowSelectionAtom,
} from '@/nodes/czkawka/upstream/atom/tools';
import { Select } from '@/nodes/czkawka/upstream/components/one-select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Tools } from '@/nodes/czkawka/upstream/consts';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import { GroupSelectionRule } from '@/nodes/czkawka/upstream/lib/selection-assistant/rules/group-rule';
import type {
  GroupSelectionMode,
  SelectionAction,
  SortCriterion,
  SortField,
} from '@/nodes/czkawka/upstream/lib/selection-assistant/types';
import type { BaseEntry, RefEntry } from '@/nodes/czkawka/upstream/types';
import { SortCriteriaList } from './sort-criteria-list';

/** 支持大小和日期选择的工具 */
const toolsWithSizeAndDate = new Set<string>([
  Tools.DuplicateFiles,
  Tools.SimilarImages,
  Tools.SimilarVideos,
  Tools.MusicDuplicates,
]);

/** 支持分辨率选择的工具 */
const toolsWithResolution = new Set<string>([Tools.SimilarImages]);

/** 支持哈希值的工具 */
const toolsWithHash = new Set<string>([
  Tools.DuplicateFiles,
  Tools.MusicDuplicates,
]);

export function GroupSelectionSection() {
  const t = useT();
  const [config, setConfig] = useAtom(groupRuleConfigAtom);
  const currentTool = useAtomValue(currentToolAtom);
  const currentToolData = useAtomValue(currentToolFilteredDataAtom);
  const currentSelection = useAtomValue(currentSelectionAtom);
  const setSelection = useSetAtom(currentToolRowSelectionAtom);

  // 过滤器相关状态
  const isFilterActive = useAtomValue(isFilterActiveAtom);
  const activeFilterCount = useAtomValue(activeFilterCountAtom);
  const filteredData = useAtomValue(filteredDataAtom);

  // 根据过滤器状态选择使用的数据
  const effectiveData = useMemo(() => {
    if (isFilterActive && filteredData.length > 0) {
      return filteredData as (BaseEntry &
        RefEntry & { raw: Record<string, unknown> })[];
    }
    return currentToolData as (BaseEntry &
      RefEntry & { raw: Record<string, unknown> })[];
  }, [isFilterActive, filteredData, currentToolData]);

  // 模式选项
  const modeOptions = useMemo(
    () => [
      { label: t('Select all except one'), value: 'selectAllExceptOne' },
      { label: t('Select one'), value: 'selectOne' },
      {
        label: t('All but one per folder'),
        value: 'selectAllExceptOnePerFolder',
      },
      {
        label: t('All but one matching set'),
        value: 'selectAllExceptOneMatchingSet',
      },
    ],
    [t],
  );

  // 可用的排序字段（根据当前工具）
  const availableSortFields = useMemo(() => {
    const fields: { label: string; value: SortField }[] = [
      { label: t('Full path'), value: 'folderPath' },
      { label: t('File name'), value: 'fileName' },
      { label: t('Disk'), value: 'disk' },
      { label: t('File type'), value: 'fileType' },
    ];

    if (toolsWithSizeAndDate.has(currentTool)) {
      fields.push(
        { label: t('Size'), value: 'fileSize' },
        { label: t('Creation date'), value: 'creationDate' },
        { label: t('Modified date'), value: 'modifiedDate' },
      );
    }

    if (toolsWithResolution.has(currentTool)) {
      fields.push({ label: t('Resolution'), value: 'resolution' });
    }

    if (toolsWithHash.has(currentTool)) {
      fields.push(
        { label: t('Hash'), value: 'hash' },
        { label: t('Hard links'), value: 'hardLinks' },
      );
    }

    return fields;
  }, [currentTool, t]);

  // 更新模式
  const handleModeChange = useCallback(
    (mode: string) => {
      setConfig((prev) => ({ ...prev, mode: mode as GroupSelectionMode }));
    },
    [setConfig],
  );

  // 更新排序条件
  const handleSortCriteriaChange = useCallback(
    (criteria: SortCriterion[]) => {
      setConfig((prev) => ({ ...prev, sortCriteria: criteria }));
    },
    [setConfig],
  );

  // 更新保持已选择选项
  const handleKeepExistingChange = useCallback(
    (checked: boolean) => {
      setConfig((prev) => ({ ...prev, keepExistingSelection: checked }));
    },
    [setConfig],
  );

  // 添加排序条件
  const handleAddCriterion = useCallback(() => {
    const usedFields = new Set(config.sortCriteria.map((c) => c.field));
    const availableField = availableSortFields.find(
      (f) => !usedFields.has(f.value),
    );
    if (availableField) {
      setConfig((prev) => ({
        ...prev,
        sortCriteria: [
          ...prev.sortCriteria,
          {
            field: availableField.value,
            direction: 'desc',
            preferEmpty: false,
            enabled: true,
          },
        ],
      }));
    }
  }, [config.sortCriteria, availableSortFields, setConfig]);

  // 执行选择
  const executeSelection = useCallback(
    (action: SelectionAction) => {
      const rule = new GroupSelectionRule(config);
      // 使用过滤后的数据（如果过滤器激活）
      const data = effectiveData;

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
    [config, effectiveData, currentSelection, setSelection],
  );

  // 执行标记
  const handleMark = useCallback(() => {
    executeSelection('mark');
  }, [executeSelection]);

  // 执行取消标记
  const handleUnmark = useCallback(() => {
    executeSelection('unmark');
  }, [executeSelection]);

  const canAddCriterion =
    config.sortCriteria.length < availableSortFields.length;

  return (
    <div className="space-y-3">
      {/* 过滤器激活警告 */}
      {isFilterActive && (
        <div className="flex items-center gap-2 p-2 text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-md border border-amber-500/20">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          <span>
            {t('Filter active')} ({activeFilterCount}) -{' '}
            {t('Selection will only affect filtered items')}
          </span>
        </div>
      )}

      {/* 模式选择 */}
      <div className="space-y-1.5">
        <Label className="text-xs">{t('Mode')}</Label>
        <Select
          value={config.mode}
          onChange={handleModeChange}
          options={modeOptions}
        />
      </div>

      {/* 排序条件 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">{t('Sort criteria')}</Label>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            disabled={!canAddCriterion}
            onClick={handleAddCriterion}
          >
            <Plus className="h-3 w-3 mr-1" />
            {t('Add')}
          </Button>
        </div>
        <SortCriteriaList
          criteria={config.sortCriteria}
          availableFields={availableSortFields}
          onChange={handleSortCriteriaChange}
        />
      </div>

      {/* 保持已选择 */}
      <div className="flex items-center space-x-2">
        <Checkbox
          id="keep-existing-group"
          checked={config.keepExistingSelection}
          onCheckedChange={handleKeepExistingChange}
        />
        <Label htmlFor="keep-existing-group" className="text-xs cursor-pointer">
          {t('Keep existing selection')}
        </Label>
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" onClick={handleMark}>
          <Check className="h-3 w-3 mr-1" />
          {t('Mark')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={handleUnmark}
        >
          {t('Unselect')}
        </Button>
      </div>
    </div>
  );
}
