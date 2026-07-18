/**
 * SortCriteriaCard - 排序条件卡片
 * 显示和管理排序条件
 */
import { useAtom, useAtomValue } from 'jotai';
import { Plus } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { currentToolAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { groupRuleConfigAtom } from '@/nodes/czkawka/upstream/atom/selection-assistant';
import { Button } from '@/components/ui/button';
import { Tools } from '@/nodes/czkawka/upstream/consts';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import type { SortCriterion, SortField } from '@/nodes/czkawka/upstream/lib/selection-assistant/types';
import { SortCriteriaList } from '@/nodes/czkawka/upstream/views/selection-assistant/sort-criteria-list';

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

export function SortCriteriaCard() {
  const t = useT();
  const [config, setConfig] = useAtom(groupRuleConfigAtom);
  const currentTool = useAtomValue(currentToolAtom);

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

  // 更新排序条件
  const handleSortCriteriaChange = useCallback(
    (criteria: SortCriterion[]) => {
      setConfig((prev) => ({ ...prev, sortCriteria: criteria }));
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

  const canAddCriterion =
    config.sortCriteria.length < availableSortFields.length;

  return (
    <div className="p-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {config.sortCriteria.length} criteria
        </span>
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
  );
}
