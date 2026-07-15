/**
 * 文本选择规则
 * 基于文件路径/名称的文本匹配进行选择
 */

import type { BaseEntry, RefEntry } from '@/nodes/czkawka/upstream/types';
import { getColumnValue, isValidRegex, matchText } from '../matchers';
import type {
  RuleContext,
  RuleResult,
  SelectionRule,
  TextRuleConfig,
  ValidationResult,
} from '../types';

/** 生成唯一 ID */
let ruleIdCounter = 0;
const generateId = () => `text-rule-${++ruleIdCounter}`;

/**
 * 文本选择规则类
 */
export class TextSelectionRule implements SelectionRule<TextRuleConfig> {
  id: string;
  type: 'text' = 'text';
  config: TextRuleConfig;
  enabled: boolean;

  constructor(config: Partial<TextRuleConfig> = {}, id?: string) {
    this.id = id || generateId();
    this.enabled = true;
    this.config = {
      column: config.column || 'fullPath',
      condition: config.condition || 'contains',
      pattern: config.pattern || '',
      useRegex: config.useRegex || false,
      caseSensitive: config.caseSensitive || false,
      matchWholeColumn: config.matchWholeColumn || false,
      keepExistingSelection: config.keepExistingSelection || false,
    };
  }

  /**
   * 执行规则
   */
  execute<T extends BaseEntry & Partial<RefEntry>>(
    ctx: RuleContext<T>,
  ): RuleResult {
    const { data, currentSelection, keepExistingSelection, action } = ctx;
    const keepExisting =
      this.config.keepExistingSelection || keepExistingSelection;

    try {
      // 验证配置
      const validation = this.validate();
      if (!validation.valid) {
        return {
          selection: currentSelection,
          affectedCount: 0,
          success: false,
          error: validation.errors.join(', '),
        };
      }

      // 查找匹配的文件
      const matchedPaths = new Set<string>();
      for (const item of data) {
        const value = getColumnValue(item.path, this.config.column);

        // 如果启用了"匹配整列"，则使用 equals 条件
        const effectiveCondition = this.config.matchWholeColumn
          ? 'equals'
          : this.config.condition;

        const isMatch = matchText(
          value,
          this.config.pattern,
          effectiveCondition,
          this.config.caseSensitive,
          this.config.useRegex,
        );

        if (isMatch) {
          matchedPaths.add(item.path);
        }
      }

      // 计算新的选择状态
      const newSelection = this.applyAction(
        currentSelection,
        matchedPaths,
        action,
        keepExisting,
      );

      return {
        selection: newSelection,
        affectedCount: this.countAffected(currentSelection, newSelection),
        success: true,
      };
    } catch (error) {
      return {
        selection: currentSelection,
        affectedCount: 0,
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      };
    }
  }

  /**
   * 验证配置
   */
  validate(): ValidationResult {
    const errors: string[] = [];

    if (!this.config.pattern) {
      errors.push('匹配模式不能为空');
    }

    if (!['folderPath', 'fileName', 'fullPath'].includes(this.config.column)) {
      errors.push('无效的匹配列');
    }

    if (
      !['contains', 'notContains', 'equals', 'startsWith', 'endsWith'].includes(
        this.config.condition,
      )
    ) {
      errors.push('无效的匹配条件');
    }

    if (this.config.useRegex && !isValidRegex(this.config.pattern)) {
      errors.push('无效的正则表达式');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * 获取规则描述
   */
  describe(): string {
    const columnDesc: Record<string, string> = {
      folderPath: '文件夹',
      fileName: '文件名',
      fullPath: '完整路径',
    };

    const conditionDesc: Record<string, string> = {
      contains: '包含',
      notContains: '不包含',
      equals: '等于',
      startsWith: '开头是',
      endsWith: '结尾是',
    };

    const col = columnDesc[this.config.column] || this.config.column;
    const cond = this.config.matchWholeColumn
      ? '等于'
      : conditionDesc[this.config.condition] || this.config.condition;
    const regex = this.config.useRegex ? ' (正则)' : '';
    const caseSens = this.config.caseSensitive ? ' (大小写敏感)' : '';
    const wholeCol = this.config.matchWholeColumn ? ' (整列)' : '';

    return `文本选择: ${col} ${cond} "${this.config.pattern}"${regex}${caseSens}${wholeCol}`;
  }

  /**
   * 预览受影响的文件数
   */
  preview<T extends BaseEntry & Partial<RefEntry>>(
    ctx: RuleContext<T>,
  ): number {
    const result = this.execute(ctx);
    return result.affectedCount;
  }

  /**
   * 应用选择动作
   */
  private applyAction(
    current: Set<string>,
    matched: Set<string>,
    action: 'mark' | 'unmark',
    keepExisting: boolean,
  ): Set<string> {
    const result = new Set<string>(current);

    if (action === 'mark') {
      // 标记操作：添加匹配的路径
      for (const path of matched) {
        result.add(path);
      }
    } else {
      // 取消标记操作
      if (keepExisting) {
        // 保持已选择不变时，不移除已选择的
        // 这里的逻辑是：只移除那些在 matched 中但不在原 current 中的
        // 实际上 unmark + keepExisting 意味着不做任何事
      } else {
        // 移除匹配的路径
        for (const path of matched) {
          result.delete(path);
        }
      }
    }

    return result;
  }

  /**
   * 计算受影响的文件数
   */
  private countAffected(before: Set<string>, after: Set<string>): number {
    let count = 0;

    for (const path of after) {
      if (!before.has(path)) count++;
    }

    for (const path of before) {
      if (!after.has(path)) count++;
    }

    return count;
  }
}

/**
 * 创建文本选择规则
 */
export function createTextRule(
  config?: Partial<TextRuleConfig>,
): TextSelectionRule {
  return new TextSelectionRule(config);
}
