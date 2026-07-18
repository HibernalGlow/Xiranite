/**
 * 文本选择区域
 * 实现按文本模式选择文件的功能
 */

import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { AlertCircle, Check } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import {
  currentSelectionAtom,
  textRuleConfigAtom,
} from '@/nodes/czkawka/upstream/atom/selection-assistant';
import {
  currentToolFilteredDataAtom,
  currentToolRowSelectionAtom,
} from '@/nodes/czkawka/upstream/atom/tools';
import { Select } from '@/nodes/czkawka/upstream/components/one-select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import { isValidRegex } from '@/nodes/czkawka/upstream/lib/selection-assistant/matchers';
import { TextSelectionRule } from '@/nodes/czkawka/upstream/lib/selection-assistant/rules/text-rule';
import type {
  MatchCondition,
  SelectionAction,
  TextColumn,
} from '@/nodes/czkawka/upstream/lib/selection-assistant/types';
import type { BaseEntry, RefEntry } from '@/nodes/czkawka/upstream/types';

export function TextSelectionSection() {
  const t = useT();
  const [config, setConfig] = useAtom(textRuleConfigAtom);
  const currentSelection = useAtomValue(currentSelectionAtom);
  const currentToolData = useAtomValue(currentToolFilteredDataAtom);
  const setSelection = useSetAtom(currentToolRowSelectionAtom);
  const [regexError, setRegexError] = useState<string | null>(null);

  // 列选项
  const columnOptions = useMemo(
    () => [
      { label: t('Full path'), value: 'fullPath' },
      { label: t('File name'), value: 'fileName' },
      { label: t('Path'), value: 'folderPath' },
    ],
    [t],
  );

  // 匹配条件选项
  const conditionOptions = useMemo(
    () => [
      { label: t('Contains'), value: 'contains' },
      { label: t('Not Contains'), value: 'notContains' },
      { label: t('Equals'), value: 'equals' },
      { label: t('Starts with'), value: 'startsWith' },
      { label: t('Ends with'), value: 'endsWith' },
    ],
    [t],
  );

  // 更新列
  const handleColumnChange = useCallback(
    (column: string) => {
      setConfig((prev) => ({ ...prev, column: column as TextColumn }));
    },
    [setConfig],
  );

  // 更新条件
  const handleConditionChange = useCallback(
    (condition: string) => {
      setConfig((prev) => ({
        ...prev,
        condition: condition as MatchCondition,
      }));
    },
    [setConfig],
  );

  // 更新模式
  const handlePatternChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const pattern = e.target.value;
      setConfig((prev) => ({ ...prev, pattern }));

      // 验证正则表达式
      if (config.useRegex && pattern) {
        if (!isValidRegex(pattern)) {
          setRegexError(t('Invalid regex pattern'));
        } else {
          setRegexError(null);
        }
      } else {
        setRegexError(null);
      }
    },
    [config.useRegex, setConfig, t],
  );

  // 更新正则选项
  const handleUseRegexChange = useCallback(
    (checked: boolean) => {
      setConfig((prev) => ({ ...prev, useRegex: checked }));
      // 重新验证
      if (checked && config.pattern && !isValidRegex(config.pattern)) {
        setRegexError(t('Invalid regex pattern'));
      } else {
        setRegexError(null);
      }
    },
    [config.pattern, setConfig, t],
  );

  // 更新大小写敏感
  const handleCaseSensitiveChange = useCallback(
    (checked: boolean) => {
      setConfig((prev) => ({ ...prev, caseSensitive: checked }));
    },
    [setConfig],
  );

  // 更新匹配整列
  const handleMatchWholeColumnChange = useCallback(
    (checked: boolean) => {
      setConfig((prev) => ({ ...prev, matchWholeColumn: checked }));
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

  // 执行选择
  const executeSelection = useCallback(
    (action: SelectionAction) => {
      if (!config.pattern.trim()) return;
      if (config.useRegex && !isValidRegex(config.pattern)) return;

      const rule = new TextSelectionRule(config);
      const data = currentToolData as (BaseEntry & Partial<RefEntry>)[];

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

  const isValid = config.pattern.trim() && (!config.useRegex || !regexError);

  return (
    <div className="space-y-3">
      {/* 列选择 */}
      <div className="space-y-1.5">
        <Label className="text-xs">{t('Field')}</Label>
        <Select
          value={config.column}
          onChange={handleColumnChange}
          options={columnOptions}
        />
      </div>

      {/* 匹配条件 */}
      <div className="space-y-1.5">
        <Label className="text-xs">{t('Operator')}</Label>
        <Select
          value={config.condition}
          onChange={handleConditionChange}
          options={conditionOptions}
        />
      </div>

      {/* 模式输入 */}
      <div className="space-y-1.5">
        <Label className="text-xs">{t('Value')}</Label>
        <div className="relative">
          <Input
            value={config.pattern}
            onChange={handlePatternChange}
            placeholder={
              config.useRegex
                ? t('Regular expression pattern')
                : t('Text to match in path')
            }
            className={regexError ? 'border-destructive pr-8' : ''}
          />
          {regexError && (
            <AlertCircle className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-destructive" />
          )}
        </div>
        {regexError && <p className="text-xs text-destructive">{regexError}</p>}
      </div>

      {/* 选项 */}
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="match-whole-column"
            checked={config.matchWholeColumn}
            onCheckedChange={handleMatchWholeColumnChange}
          />
          <Label
            htmlFor="match-whole-column"
            className="text-xs cursor-pointer"
          >
            {t('Match whole column')}
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="case-sensitive"
            checked={config.caseSensitive}
            onCheckedChange={handleCaseSensitiveChange}
          />
          <Label htmlFor="case-sensitive" className="text-xs cursor-pointer">
            {t('Case sensitive')}
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="use-regex"
            checked={config.useRegex}
            onCheckedChange={handleUseRegexChange}
          />
          <Label htmlFor="use-regex" className="text-xs cursor-pointer">
            {t('Use regex')}
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="keep-existing-text"
            checked={config.keepExistingSelection}
            onCheckedChange={handleKeepExistingChange}
          />
          <Label
            htmlFor="keep-existing-text"
            className="text-xs cursor-pointer"
          >
            {t('Keep existing selection')}
          </Label>
        </div>
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
