import { useAtom, useAtomValue } from 'jotai';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { currentToolAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { currentToolDataAtom } from '@/nodes/czkawka/upstream/atom/tools';
import { Button } from '@/nodes/czkawka/upstream/components';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Tools } from '@/nodes/czkawka/upstream/consts';
import type { BaseEntry } from '@/nodes/czkawka/upstream/types';

// 筛选条件接口
interface FilterCondition {
  id: string;
  field: string;
  operator: string;
  value: string | number;
  label: string;
}

// 操作符
const OPERATORS = {
  EQUALS: 'equals',
  CONTAINS: 'contains',
  NOT_CONTAINS: 'notContains',
  STARTS_WITH: 'startsWith',
  ENDS_WITH: 'endsWith',
  GREATER_THAN: 'gt',
  LESS_THAN: 'lt',
  GREATER_EQUAL: 'gte',
  LESS_EQUAL: 'lte',
} as const;

// 相似度等级映射
const SIMILARITY_LEVELS = {
  '极低 (95%)': 0.95,
  '很低 (90%)': 0.9,
  '低 (85%)': 0.85,
  '中低 (80%)': 0.8,
  '中等 (75%)': 0.75,
  '中高 (70%)': 0.7,
  '高 (65%)': 0.65,
  '很高 (60%)': 0.6,
  '极高 (55%)': 0.55,
} as const;

// 根据工具类型获取可用的筛选字段
function getAvailableFields(tool: string) {
  const commonFields = [
    { value: 'path', label: 'Path', type: 'text' },
    { value: 'name', label: 'Name', type: 'text' },
    { value: 'size', label: 'Size', type: 'size' },
  ];

  switch (tool) {
    case Tools.SimilarImages:
    case Tools.SimilarVideos:
      return [
        ...commonFields,
        { value: 'similarity', label: 'Similarity', type: 'similarity' },
        { value: 'dimensions', label: 'Dimensions', type: 'text' },
      ];
    case Tools.MusicDuplicates:
      return [
        ...commonFields,
        { value: 'similarity', label: 'Similarity', type: 'similarity' },
        { value: 'artist', label: 'Artist', type: 'text' },
        { value: 'title', label: 'Title', type: 'text' },
        { value: 'album', label: 'Album', type: 'text' },
        { value: 'duration', label: 'Duration', type: 'number' },
      ];
    case Tools.DuplicateFiles:
      return [
        ...commonFields,
        { value: 'extension', label: 'Extension', type: 'text' },
        { value: 'modified_date', label: 'Modified Date', type: 'date' },
      ];
    default:
      return commonFields;
  }
}

// 根据字段类型获取可用的操作符
function getAvailableOperators(fieldType: string) {
  switch (fieldType) {
    case 'size':
    case 'number':
    case 'date':
      return [
        { value: OPERATORS.EQUALS, label: 'Equals' },
        { value: OPERATORS.GREATER_THAN, label: 'Greater than' },
        { value: OPERATORS.LESS_THAN, label: 'Less than' },
        { value: OPERATORS.GREATER_EQUAL, label: 'Greater or equal' },
        { value: OPERATORS.LESS_EQUAL, label: 'Less or equal' },
      ];
    case 'similarity':
      return [
        { value: OPERATORS.GREATER_THAN, label: 'Greater than' },
        { value: OPERATORS.LESS_THAN, label: 'Less than' },
        { value: OPERATORS.EQUALS, label: 'Equals' },
      ];
    default:
      return [
        { value: OPERATORS.CONTAINS, label: 'Contains' },
        { value: OPERATORS.NOT_CONTAINS, label: 'Not Contains' },
        { value: OPERATORS.EQUALS, label: 'Equals' },
        { value: OPERATORS.STARTS_WITH, label: 'Starts with' },
        { value: OPERATORS.ENDS_WITH, label: 'Ends with' },
      ];
  }
}

// 解析文件大小字符串为字节数
function parseSizeToBytes(sizeStr: string): number {
  const match = sizeStr.match(/^([\d.]+)\s*([KMGTPE]?B?)$/i);
  if (!match) return 0;

  const [, num, unit] = match;
  const value = Number.parseFloat(num);
  const multiplier =
    {
      B: 1,
      KB: 1024,
      MB: 1024 * 1024,
      GB: 1024 * 1024 * 1024,
      TB: 1024 * 1024 * 1024 * 1024,
    }[unit.toUpperCase()] || 1;

  return value * multiplier;
}

// 其他工具函数保持不变...
function hasGroupedData(tool: string): boolean {
  return [
    Tools.DuplicateFiles,
    Tools.SimilarImages,
    Tools.SimilarVideos,
    Tools.MusicDuplicates,
  ].includes(tool as any);
}

