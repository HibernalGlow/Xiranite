/**
 * 清除和刷新属性测试
 * Reset and Refresh Property Tests
 *
 * **Property 9: 清除过滤器恢复默认状态**
 * **Property 11: 刷新过滤器幂等性**
 * **Validates: Requirements 8.2, 11.2**
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyFilters, refreshFilters, resetToDefault } from '../filter-engine';
import { defaultFilterState } from '../presets';
import type { FilterableEntry, FilterContext, FilterState } from '../types';

describe('Reset and Refresh - Property Tests', () => {
  // 生成测试数据
  const fileEntryArb = fc.record({
    path: fc.string({ minLength: 5, maxLength: 50 }),
    groupId: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
    isRef: fc.boolean(),
    size: fc.constantFrom('100 B', '1 KB', '10 MB', '1 GB'),
    raw: fc.record({
      size: fc.integer({ min: 0, max: 1000000000 }),
      modified_date: fc.integer({ min: 0, max: Date.now() }),
    }),
  });

  const fileEntriesArb = fc.array(fileEntryArb, {
    minLength: 1,
    maxLength: 30,
  });

  /**
   * Property 9: 清除过滤器恢复默认状态
   * For any 过滤状态 S，执行清除操作后，状态应该等于默认过滤状态
   */
  describe('Property 9: Reset to Default State', () => {
    it('should return default filter state', () => {
      const result = resetToDefault();

      // 验证所有过滤器都被禁用
      expect(result.markStatus.enabled).toBe(false);
      expect(result.markStatus.options).toEqual([]);
      expect(result.groupCount.enabled).toBe(false);
      expect(result.groupSize.enabled).toBe(false);
      expect(result.fileSize.enabled).toBe(false);
      expect(result.extension.enabled).toBe(false);
      expect(result.modifiedDate.enabled).toBe(false);
      expect(result.path.enabled).toBe(false);
      expect(result.similarity.enabled).toBe(false);
      expect(result.resolution.enabled).toBe(false);
      expect(result.selectionOnly).toBe(false);
      expect(result.showAllInFilteredGroups).toBe(true);
      expect(result.preset).toBe('none');
    });

    it('should return a new object each time', () => {
      const result1 = resetToDefault();
      const result2 = resetToDefault();

      expect(result1).not.toBe(result2);
      expect(result1).toEqual(result2);
    });
  });

  /**
   * Property 11: 刷新过滤器幂等性
   * For any 数据集 D 和过滤状态 S，刷新操作的结果应该与重新应用过滤器的结果一致
   */
  describe('Property 11: Refresh Idempotency', () => {
    it('should produce same result as applyFilters', () => {
      fc.assert(
        fc.property(fileEntriesArb, (data) => {
          const selection = new Set<string>();
          const filterState: FilterState = {
            ...defaultFilterState,
            fileSize: { enabled: true, min: 0, max: 1e9 },
          };

          const ctx: FilterContext<FilterableEntry> = {
            data,
            selection,
            filterState,
          };

          const applyResult = applyFilters(ctx);
          const refreshResult = refreshFilters(ctx);

          expect(refreshResult.filteredData).toEqual(applyResult.filteredData);
          expect(refreshResult.stats).toEqual(applyResult.stats);
        }),
        { numRuns: 100 },
      );
    });

    it('should be idempotent - multiple refreshes produce same result', () => {
      fc.assert(
        fc.property(fileEntriesArb, (data) => {
          const selection = new Set<string>();
          const filterState: FilterState = {
            ...defaultFilterState,
            groupCount: { enabled: true, min: 1, max: 50 },
          };

          const ctx: FilterContext<FilterableEntry> = {
            data,
            selection,
            filterState,
          };

          const result1 = refreshFilters(ctx);
          const result2 = refreshFilters(ctx);
          const result3 = refreshFilters(ctx);

          expect(result1.filteredData).toEqual(result2.filteredData);
          expect(result2.filteredData).toEqual(result3.filteredData);
        }),
        { numRuns: 100 },
      );
    });
  });
});
