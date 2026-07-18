/**
 * 过滤作用域属性测试
 * Filtered Scope Property Tests
 *
 * **Property 12: 过滤后操作作用域**
 * **Validates: Requirements 12.2, 12.3, 12.4, 12.7**
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BaseEntry } from '@/nodes/czkawka/upstream/types';
import {
  deselectAllFiltered,
  getFilteredSelectionStats,
  getSelectedInFiltered,
  invertSelectionFiltered,
  isAllFilteredSelected,
  isAnyFilteredSelected,
  selectAllFiltered,
} from '../use-filtered-scope';

describe('Filtered Scope - Property Tests', () => {
  // 生成测试数据
  const fileEntryArb = fc.record({
    path: fc.string({ minLength: 5, maxLength: 50 }),
  });

  const fileEntriesArb = fc.array(fileEntryArb, {
    minLength: 1,
    maxLength: 30,
  });

  /**
   * Property 12: 过滤后操作作用域
   * For any 数据集 D、过滤状态 S 和选择操作 O，操作应该只影响过滤后可见的项目
   */
  describe('Property 12: Filtered Operation Scope', () => {
    describe('selectAllFiltered', () => {
      it('should only add filtered items to selection', () => {
        fc.assert(
          fc.property(
            fileEntriesArb,
            fileEntriesArb,
            (allData, filteredData) => {
              // 确保 filteredData 是 allData 的子集
              const filteredSubset = filteredData.filter((f) =>
                allData.some((a) => a.path === f.path),
              );

              const currentSelection = new Set<string>();
              const result = selectAllFiltered(
                filteredSubset,
                currentSelection,
              );

              // 所有过滤后的项目都应该被选中
              for (const item of filteredSubset) {
                expect(result.has(item.path)).toBe(true);
              }
            },
          ),
          { numRuns: 100 },
        );
      });

      it('should preserve existing selections outside filtered data', () => {
        fc.assert(
          fc.property(fileEntriesArb, (data) => {
            // 创建一些不在过滤数据中的选择
            const outsideSelection = new Set([
              'outside/path/1',
              'outside/path/2',
            ]);
            const filteredData = data.slice(0, Math.ceil(data.length / 2));

            const result = selectAllFiltered(filteredData, outsideSelection);

            // 外部选择应该保留
            expect(result.has('outside/path/1')).toBe(true);
            expect(result.has('outside/path/2')).toBe(true);
          }),
          { numRuns: 100 },
        );
      });
    });

    describe('invertSelectionFiltered', () => {
      it('should only invert selection for filtered items', () => {
        fc.assert(
          fc.property(fileEntriesArb, (data) => {
            // 选择一半的项目
            const halfSelected = new Set(
              data.slice(0, Math.ceil(data.length / 2)).map((d) => d.path),
            );

            const result = invertSelectionFiltered(data, halfSelected);

            // 之前选中的应该取消选中，之前未选中的应该选中
            for (const item of data) {
              const wasSelected = halfSelected.has(item.path);
              const isNowSelected = result.has(item.path);
              expect(isNowSelected).toBe(!wasSelected);
            }
          }),
          { numRuns: 100 },
        );
      });

      it('should preserve selections outside filtered data', () => {
        fc.assert(
          fc.property(fileEntriesArb, (data) => {
            const outsideSelection = new Set(['outside/path/1']);
            const result = invertSelectionFiltered(data, outsideSelection);

            // 外部选择应该保留（因为不在过滤数据中）
            expect(result.has('outside/path/1')).toBe(true);
          }),
          { numRuns: 100 },
        );
      });
    });

    describe('deselectAllFiltered', () => {
      it('should only remove filtered items from selection', () => {
        fc.assert(
          fc.property(fileEntriesArb, (data) => {
            // 全选
            const allSelected = new Set(data.map((d) => d.path));
            allSelected.add('outside/path/1'); // 添加外部选择

            const result = deselectAllFiltered(data, allSelected);

            // 过滤数据中的项目应该被取消选中
            for (const item of data) {
              expect(result.has(item.path)).toBe(false);
            }

            // 外部选择应该保留
            expect(result.has('outside/path/1')).toBe(true);
          }),
          { numRuns: 100 },
        );
      });
    });
  });

  describe('getSelectedInFiltered', () => {
    it('should return only selected items from filtered data', () => {
      fc.assert(
        fc.property(fileEntriesArb, (data) => {
          const selection = new Set(
            data.filter(() => Math.random() > 0.5).map((d) => d.path),
          );

          const result = getSelectedInFiltered(data, selection);

          // 所有返回的项目都应该在选择集合中
          for (const item of result) {
            expect(selection.has(item.path)).toBe(true);
          }

          // 返回数量应该等于过滤数据中被选中的数量
          const expectedCount = data.filter((d) =>
            selection.has(d.path),
          ).length;
          expect(result.length).toBe(expectedCount);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('getFilteredSelectionStats', () => {
    it('should return correct statistics', () => {
      fc.assert(
        fc.property(fileEntriesArb, (data) => {
          const selection = new Set(
            data.filter(() => Math.random() > 0.5).map((d) => d.path),
          );

          const stats = getFilteredSelectionStats(data, selection);

          expect(stats.total).toBe(data.length);
          expect(stats.selected).toBe(
            data.filter((d) => selection.has(d.path)).length,
          );
          expect(stats.selected).toBeLessThanOrEqual(stats.total);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('isAllFilteredSelected', () => {
    it('should return true only when all filtered items are selected', () => {
      fc.assert(
        fc.property(fileEntriesArb, (data) => {
          if (data.length === 0) return;

          // 全选
          const allSelected = new Set(data.map((d) => d.path));
          expect(isAllFilteredSelected(data, allSelected)).toBe(true);

          // 部分选择
          const partialSelected = new Set(data.slice(0, -1).map((d) => d.path));
          if (data.length > 1) {
            expect(isAllFilteredSelected(data, partialSelected)).toBe(false);
          }

          // 无选择
          const noneSelected = new Set<string>();
          expect(isAllFilteredSelected(data, noneSelected)).toBe(false);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('isAnyFilteredSelected', () => {
    it('should return true when at least one filtered item is selected', () => {
      fc.assert(
        fc.property(fileEntriesArb, (data) => {
          if (data.length === 0) return;

          // 选择一个
          const oneSelected = new Set([data[0].path]);
          expect(isAnyFilteredSelected(data, oneSelected)).toBe(true);

          // 无选择
          const noneSelected = new Set<string>();
          expect(isAnyFilteredSelected(data, noneSelected)).toBe(false);
        }),
        { numRuns: 100 },
      );
    });
  });
});