function itemMatchesConditions(
  item: any,
  conditions: FilterCondition[],
  availableFields: any[],
): boolean {
  return conditions.every((condition) => {
    const fieldConfig = availableFields.find(
      (f) => f.value === condition.field,
    );
    const itemValue = item[condition.field];

    if (itemValue === undefined || itemValue === null) return false;

    if (fieldConfig?.type === 'size') {
      const itemBytes = parseSizeToBytes(String(itemValue));
      const filterValue =
        typeof condition.value === 'string'
          ? parseSizeToBytes(condition.value)
          : condition.value;

      switch (condition.operator) {
        case OPERATORS.EQUALS:
          return Math.abs(itemBytes - filterValue) < filterValue * 0.01;
        case OPERATORS.GREATER_THAN:
          return itemBytes > filterValue;
        case OPERATORS.LESS_THAN:
          return itemBytes < filterValue;
        case OPERATORS.GREATER_EQUAL:
          return itemBytes >= filterValue;
        case OPERATORS.LESS_EQUAL:
          return itemBytes <= filterValue;
        default:
          return false;
      }
    }

    if (fieldConfig?.type === 'similarity' || fieldConfig?.type === 'number') {
      const itemNum = Number(itemValue);
      const filterValue = Number(condition.value);

      switch (condition.operator) {
        case OPERATORS.EQUALS:
          return Math.abs(itemNum - filterValue) < 0.01;
        case OPERATORS.GREATER_THAN:
          return itemNum > filterValue;
        case OPERATORS.LESS_THAN:
          return itemNum < filterValue;
        case OPERATORS.GREATER_EQUAL:
          return itemNum >= filterValue;
        case OPERATORS.LESS_EQUAL:
          return itemNum <= filterValue;
        default:
          return false;
      }
    }

    const strValue = String(itemValue).toLowerCase();
    const filterValue = String(condition.value).toLowerCase();

    switch (condition.operator) {
      case OPERATORS.EQUALS:
        return strValue === filterValue;
      case OPERATORS.CONTAINS:
        return strValue.includes(filterValue);
      case OPERATORS.NOT_CONTAINS:
        return !strValue.includes(filterValue);
      case OPERATORS.STARTS_WITH:
        return strValue.startsWith(filterValue);
      case OPERATORS.ENDS_WITH:
        return strValue.endsWith(filterValue);
      default:
        return false;
    }
  });
}

function applyFilters<T extends BaseEntry>(
  data: T[],
  conditions: FilterCondition[],
  availableFields: any[],
  tool: string,
): T[] {
  if (conditions.length === 0) return data;

  // 对于非分组数据，直接应用筛选
  if (!hasGroupedData(tool)) {
    return data.filter((item) =>
      itemMatchesConditions(item, conditions, availableFields),
    );
  }

  // 对于分组数据，需要保持分组结构
  const result: T[] = [];
  let currentGroup: T[] = [];
  let groupHasMatches = false;
  let pendingSeparator: T | null = null;

  const addGroupIfMatches = () => {
    if (groupHasMatches && currentGroup.length > 0) {
      result.push(...currentGroup);

      if (pendingSeparator && result.length > currentGroup.length) {
        const insertIndex = result.length - currentGroup.length;
        result.splice(insertIndex, 0, pendingSeparator);
      }
    }
    pendingSeparator = null;
  };

  for (const item of data) {
    if ('__separator' in item && item.__separator) {
      addGroupIfMatches();
      currentGroup = [];
      groupHasMatches = false;
      pendingSeparator = item;
      continue;
    }

    currentGroup.push(item);

    if (itemMatchesConditions(item, conditions, availableFields)) {
      groupHasMatches = true;
    }
  }

  addGroupIfMatches();
  return result;
}

