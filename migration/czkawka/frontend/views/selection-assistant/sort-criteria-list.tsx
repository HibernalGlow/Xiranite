/**
 * 排序条件列表组件
 * 使用 @dnd-kit 实现拖拽排序
 */

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Filter, GripVertical, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Select } from '@/nodes/czkawka/upstream/components/one-select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import type {
  FilterCondition,
  SortCriterion,
  SortDirection,
  SortField,
} from '@/nodes/czkawka/upstream/lib/selection-assistant/types';
import { cn } from '@/nodes/czkawka/upstream/utils/cn';

interface SortCriteriaListProps {
  criteria: SortCriterion[];
  availableFields: { label: string; value: SortField }[];
  onChange: (criteria: SortCriterion[]) => void;
}

interface SortableItemProps {
  criterion: SortCriterion;
  index: number;
  availableFields: { label: string; value: SortField }[];
  onUpdate: (index: number, updates: Partial<SortCriterion>) => void;
  onRemove: (index: number) => void;
  canRemove: boolean;
}

/** 可拖拽的排序条件项 */
function SortableItem({
  criterion,
  index,
  availableFields,
  onUpdate,
  onRemove,
  canRemove,
}: SortableItemProps) {
  const t = useT();
  const [showFilter, setShowFilter] = useState(
    criterion.filterCondition && criterion.filterCondition !== 'none',
  );

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `criterion-${index}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const directionOptions = [
    { label: t('Descending'), value: 'desc' },
    { label: t('Ascending'), value: 'asc' },
  ];

  const filterConditionOptions: { label: string; value: FilterCondition }[] = [
    { label: t('No filter'), value: 'none' },
    { label: t('Contains'), value: 'contains' },
    { label: t('Not contains'), value: 'notContains' },
    { label: t('Starts with'), value: 'startsWith' },
    { label: t('Ends with'), value: 'endsWith' },
    { label: t('Equals'), value: 'equals' },
  ];

  const handleToggleFilter = useCallback(() => {
    const newShowFilter = !showFilter;
    setShowFilter(newShowFilter);
    if (!newShowFilter) {
      onUpdate(index, { filterCondition: 'none', filterValue: '' });
    }
  }, [showFilter, index, onUpdate]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'rounded-md border bg-background',
        isDragging && 'opacity-50 shadow-lg',
        !criterion.enabled && 'opacity-60',
      )}
    >
      {/* 主行 */}
      <div className="flex items-center gap-2 p-2">
        {/* 拖拽手柄 */}
        <button
          type="button"
          className="cursor-grab touch-none"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>

        {/* 启用复选框 */}
        <Checkbox
          checked={criterion.enabled}
          onCheckedChange={(checked) =>
            onUpdate(index, { enabled: checked as boolean })
          }
        />

        {/* 字段选择 */}
        <div className="flex-1 min-w-0">
          <Select
            value={criterion.field}
            onChange={(value) => onUpdate(index, { field: value as SortField })}
            options={availableFields}
          />
        </div>

        {/* 方向选择 */}
        <div className="w-24">
          <Select
            value={criterion.direction}
            onChange={(value) =>
              onUpdate(index, { direction: value as SortDirection })
            }
            options={directionOptions}
          />
        </div>

        {/* 空值优先 */}
        <div className="flex items-center gap-1">
          <Checkbox
            id={`prefer-empty-${index}`}
            checked={criterion.preferEmpty}
            onCheckedChange={(checked) =>
              onUpdate(index, { preferEmpty: checked as boolean })
            }
          />
          <label
            htmlFor={`prefer-empty-${index}`}
            className="text-xs text-muted-foreground whitespace-nowrap cursor-pointer"
          >
            {t('Empty first')}
          </label>
        </div>

        {/* 过滤按钮 */}
        <Button
          variant={showFilter ? 'secondary' : 'ghost'}
          size="icon"
          className="h-7 w-7"
          onClick={handleToggleFilter}
          title={t('Filter')}
        >
          <Filter className="h-3 w-3" />
        </Button>

        {/* 删除按钮 */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={!canRemove}
          onClick={() => onRemove(index)}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* 过滤条件行 */}
      {showFilter && (
        <div className="flex items-center gap-2 px-2 pb-2 pl-10">
          <div className="w-32">
            <Select
              value={criterion.filterCondition || 'none'}
              onChange={(value) =>
                onUpdate(index, { filterCondition: value as FilterCondition })
              }
              options={filterConditionOptions}
            />
          </div>
          {criterion.filterCondition &&
            criterion.filterCondition !== 'none' && (
              <Input
                className="flex-1 h-8 text-sm"
                placeholder={t('Filter value')}
                value={criterion.filterValue || ''}
                onChange={(e) =>
                  onUpdate(index, { filterValue: e.target.value })
                }
              />
            )}
        </div>
      )}
    </div>
  );
}

export function SortCriteriaList({
  criteria,
  availableFields,
  onChange,
}: SortCriteriaListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const oldIndex = Number.parseInt(
          (active.id as string).replace('criterion-', ''),
          10,
        );
        const newIndex = Number.parseInt(
          (over.id as string).replace('criterion-', ''),
          10,
        );
        onChange(arrayMove(criteria, oldIndex, newIndex));
      }
    },
    [criteria, onChange],
  );

  const handleUpdate = useCallback(
    (index: number, updates: Partial<SortCriterion>) => {
      const newCriteria = [...criteria];
      newCriteria[index] = { ...newCriteria[index], ...updates };
      onChange(newCriteria);
    },
    [criteria, onChange],
  );

  const handleRemove = useCallback(
    (index: number) => {
      onChange(criteria.filter((_, i) => i !== index));
    },
    [criteria, onChange],
  );

  if (criteria.length === 0) {
    return (
      <div className="text-xs text-muted-foreground text-center py-2">
        No sort criteria
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={criteria.map((_, i) => `criterion-${i}`)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-2">
          {criteria.map((criterion, index) => (
            <SortableItem
              key={`criterion-${index}`}
              criterion={criterion}
              index={index}
              availableFields={availableFields}
              onUpdate={handleUpdate}
              onRemove={handleRemove}
              canRemove={criteria.length > 1}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
