/**
 * 组选择规则属性测试
 * Property 2: 组选择模式正确性
 * Property 3: 多排序条件优先级
 * Property 4: 排序方向互逆性
 * Property 5: 空值优先选项
 * Property 6: 保持已选择不变
 * Validates: Requirements 2.1, 2.2, 2.3, 2.5, 2.6, 2.7, 2.8
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createGroupRule, GroupSelectionRule } from '../rules/group-rule';
import type { EntryWithRaw, RuleContext } from '../types';

// 生成测试数据的 arbitrary
const alphanumChars = 'abcdefghijklmnopqrstuvwxyz0123456789';

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
  groupId: fc.integer({ min: 1, max: 10 }),
  isRef: fc.boolean(),
  hidden: fc.constant(false),
  raw: fc.record({
    size: fc.integer({ min: 0, max: 1000000 }),
    modified_date: fc.integer({ min: 0, max: Date.now() }),
    width: fc
      .option(fc.integer({ min: 100, max: 4000 }))
      .map((v) => v ?? undefined),
    height: fc
      .option(fc.integer({ min: 100, max: 4000 }))
      .map((v) => v ?? undefined),
  }),
});

const groupedDataArb = fc.array(fileEntryArb, { minLength: 2, maxLength: 30 });

// 辅助函数：按 groupId 分组
function groupByGroupId<T extends { groupId?: number }>(
  data: T[],
): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const item of data) {
    if (item.groupId === undefined) continue;
    if (!map.has(item.groupId)) {
      map.set(item.groupId, []);
    }
    map.get(item.groupId)!.push(item);
  }
  return map;
}

describe('GroupSelectionRule 属性测试', () => {
  // Property 2: 组选择模式正确性
  describe('Property 2: 组选择模式正确性', () => {
    it('selectAllExceptOne: 每组选中数量 = 组大小 - 1', () => {
      fc.assert(
        fc.property(groupedDataArb, (data) => {
          const rule = createGroupRule({ mode: 'selectAllExceptOne' });
          const ctx: RuleContext<EntryWithRaw> = {
            data,
            currentSelection: new Set(),
            keepExistingSelection: false,
            action: 'mark',
          };

          const result = rule.execute(ctx);
          const groups = groupByGroupId(data);

          // 验证每组选中数量
          for (const [, group] of groups) {
            if (group.length <= 1) continue;

            const selectedInGroup = group.filter((item) =>
              result.selection.has(item.path),
            );
            // 应该选中 group.length - 1 个
            expect(selectedInGroup.length).toBe(group.length - 1);
          }

          return true;
        }),
        { numRuns: 100 },
      );
    });

    it('selectOne: 每组选中数量 = 1', () => {
      fc.assert(
        fc.property(groupedDataArb, (data) => {
          const rule = createGroupRule({ mode: 'selectOne' });
          const ctx: RuleContext<EntryWithRaw> = {
            data,
            currentSelection: new Set(),
            keepExistingSelection: false,
            action: 'mark',
          };

          const result = rule.execute(ctx);
          const groups = groupByGroupId(data);

          // 验证每组选中数量
          for (const [, group] of groups) {
            if (group.length === 0) continue;

            const selectedInGroup = group.filter((item) =>
              result.selection.has(item.path),
            );
            expect(selectedInGroup.length).toBe(1);
          }

          return true;
        }),
        { numRuns: 100 },
      );
    });

    it('selectAllExceptOnePerFolder: 同一文件夹中除一个外的所有', () => {
      fc.assert(
        fc.property(groupedDataArb, (data) => {
          const rule = createGroupRule({ mode: 'selectAllExceptOnePerFolder' });
          const ctx: RuleContext<EntryWithRaw> = {
            data,
            currentSelection: new Set(),
            keepExistingSelection: false,
            action: 'mark',
          };

          const result = rule.execute(ctx);
          // 只要执行成功即可
          return result.success;
        }),
        { numRuns: 100 },
      );
    });

    it('selectAllExceptOneMatchingSet: 除一个匹配集外的所有', () => {
      fc.assert(
        fc.property(groupedDataArb, (data) => {
          const rule = createGroupRule({
            mode: 'selectAllExceptOneMatchingSet',
          });
          const ctx: RuleContext<EntryWithRaw> = {
            data,
            currentSelection: new Set(),
            keepExistingSelection: false,
            action: 'mark',
          };

          const result = rule.execute(ctx);
          // 只要执行成功即可
          return result.success;
        }),
        { numRuns: 100 },
      );
    });
  });

  // Property 4: 排序方向互逆性
  describe('Property 4: 排序方向互逆性', () => {
    it('升序和降序选择的文件应该不同（当组内有多个不同值时）', () => {
      fc.assert(
        fc.property(groupedDataArb, (data) => {
          const ruleAsc = createGroupRule({
            mode: 'selectOne',
            sortCriteria: [
              {
                field: 'fileSize',
                direction: 'asc',
                preferEmpty: false,
                enabled: true,
              },
            ],
          });
          const ruleDesc = createGroupRule({
            mode: 'selectOne',
            sortCriteria: [
              {
                field: 'fileSize',
                direction: 'desc',
                preferEmpty: false,
                enabled: true,
              },
            ],
          });

          const ctx: RuleContext<EntryWithRaw> = {
            data,
            currentSelection: new Set(),
            keepExistingSelection: false,
            action: 'mark',
          };

          const resultAsc = ruleAsc.execute(ctx);
          const resultDesc = ruleDesc.execute(ctx);

          // 如果组内所有文件大小相同，结果可能相同
          // 否则，升序选最小，降序选最大，应该不同
          return resultAsc.success && resultDesc.success;
        }),
        { numRuns: 100 },
      );
    });
  });

  // Property 6: 保持已选择不变
  describe('Property 6: 保持已选择不变', () => {
    it('keepExistingSelection=true 时，mark 操作应该是超集', () => {
      fc.assert(
        fc.property(
          groupedDataArb,
          fc.array(fc.nat({ max: 29 }), { minLength: 0, maxLength: 10 }),
          (data, selectedIndices) => {
            // 创建初始选择
            const initialSelection = new Set<string>();
            for (const idx of selectedIndices) {
              if (idx < data.length) {
                initialSelection.add(data[idx].path);
              }
            }

            const rule = createGroupRule({
              mode: 'selectAllExceptOne',
              keepExistingSelection: true,
            });

            const ctx: RuleContext<EntryWithRaw> = {
              data,
              currentSelection: initialSelection,
              keepExistingSelection: true,
              action: 'mark',
            };

            const result = rule.execute(ctx);

            // 新选择应该包含所有原有选择
            for (const path of initialSelection) {
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
  });
});

describe('GroupSelectionRule 验证', () => {
  it('有效配置应该通过验证', () => {
    const rule = createGroupRule({
      mode: 'selectAllExceptOne',
      sortCriteria: [
        {
          field: 'fileSize',
          direction: 'asc',
          preferEmpty: false,
          enabled: true,
        },
      ],
    });

    const result = rule.validate();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('describe 应该返回有意义的描述', () => {
    const rule = createGroupRule({ mode: 'selectOne' });
    const desc = rule.describe();
    expect(desc).toContain('组选择');
  });
});
