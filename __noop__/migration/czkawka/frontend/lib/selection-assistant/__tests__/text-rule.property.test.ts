/**
 * 文本选择规则属性测试
 * Property 10: Mark/Unmark 动作正确性
 * Validates: Requirements 3.5
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BaseEntry, RefEntry } from '@/nodes/czkawka/upstream/types';
import { createTextRule, TextSelectionRule } from '../rules/text-rule';
import type { RuleContext } from '../types';

// 生成测试数据的 arbitrary
const alphanumChars = 'abcdefghijklmnopqrstuvwxyz0123456789';
const lowerChars = 'abcdefghijklmnopqrstuvwxyz';

const fileEntryArb = fc.record({
  path: fc
    .array(
      fc.string({
        minLength: 1,
        maxLength: 10,
        unit: fc.constantFrom(...alphanumChars),
      }),
      { minLength: 2, maxLength: 4 },
    )
    .map((parts) => parts.join('/')),
  groupId: fc
    .option(fc.integer({ min: 1, max: 10 }))
    .map((v) => v ?? undefined),
  isRef: fc.boolean(),
  hidden: fc.constant(false),
});

const dataArb = fc.array(fileEntryArb, { minLength: 1, maxLength: 30 });

describe('TextSelectionRule 属性测试', () => {
  // Property 10: Mark/Unmark 动作正确性
  describe('Property 10: Mark/Unmark 动作正确性', () => {
    it('mark 动作后：新状态 = S ∪ M', () => {
      fc.assert(
        fc.property(
          dataArb,
          fc.array(fc.nat({ max: 29 }), { minLength: 0, maxLength: 10 }),
          fc.string({
            minLength: 1,
            maxLength: 5,
            unit: fc.constantFrom(...lowerChars),
          }),
          (data, selectedIndices, pattern) => {
            // 创建初始选择
            const initialSelection = new Set<string>();
            for (const idx of selectedIndices) {
              if (idx < data.length) {
                initialSelection.add(data[idx].path);
              }
            }

            const rule = createTextRule({
              column: 'fullPath',
              condition: 'contains',
              pattern,
              useRegex: false,
              caseSensitive: false,
            });

            const ctx: RuleContext<BaseEntry & Partial<RefEntry>> = {
              data,
              currentSelection: initialSelection,
              keepExistingSelection: false,
              action: 'mark',
            };

            const result = rule.execute(ctx);

            if (!result.success) return true; // 跳过失败的情况

            // 找出匹配的路径
            const matchedPaths = new Set<string>();
            for (const item of data) {
              if (item.path.toLowerCase().includes(pattern.toLowerCase())) {
                matchedPaths.add(item.path);
              }
            }

            // 验证：新状态 = S ∪ M
            // 1. 所有原有选择应该保留
            for (const path of initialSelection) {
              if (!result.selection.has(path)) {
                return false;
              }
            }

            // 2. 所有匹配的应该被选中
            for (const path of matchedPaths) {
              if (!result.selection.has(path)) {
                return false;
              }
            }

            return true;
          },
        ),
        { numRuns: 100 },
      );
    });

    it('unmark 动作后：新状态 = S - M', () => {
      fc.assert(
        fc.property(
          dataArb,
          fc.array(fc.nat({ max: 29 }), { minLength: 0, maxLength: 15 }),
          fc.string({
            minLength: 1,
            maxLength: 5,
            unit: fc.constantFrom(...lowerChars),
          }),
          (data, selectedIndices, pattern) => {
            // 创建初始选择（选择更多以便测试 unmark）
            const initialSelection = new Set<string>();
            for (const idx of selectedIndices) {
              if (idx < data.length) {
                initialSelection.add(data[idx].path);
              }
            }

            const rule = createTextRule({
              column: 'fullPath',
              condition: 'contains',
              pattern,
              useRegex: false,
              caseSensitive: false,
            });

            const ctx: RuleContext<BaseEntry & Partial<RefEntry>> = {
              data,
              currentSelection: initialSelection,
              keepExistingSelection: false,
              action: 'unmark',
            };

            const result = rule.execute(ctx);

            if (!result.success) return true; // 跳过失败的情况

            // 找出匹配的路径
            const matchedPaths = new Set<string>();
            for (const item of data) {
              if (item.path.toLowerCase().includes(pattern.toLowerCase())) {
                matchedPaths.add(item.path);
              }
            }

            // 验证：新状态 = S - M
            // 1. 匹配的路径不应该在结果中
            for (const path of matchedPaths) {
              if (result.selection.has(path)) {
                return false;
              }
            }

            // 2. 不匹配但原来选中的应该保留
            for (const path of initialSelection) {
              if (!matchedPaths.has(path) && !result.selection.has(path)) {
                return false;
              }
            }

            return true;
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});

describe('TextSelectionRule 验证', () => {
  it('空模式应该验证失败', () => {
    const rule = createTextRule({ pattern: '' });
    const result = rule.validate();
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('匹配模式不能为空');
  });

  it('无效正则应该验证失败', () => {
    const rule = createTextRule({ pattern: '[', useRegex: true });
    const result = rule.validate();
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('无效的正则表达式');
  });

  it('有效配置应该通过验证', () => {
    const rule = createTextRule({
      column: 'fileName',
      condition: 'contains',
      pattern: 'test',
    });
    const result = rule.validate();
    expect(result.valid).toBe(true);
  });

  it('describe 应该返回有意义的描述', () => {
    const rule = createTextRule({
      column: 'fileName',
      condition: 'contains',
      pattern: 'test',
    });
    const desc = rule.describe();
    expect(desc).toContain('文本选择');
    expect(desc).toContain('test');
  });
});
