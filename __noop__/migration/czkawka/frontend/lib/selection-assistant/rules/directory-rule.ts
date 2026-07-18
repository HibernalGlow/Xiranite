/**
 * 目录选择规则
 * 基于文件所在目录进行选择
 */

import { match } from 'ts-pattern';
import type { BaseEntry, RefEntry } from '@/nodes/czkawka/upstream/types';
import { getDirectory, isInDirectory } from '../matchers';
import type {
  DirectoryRuleConfig,
  RuleContext,
  RuleResult,
  SelectionRule,
  ValidationResult,
} from '../types';

/** 生成唯一 ID */
let ruleIdCounter = 0;
const generateId = () => `directory-rule-${++ruleIdCounter}`;

/**
 * 目录选择规则类
 */
export class DirectorySelectionRule
  implements SelectionRule<DirectoryRuleConfig>
{
  id: string;
  type: 'directory' = 'directory';
  config: DirectoryRuleConfig;
  enabled: boolean;

  constructor(config: Partial<DirectoryRuleConfig> = {}, id?: string) {
    this.id = id || generateId();
    this.enabled = true;
    this.config = {
      mode: config.mode || 'keepOnePerDirectory',
      directories: config.directories || [],
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
      const matchedPaths = match(this.config.mode)
        .with('keepOnePerDirectory', () =>
          this.executeKeepOnePerDirectory(data),
        )
        .with('selectAllInDirectory', () =>
          this.executeSelectAllInDirectory(data),
        )
        .with('excludeDirectory', () => this.executeExcludeDirectory(data))
        .exhaustive();

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
   * 每个目录保留一个
   */
  private executeKeepOnePerDirectory<T extends BaseEntry & Partial<RefEntry>>(
    data: T[],
  ): Set<string> {
    const result = new Set<string>();

    // 按 groupId 分组
    const groups = this.groupByGroupId(data);

    for (const group of groups) {
      // 按目录分组
      const byDirectory = new Map<string, T[]>();
      for (const item of group) {
        const dir = getDirectory(item.path);
        if (!byDirectory.has(dir)) {
          byDirectory.set(dir, []);
        }
        byDirectory.get(dir)!.push(item);
      }

      // 如果只有一个目录，选择除第一个外的所有
      if (byDirectory.size === 1) {
        const items = Array.from(byDirectory.values())[0];
        // 优先选择非参考文件
        const nonRef = items.filter((item) => !(item as RefEntry).isRef);
        const toSelect = nonRef.length > 0 ? nonRef : items;
        for (const item of toSelect) {
          result.add(item.path);
        }
      } else {
        // 多个目录时，每个目录保留一个（选择其他的）
        for (const [, items] of byDirectory) {
          if (items.length <= 1) continue;
          // 保留第一个，选择其他的
          for (let i = 1; i < items.length; i++) {
            result.add(items[i].path);
          }
        }
      }
    }

    return result;
  }

  /**
   * 选择指定目录中的所有文件
   */
  private executeSelectAllInDirectory<T extends BaseEntry>(
    data: T[],
  ): Set<string> {
    const result = new Set<string>();

    for (const item of data) {
      for (const dir of this.config.directories) {
        if (isInDirectory(item.path, dir)) {
          result.add(item.path);
          break;
        }
      }
    }

    return result;
  }

  /**
   * 排除指定目录中的文件（返回不在目录中的文件）
   */
  private executeExcludeDirectory<T extends BaseEntry>(data: T[]): Set<string> {
    const result = new Set<string>();

    for (const item of data) {
      let inExcludedDir = false;
      for (const dir of this.config.directories) {
        if (isInDirectory(item.path, dir)) {
          inExcludedDir = true;
          break;
        }
      }
      if (inExcludedDir) {
        result.add(item.path);
      }
    }

    return result;
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
      if (groupId === undefined) {
        // 没有 groupId 的作为单独的组
        map.set(-Date.now() - Math.random(), [item]);
        continue;
      }

      if (!map.has(groupId)) {
        map.set(groupId, []);
      }
      map.get(groupId)!.push(item);
    }

    return Array.from(map.values());
  }

  /**
   * 验证配置
   */
  validate(): ValidationResult {
    const errors: string[] = [];

    if (
      ![
        'keepOnePerDirectory',
        'selectAllInDirectory',
        'excludeDirectory',
      ].includes(this.config.mode)
    ) {
      errors.push('无效的目录选择模式');
    }

    if (
      (this.config.mode === 'selectAllInDirectory' ||
        this.config.mode === 'excludeDirectory') &&
      this.config.directories.length === 0
    ) {
      errors.push('请指定至少一个目录');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * 获取规则描述
   */
  describe(): string {
    const modeDesc = match(this.config.mode)
      .with('keepOnePerDirectory', () => '每个目录保留一个')
      .with('selectAllInDirectory', () => '选择目录中所有')
      .with('excludeDirectory', () => '排除目录')
      .exhaustive();

    const dirsDesc =
      this.config.directories.length > 0
        ? ` (${this.config.directories.slice(0, 2).join(', ')}${this.config.directories.length > 2 ? '...' : ''})`
        : '';

    return `目录选择: ${modeDesc}${dirsDesc}`;
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
      for (const path of matched) {
        result.add(path);
      }
    } else {
      if (!keepExisting) {
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
 * 创建目录选择规则
 */
export function createDirectoryRule(
  config?: Partial<DirectoryRuleConfig>,
): DirectorySelectionRule {
  return new DirectorySelectionRule(config);
}