export function FileFilterContent() {
  const { t } = useTranslation();
  const currentTool = useAtomValue(currentToolAtom);
  const [data, setData] = useAtom(currentToolDataAtom);
  const [originalData, setOriginalData] = useState<any[]>([]);
  const [conditions, setConditions] = useState<FilterCondition[]>([]);
  const [currentField, setCurrentField] = useState('');
  const [currentOperator, setCurrentOperator] = useState('');
  const [currentValue, setCurrentValue] = useState('');

  const availableFields = getAvailableFields(currentTool);
  const currentFieldConfig = availableFields.find(
    (f) => f.value === currentField,
  );
  const availableOperators = getAvailableOperators(
    currentFieldConfig?.type || 'text',
  );

  // 初始化时保存原始数据
  const initializeOriginalData = () => {
    if (originalData.length === 0 && data.length > 0) {
      setOriginalData([...data]);
    }
  };

  // 添加筛选条件
  const addCondition = () => {
    if (!currentField || !currentOperator || !currentValue) return;

    initializeOriginalData();

    const fieldLabel =
      availableFields.find((f) => f.value === currentField)?.label ||
      currentField;
    const operatorLabel =
      availableOperators.find((o) => o.value === currentOperator)?.label ||
      currentOperator;

    let processedValue: string | number = currentValue;
    let displayValue = currentValue;

    if (
      currentFieldConfig?.type === 'similarity' &&
      currentValue in SIMILARITY_LEVELS
    ) {
      processedValue =
        SIMILARITY_LEVELS[currentValue as keyof typeof SIMILARITY_LEVELS];
      displayValue = currentValue;
    } else if (currentFieldConfig?.type === 'number') {
      processedValue = Number.parseFloat(currentValue);
    }

    const newCondition: FilterCondition = {
      id: Date.now().toString(),
      field: currentField,
      operator: currentOperator,
      value: processedValue,
      label: `${fieldLabel} ${operatorLabel} "${displayValue}"`,
    };

    setConditions((prev) => [...prev, newCondition]);
    setCurrentField('');
    setCurrentOperator('');
    setCurrentValue('');
  };

  // 移除筛选条件
  const removeCondition = (id: string) => {
    setConditions((prev) => prev.filter((c) => c.id !== id));
  };

  // 应用筛选
  const applyFilter = () => {
    if (originalData.length === 0) return;

    const filtered = applyFilters(
      originalData,
      conditions,
      availableFields,
      currentTool,
    );
    setData(filtered);
  };

  // 重置筛选
  const resetFilters = () => {
    if (originalData.length > 0) {
      setData([...originalData]);
    }
    setConditions([]);
  };

  // 清空所有
  const clearFilters = () => {
    setConditions([]);
    if (originalData.length > 0) {
      setData([...originalData]);
    }
    setCurrentField('');
    setCurrentOperator('');
    setCurrentValue('');
  };

  // 渲染值输入控件
  const renderValueInput = () => {
    if (currentFieldConfig?.type === 'similarity') {
      return (
        <Select value={currentValue} onValueChange={setCurrentValue}>
          <SelectTrigger>
            <SelectValue placeholder={t('Select similarity')} />
          </SelectTrigger>
          <SelectContent>
            {Object.keys(SIMILARITY_LEVELS).map((level) => (
              <SelectItem key={level} value={level}>
                {level}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    if (currentFieldConfig?.type === 'number') {
      return (
        <div className="space-y-2">
          <Input
            type="number"
            value={currentValue}
            onChange={(e) => setCurrentValue(e.target.value)}
            placeholder={t('Enter number')}
          />
          <Slider
            value={[Number.parseFloat(currentValue) || 0]}
            onValueChange={([value]) => setCurrentValue(value.toString())}
            max={100}
            step={1}
          />
        </div>
      );
    }

    return (
      <Input
        value={currentValue}
        onChange={(e) => setCurrentValue(e.target.value)}
        placeholder={t('Enter value')}
      />
    );
  };

  return (
    <div className="space-y-4">
      {/* 当前筛选条件 */}
      {conditions.length > 0 && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">
            {t('Active Filters')} ({conditions.length})
          </Label>
          <div className="flex flex-wrap gap-2">
            {conditions.map((condition) => (
              <Badge
                key={condition.id}
                variant="secondary"
                className="flex items-center gap-1"
              >
                {condition.label}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 p-0"
                  onClick={() => removeCondition(condition.id)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* 添加新条件 */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">
          {t('Add Filter Condition')}
        </Label>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">{t('Field')}</Label>
            <Select value={currentField} onValueChange={setCurrentField}>
              <SelectTrigger>
                <SelectValue placeholder={t('Select field')} />
              </SelectTrigger>
              <SelectContent>
                {availableFields.map((field) => (
                  <SelectItem key={field.value} value={field.value}>
                    {field.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t('Operator')}</Label>
            <Select
              value={currentOperator}
              onValueChange={setCurrentOperator}
              disabled={!currentField}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('Select operator')} />
              </SelectTrigger>
              <SelectContent>
                {availableOperators.map((operator) => (
                  <SelectItem key={operator.value} value={operator.value}>
                    {operator.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t('Value')}</Label>
            <div className="flex gap-2">
              {renderValueInput()}
              <Button
                size="sm"
                onClick={addCondition}
                disabled={!currentField || !currentOperator || !currentValue}
              >
                {t('Add')}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex justify-between pt-4 border-t">
        <Button variant="outline" onClick={clearFilters}>
          {t('Clear All')}
        </Button>
        <div className="space-x-2">
          <Button variant="outline" onClick={resetFilters}>
            {t('Reset')}
          </Button>
          <Button onClick={applyFilter}>{t('Apply Filter')}</Button>
        </div>
      </div>
    </div>
  );
}
