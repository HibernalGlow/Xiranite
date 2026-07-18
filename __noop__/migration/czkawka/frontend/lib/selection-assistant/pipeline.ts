/**
 * 规则管道
 * 支持多个规则的组合执行
 */

import type { BaseEntry, RefEntry } from '@/nodes/czkawka/upstream/types';
import { DirectorySelectionRule } from './rules/directory-rule';
import { GroupSelectionRule } from './rules/group-rule';
import { TextSelectionRule } from './rules/text-rule';
import type {
  DirectoryRuleConfig,
  GroupRuleConfig,
  PipelineConfig,
  RuleContext,
  RuleResult,
  SelectionRule,
  SerializedRule,
  TextRuleConfig,
  ValidationResult,
} from './types';

/** 生成唯一 ID */
let pipelineIdCounter = 0;
const generateId = () => `pipeline-${++pipelineIdCounter}`;

/**
 * 规则管道类
 */
export class RulePipeline {
  private id: string;
  private name: string;
  private rules: SelectionRule[] = [];

  constructor(name = '默认管道') {
    this.id = generateId();
    this.name = name;
  }

  /**
   * 添加规则
   */
  addRule(rule: SelectionRule): void {
    this.rules.push(rule);
  }

  /**
   * 移除规则
   */
  removeRule(ruleId: string): void {
    this.rules = this.rules.filter((r) => r.id !== ruleId);
  }

  /**
   * 重新排序规则
   */
  reorderRules(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= this.rules.length) return;
    if (toIndex < 0 || toIndex >= this.rules.length) return;

    const [rule] = this.rules.splice(fromIndex, 1);
    this.rules.splice(toIndex, 0, rule);
  }

  /**
   * 启用/禁用规则
   */
  enableRule(ruleId: string, enabled: boolean): void {
    const rule = this.rules.find((r) => r.id === ruleId);
    if (rule) {
      rule.enabled = enabled;
    }
  }

  /**
   * 获取所有规则
   */
  getRules(): SelectionRule[] {
    return [...this.rules];
  }

  /**
   * 获取启用的规则
   */
  getEnabledRules(): SelectionRule[] {
    return this.rules.filter((r) => r.enabled);
  }

  /**
   * 执行管道
   * 按顺序执行所有启用的规则
   */
  execute<T extends BaseEntry & Partial<RefEntry>>(
    ctx: RuleContext<T>,
  ): RuleResult {
    const enabledRules = this.getEnabledRules();

    if (enabledRules.length === 0) {
      return {
        selection: ctx.currentSelection,
        affectedCount: 0,
        success: true,
      };
    }

    let currentSelection = ctx.currentSelection;
    let totalAffected = 0;
    const errors: string[] = [];

    for (const rule of enabledRules) {
      // 验证规则
      const validation = rule.validate();
      if (!validation.valid) {
        // 跳过无效规则
        errors.push(
          `规则 ${rule.id} 验证失败: ${validation.errors.join(', ')}`,
        );
        continue;
      }

      // 执行规则
      const result = rule.execute({
        ...ctx,
        currentSelection,
      });

      if (result.success) {
        totalAffected += result.affectedCount;
        currentSelection = result.selection;
      } else {
        errors.push(`规则 ${rule.id} 执行失败: ${result.error}`);
      }
    }

    return {
      selection: currentSelection,
      affectedCount: totalAffected,
      success: errors.length === 0,
      error: errors.length > 0 ? errors.join('; ') : undefined,
    };
  }

  /**
   * 验证管道
   */
  validate(): ValidationResult {
    const errors: string[] = [];

    for (const rule of this.rules) {
      const result = rule.validate();
      if (!result.valid) {
        errors.push(...result.errors.map((e) => `[${rule.id}] ${e}`));
      }
    }

    return { valid: errors.length === 0, errors };
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
   * 序列化为 JSON
   */
  toJSON(): PipelineConfig {
    return {
      name: this.name,
      rules: this.rules.map((rule) => ({
        id: rule.id,
        type: rule.type,
        config: rule.config as
          | GroupRuleConfig
          | TextRuleConfig
          | DirectoryRuleConfig,
        enabled: rule.enabled,
      })),
    };
  }

  /**
   * 从 JSON 反序列化
   */
  static fromJSON(config: PipelineConfig): RulePipeline {
    const pipeline = new RulePipeline(config.name);

    for (const ruleConfig of config.rules) {
      const rule = RulePipeline.createRuleFromConfig(ruleConfig);
      if (rule) {
        pipeline.addRule(rule);
      }
    }

    return pipeline;
  }

  /**
   * 从配置创建规则
   */
  private static createRuleFromConfig(
    config: SerializedRule,
  ): SelectionRule | null {
    switch (config.type) {
      case 'group':
        return new GroupSelectionRule(
          config.config as GroupRuleConfig,
          config.id,
        );
      case 'text':
        return new TextSelectionRule(
          config.config as TextRuleConfig,
          config.id,
        );
      case 'directory':
        return new DirectorySelectionRule(
          config.config as DirectoryRuleConfig,
          config.id,
        );
      default:
        return null;
    }
  }
}

/**
 * 创建规则管道
 */
export function createPipeline(name?: string): RulePipeline {
  return new RulePipeline(name);
}
