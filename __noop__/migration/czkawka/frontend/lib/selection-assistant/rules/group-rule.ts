/**
 * 组选择规则
 * 在重复文件组内按照多种条件选择文件
 */

import { match } from 'ts-pattern';
import type { BaseEntry, RefEntry } from '@/nodes/czkawka/upstream/types';
import { getColumnValue } from '../matchers';
import type {
  EntryWithRaw,
  FilterCondition,
  GroupRuleConfig,
  RuleContext,
  RuleResult,
  SelectionRule,
  SortCriterion,
  SortField,
  ValidationResult,
} from '../types';

/** 生成唯一 ID */
let ruleIdCounter = 0;
const generateId = () => `group-rule-${++ruleIdCounter}`;

/**
 * 组选择规则类
 */
export class GroupSelectionRule implements SelectionRule<GroupRuleConfig> {
  id: string;
  type: 'group' = 'group';
  config: GroupRuleConfig;
  enabled: boolean;

  constructor(config: Partial<GroupRuleConfig> = {}, id?: string) {
    this.id = id || generateId();
    this.enabled = true;
    this.config = {
      mode: config.mode || 'selectAllExceptOne',
      sortCriteria: config.sortCriteria || [],
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
      // 按 groupId 分组
      const groups = this.groupByGroupId(data);
      const matchedPaths = new Set<string>();

      for (const group of groups) {
        if (group.length === 0) continue;

        // 排序组内文件
        const sorted = this.sortGroup(group);

        // 根据模式选择文件
        const selected = this.selectByMode(sorted);
        for (const path of selected) {
          matchedPaths.add(path);
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
    const validFields: SortField[] = [
      'folderPath',
      'fileName',
      'fileSize',
      'creationDate',
      'modifiedDate',
      'resolution',
      'disk',
      'fileType',
      'hash',
      'hardLinks',
    ];
    const validFilterConditions: FilterCondition[] = [
      'none',
      'contains',
      'notContains',
      'startsWith',
      'endsWith',
      'equals',
    ];
    const validModes = [
      'selectAllExceptOne',
      'selectOne',
      'selectAllExceptOnePerFolder',
      'selectAllExceptOneMatchingSet',
    ];

    if (!validModes.includes(this.config.mode)) {
      errors.push('无效的选择模式');
    }

    for (const criterion of this.config.sortCriteria) {
      if (!validFields.includes(criterion.field)) {
        errors.push(`无效的排序字段: ${criterion.field}`);
      }
      if (!['asc', 'desc'].includes(criterion.direction)) {
        errors.push(`无效的排序方向: ${criterion.direction}`);
      }
      if (
        criterion.filterCondition &&
        !validFilterConditions.includes(criterion.filterCondition)
      ) {
        errors.push(`无效的过滤条件: ${criterion.filterCondition}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * 获取规则描述
   */
  describe(): string {
    const modeDesc = match(this.config.mode)
      .with('selectAllExceptOne', () => '每组除了一份文件之外其他所有')
      .with('selectOne', () => '每组中仅一份文件')
      .with(
        'selectAllExceptOnePerFolder',
        () => '同一组且同一文件夹中除了一份之外其他所有',
      )
      .with(
        'selectAllExceptOneMatchingSet',
        () => '每组中除了一个匹配集之外其他所有',
      )
      .exhaustive();

    const criteriaDesc = this.config.sortCriteria
      .filter((c) => c.enabled)
      .map((c) => `${c.field} ${c.direction}`)
      .join(', ');

    return `组选择: ${modeDesc}${criteriaDesc ? ` (排序: ${criteriaDesc})` : ''}`;
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
   * 按 groupId 分组
   */
  private groupByGroupId<T extends BaseEntry & Partial<RefEntry>>(
    data: T[],
  ): T[][] {
    const map = new Map<number, T[]>();

    for (const item of data) {
      const groupId = (item as RefEntry).groupId;
      if (groupId === undefined) continue;

      if (!map.has(groupId)) {
        map.set(groupId, []);
      }
      map.get(groupId)!.push(item);
    }

    return Array.from(map.values());
  }

  /**
   * 排序组内文件
   */
  private sortGroup<T extends BaseEntry & Partial<RefEntry>>(group: T[]): T[] {
    const enabledCriteria = this.config.sortCriteria.filter((c) => c.enabled);

    if (enabledCriteria.length === 0) {
      return [...group];
    }

    // 先应用过滤条件
    let filtered = [...group];
    for (const criterion of enabledCriteria) {
      if (
        criterion.filterCondition &&
        criterion.filterCondition !== 'none' &&
        criterion.filterValue
      ) {
        filtered = this.applyFilter(filtered, criterion);
      }
    }

    // 再排序
    return filtered.sort((a, b) => {
      for (const criterion of enabledCriteria) {
        const cmp = this.compareByField(a, b, criterion);
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
  }

  /**
   * 应用过滤条件
   */
  private applyFilter<T extends BaseEntry & Partial<RefEntry>>(
    items: T[],
    criterion: SortCriterion,
  ): T[] {
    const { filterCondition, filterValue } = criterion;
    if (!filterCondition || filterCondition === 'none' || !filterValue) {
      return items;
    }

    return items.filter((item) => {
      const value = this.getFieldValue(item, criterion.field);
      const strValue = String(value ?? '').toLowerCase();
      const searchValue = filterValue.toLowerCase();

      const condition = filterCondition as FilterCondition;
      if (condition === 'none') return true;
      if (condition === 'contains') return strValue.includes(searchValue);
      if (condition === 'notContains') return !strValue.includes(searchValue);
      if (condition === 'startsWith') return strValue.startsWith(searchValue);
      if (condition === 'endsWith') return strValue.endsWith(searchValue);
      if (condition === 'equals') return strValue === searchValue;
      return true;
    });
  }

  /**
   * 按字段比较
   */
  private compareByField<T extends BaseEntry & Partial<RefEntry>>(
    a: T,
    b: T,
    criterion: SortCriterion,
  ): number {
    const valueA = this.getFieldValue(a, criterion.field);
    const valueB = this.getFieldValue(b, criterion.field);

    // 空值优先处理
    if (criterion.preferEmpty) {
      const aEmpty = valueA === null || valueA === undefined || valueA === '';
      const bEmpty = valueB === null || valueB === undefined || valueB === '';
      if (aEmpty && !bEmpty) return -1;
      if (!aEmpty && bEmpty) return 1;
    }

    // 比较值
    let cmp = 0;
    if (typeof valueA === 'number' && typeof valueB === 'number') {
      cmp = valueA - valueB;
    } else {
      cmp = String(valueA || '').localeCompare(String(valueB || ''));
    }

    // 应用排序方向
    return criterion.direction === 'desc' ? -cmp : cmp;
  }

  /**
   * 获取字段值
   */
  private getFieldValue<T extends BaseEntry & Partial<RefEntry>>(
    item: T,
    field: SortField,
  ): string | number | null {
    const entry = item as EntryWithRaw;

    return match(field)
      .with('folderPath', () => getColumnValue(item.path, 'folderPath'))
      .with('fileName', () => getColumnValue(item.path, 'fileName'))
      .with('fileSize', () => entry.raw?.size ?? null)
      .with(
        'creationDate',
        () => entry.raw?.created_date ?? entry.raw?.modified_date ?? null,
      )
      .with('modifiedDate', () => entry.raw?.modified_date ?? null)
      .with('resolution', () => {
        const width = entry.raw?.width;
        const height = entry.raw?.height;
        if (typeof width === 'number' && typeof height === 'number') {
          return width * height;
        }
        return null;
      })
      .with('disk', () => {
        // 提取磁盘/驱动器（Windows: C:, D: 等；Unix: /home, /mnt 等）
        const path = item.path;
        if (path.match(/^[A-Za-z]:/)) {
          return path.substring(0, 2).toUpperCase();
        }
        // Unix 风格路径，取第一级目录
        const parts = path.split('/').filter(Boolean);
        return parts.length > 0 ? `/${parts[0]}` : '/';
      })
      .with('fileType', () => {
        // 提取文件扩展名
        const fileName = getColumnValue(item.path, 'fileName');
        if (typeof fileName === 'string') {
          const lastDot = fileName.lastIndexOf('.');
          if (lastDot > 0) {
            return fileName.substring(lastDot + 1).toLowerCase();
          }
        }
        return '';
      })
      .with('hash', () => entry.raw?.hash ?? null)
      .with('hardLinks', () => entry.raw?.hardlinks ?? null)
      .exhaustive();
  }

  /**
   * 根据模式选择文件
   */
  private selectByMode<T extends BaseEntry & Partial<RefEntry>>(
    sorted: T[],
  ): string[] {
    return match(this.config.mode)
      .with('selectAllExceptOne', () => {
        // 每组除了一份文件之外其他所有（保留排序后的第一个）
        if (sorted.length <= 1) return [];
        return sorted.slice(1).map((item) => item.path);
      })
      .with('selectOne', () => {
        // 每组中仅一份文件（选择排序后的第一个）
        if (sorted.length === 0) return [];
        return [sorted[0].path];
      })
      .with('selectAllExceptOnePerFolder', () => {
        // 同一组且同一文件夹中除了一份之外其他所有
        // 按文件夹分组，每个文件夹保留一个
        const byFolder = new Map<string, T[]>();
        for (const item of sorted) {
          const folder = getColumnValue(item.path, 'folderPath') as string;
          if (!byFolder.has(folder)) {
            byFolder.set(folder, []);
          }
          byFolder.get(folder)!.push(item);
        }

        const selected: string[] = [];
        for (const folderItems of byFolder.values()) {
          // 每个文件夹保留第一个，选择其余的
          if (folderItems.length > 1) {
            for (let i = 1; i < folderItems.length; i++) {
              selected.push(folderItems[i].path);
            }
          }
        }
        return selected;
      })
      .with('selectAllExceptOneMatchingSet', () => {
        // 每组中除了一个匹配集之外其他所有
        // 按排序条件的第一个字段值分组，每个匹配集保留一个
        if (sorted.length <= 1) return [];

        const enabledCriteria = this.config.sortCriteria.filter(
          (c) => c.enabled,
        );
        if (enabledCriteria.length === 0) {
          // 没有排序条件时，退化为 selectAllExceptOne
          return sorted.slice(1).map((item) => item.path);
        }

        // 按第一个排序字段的值分组
        const firstField = enabledCriteria[0].field;
        const byFieldValue = new Map<string | number | null, T[]>();
        for (const item of sorted) {
          const value = this.getFieldValue(item, firstField);
          const key = value ?? '__null__';
          if (!byFieldValue.has(key as string | number | null)) {
            byFieldValue.set(key as string | number | null, []);
          }
          byFieldValue.get(key as string | number | null)!.push(item);
        }

        // 保留第一个匹配集，选择其他所有匹配集的文件
        const matchingSets = Array.from(byFieldValue.values());
        if (matchingSets.length <= 1) {
          // 只有一个匹配集，退化为 selectAllExceptOne
          return sorted.slice(1).map((item) => item.path);
        }

        // 保留第一个匹配集，选择其余匹配集的所有文件
        const selected: string[] = [];
        for (let i = 1; i < matchingSets.length; i++) {
          for (const item of matchingSets[i]) {
            selected.push(item.path);
          }
        }
        return selected;
      })
      .exhaustive();
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
        // 保持已选择不变时，只从匹配集合中移除
        for (const path of matched) {
          if (!current.has(path)) {
            result.delete(path);
          }
        }
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

    // 新增的
    for (const path of after) {
      if (!before.has(path)) count++;
    }

    // 移除的
    for (const path of before) {
      if (!after.has(path)) count++;
    }

    return count;
  }
}

/**
 * 创建组选择规则
 */
export function createGroupRule(
  config?: Partial<GroupRuleConfig>,
): GroupSelectionRule {
  return new GroupSelectionRule(config);
}
