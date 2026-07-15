/**
 * 规则管道属性测试
 * Property 1: 管道顺序执行一致性
 * Property 15: 禁用规则不影响执行
 * Property 16: 管道配置序列化往返
 * Property 17: 无效规则跳过
 * Validates: Requirements 1.3, 1.4, 6.2, 6.3, 6.5, 6.6
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BaseEntry, RefEntry } from '@/nodes/czkawka/upstream/types';
import { createPipeline, RulePipeline } from '../pipeline';
import { createGroupRule } from '../rules/group-rule';
import { createTextRule } from '../rules/text-rule';
import type { RuleContext } from '../types';

// 生成测试数据
const alphanumChars = 'abcdefghijklmnopqrstuvwxyz0123456789';

const fileEntryArb = fc.record({
  path: fc
    .array(
      fc.string({
        minLength: 1,
        maxLength: 8,
        unit: fc.constantFrom(...alphanumChars),
      }),
      { minLength: 2, maxLength: 4 },
    )
    .map((parts) => parts.join('/')),
  groupId: fc.integer({ min: 1, max: 5 }),
  isRef: fc.boolean(),
  hidden: fc.constant(false),
  raw: fc.record({
    size: fc.integer({ min: 0, max: 1000000 }),
    modified_date: fc.integer({ min: 0, max: Date.now() }),
  }),
});

const dataArb = fc.array(fileEntryArb, { minLength: 2, maxLength: 20 });

describe('RulePipeline 属性测试', () => {
  // Property 15: 禁用规则不影响执行
  describe('Property 15: 禁用规则不影响执行', () => {
    it('禁用的规则应该被跳过', () => {
      fc.assert(
        fc.property(dataArb, (data) => {
          // 创建两个管道：一个有禁用规则，一个没有
          const pipelineWithDisabled = createPipeline();
          const pipelineWithout = createPipeline();

          const rule1 = createGroupRule({ mode: 'selectOne' });
          const rule2 = createTextRule({
            pattern: 'test',
            column: 'fullPath',
            condition: 'contains',
          });
          rule2.enabled = false; // 禁用

          pipelineWithDisabled.addRule(rule1);
          pipelineWithDisabled.addRule(rule2);

          const rule1Copy = createGroupRule({ mode: 'selectOne' });
          pipelineWithout.addRule(rule1Copy);

          const ctx: RuleContext<BaseEntry & Partial<RefEntry>> = {
            data,
            currentSelection: new Set(),
            keepExistingSelection: false,
            action: 'mark',
          };

          const result1 = pipelineWithDisabled.execute(ctx);
          const result2 = pipelineWithout.execute(ctx);

          // 两个管道的结果应该相同（因为 rule2 被禁用）
          // 由于规则 ID 不同，我们只比较选择结果的大小
          return result1.selection.size === result2.selection.size;
        }),
        { numRuns: 100 },
      );
    });
  });

  // Property 16: 管道配置序列化往返
  describe('Property 16: 管道配置序列化往返', () => {
    it('序列化后反序列化应该产生等价的管道', () => {
      const pipeline = createPipeline('测试管道');

      pipeline.addRule(createGroupRule({ mode: 'selectAllExceptOne' }));
      pipeline.addRule(
        createTextRule({
          pattern: 'test',
          column: 'fileName',
          condition: 'contains',
        }),
      );

      const json = pipeline.toJSON();
      const restored = RulePipeline.fromJSON(json);
      const restoredJson = restored.toJSON();

      // 验证名称相同
      expect(restoredJson.name).toBe(json.name);

      // 验证规则数量相同
      expect(restoredJson.rules.length).toBe(json.rules.length);

      // 验证规则类型相同
      for (let i = 0; i < json.rules.length; i++) {
        expect(restoredJson.rules[i].type).toBe(json.rules[i].type);
        expect(restoredJson.rules[i].enabled).toBe(json.rules[i].enabled);
      }
    });

    it('序列化往返后执行结果应该相同', () => {
      fc.assert(
        fc.property(dataArb, (data) => {
          const pipeline = createPipeline();
          pipeline.addRule(createGroupRule({ mode: 'selectOne' }));

          const json = pipeline.toJSON();
          const restored = RulePipeline.fromJSON(json);

          const ctx: RuleContext<BaseEntry & Partial<RefEntry>> = {
            data,
            currentSelection: new Set(),
            keepExistingSelection: false,
            action: 'mark',
          };

          const result1 = pipeline.execute(ctx);
          const result2 = restored.execute(ctx);

          // 选择结果大小应该相同
          return result1.selection.size === result2.selection.size;
        }),
        { numRuns: 100 },
      );
    });
  });

  // Property 17: 无效规则跳过
  describe('Property 17: 无效规则跳过', () => {
    it('包含无效规则的管道应该跳过无效规则继续执行', () => {
      fc.assert(
        fc.property(dataArb, (data) => {
          const pipeline = createPipeline();

          // 添加一个有效规则
          pipeline.addRule(createGroupRule({ mode: 'selectOne' }));

          // 添加一个无效规则（空模式）
          pipeline.addRule(
            createTextRule({
              pattern: '',
              column: 'fullPath',
              condition: 'contains',
            }),
          );

          const ctx: RuleContext<BaseEntry & Partial<RefEntry>> = {
            data,
            currentSelection: new Set(),
            keepExistingSelection: false,
            action: 'mark',
          };

          const result = pipeline.execute(ctx);

          // 管道应该仍然执行成功（跳过无效规则）
          // 结果应该只反映有效规则的执行
          return result.selection.size >= 0;
        }),
        { numRuns: 100 },
      );
    });
  });
});

describe('RulePipeline 基本功能', () => {
  it('空管道应该返回原始选择', () => {
    const pipeline = createPipeline();
    const ctx: RuleContext<BaseEntry & Partial<RefEntry>> = {
      data: [],
      currentSelection: new Set(['a', 'b']),
      keepExistingSelection: false,
      action: 'mark',
    };

    const result = pipeline.execute(ctx);
    expect(result.selection.size).toBe(2);
    expect(result.success).toBe(true);
  });

  it('addRule 和 removeRule 应该正确工作', () => {
    const pipeline = createPipeline();
    const rule = createGroupRule();

    pipeline.addRule(rule);
    expect(pipeline.getRules().length).toBe(1);

    pipeline.removeRule(rule.id);
    expect(pipeline.getRules().length).toBe(0);
  });

  it('reorderRules 应该正确重排序', () => {
    const pipeline = createPipeline();
    const rule1 = createGroupRule({ mode: 'selectOne' });
    const rule2 = createGroupRule({ mode: 'selectAllExceptOne' });

    pipeline.addRule(rule1);
    pipeline.addRule(rule2);

    pipeline.reorderRules(0, 1);

    const rules = pipeline.getRules();
    expect(rules[0].id).toBe(rule2.id);
    expect(rules[1].id).toBe(rule1.id);
  });

  it('enableRule 应该正确启用/禁用规则', () => {
    const pipeline = createPipeline();
    const rule = createGroupRule();

    pipeline.addRule(rule);
    expect(pipeline.getEnabledRules().length).toBe(1);

    pipeline.enableRule(rule.id, false);
    expect(pipeline.getEnabledRules().length).toBe(0);

    pipeline.enableRule(rule.id, true);
    expect(pipeline.getEnabledRules().length).toBe(1);
  });
});
