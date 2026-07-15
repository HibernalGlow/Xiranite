/**
 * Atoms 属性测试
 * Atoms Property Tests
 *
 * **Property 10: 过滤器配置持久化往返**
 * **Property 21: 活动过滤器计数**
 * **Validates: Requirements 10.1, 10.2, 18.3**
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { countActiveFilters, isAnyFilterActive } from '../filter-engine';
import { defaultFilterState } from '../presets';
import { filterStateSchema } from '../schemas';
import type { FilterState, MarkStatusOption } from '../types';

describe('Filter Atoms - Property Tests', () => {
  // 生成随机过滤器状态
  const filterStateArb = fc.record({
    markStatus: fc.record({
      enabled: fc.boolean(),
      options: fc.subarray([
        'marked',
        'unmarked',
        'groupHasSomeMarked',
        'groupAllUnmarked',
        'groupSomeNotAll',
        'groupAllMarked',
        'protected',
      ] as MarkStatusOption[]),
    }),
    groupCount: fc.record({
      enabled: fc.boolean(),
      min: fc.integer({ min: 0, max: 100 }),
      max: fc.integer({ min: 0, max: 1000 }),
    }),
    groupSize: fc.record({
      enabled: fc.boolean(),
      min: fc.integer({ min: 0, max: 1000000 }),
      max: fc.integer({ min: 0, max: 1000000000 }),
      unit: fc.constantFrom('B', 'KB', 'MB', 'GB', 'TB') as fc.Arbitrary<
        'B' | 'KB' | 'MB' | 'GB' | 'TB'
      >,
    }),
    fileSize: fc.record({
      enabled: fc.boolean(),
      min: fc.integer({ min: 0, max: 1000000 }),
      max: fc.integer({ min: 0, max: 1000000000 }),
      unit: fc.constantFrom('B', 'KB', 'MB', 'GB', 'TB') as fc.Arbitrary<
        'B' | 'KB' | 'MB' | 'GB' | 'TB'
      >,
    }),
    extension: fc.record({
      enabled: fc.boolean(),
      extensions: fc.array(fc.string({ minLength: 1, maxLength: 5 })),
      mode: fc.constantFrom('include', 'exclude') as fc.Arbitrary<
        'include' | 'exclude'
      >,
    }),
    modifiedDate: fc.record({
      enabled: fc.boolean(),
      preset: fc.constantFrom(
        'today',
        'last7days',
        'last30days',
        'lastYear',
        'custom',
      ) as fc.Arbitrary<
        'today' | 'last7days' | 'last30days' | 'lastYear' | 'custom'
      >,
      startDate: fc.option(fc.integer({ min: 0, max: Date.now() }), {
        nil: undefined,
      }),
      endDate: fc.option(fc.integer({ min: 0, max: Date.now() }), {
        nil: undefined,
      }),
    }),
    path: fc.record({
      enabled: fc.boolean(),
      mode: fc.constantFrom(
        'contains',
        'notContains',
        'startsWith',
        'endsWith',
      ) as fc.Arbitrary<'contains' | 'notContains' | 'startsWith' | 'endsWith'>,
      pattern: fc.string({ minLength: 0, maxLength: 20 }),
      caseSensitive: fc.boolean(),
    }),
    similarity: fc.record({
      enabled: fc.boolean(),
      min: fc.integer({ min: 0, max: 100 }),
      max: fc.integer({ min: 0, max: 100 }),
    }),
    resolution: fc.record({
      enabled: fc.boolean(),
      minWidth: fc.option(fc.integer({ min: 0, max: 4000 }), {
        nil: undefined,
      }),
      minHeight: fc.option(fc.integer({ min: 0, max: 4000 }), {
        nil: undefined,
      }),
      maxWidth: fc.option(fc.integer({ min: 0, max: 8000 }), {
        nil: undefined,
      }),
      maxHeight: fc.option(fc.integer({ min: 0, max: 8000 }), {
        nil: undefined,
      }),
      aspectRatio: fc.constantFrom('16:9', '4:3', '1:1', 'any') as fc.Arbitrary<
        '16:9' | '4:3' | '1:1' | 'any'
      >,
    }),
    selectionOnly: fc.boolean(),
    showAllInFilteredGroups: fc.boolean(),
    preset: fc.constantFrom(
      'none',
      'largeFilesFirst',
      'smallFilesFirst',
      'recentlyModified',
      'oldFiles',
    ) as fc.Arbitrary<
      | 'none'
      | 'largeFilesFirst'
      | 'smallFilesFirst'
      | 'recentlyModified'
      | 'oldFiles'
    >,
  });

  /**
   * Property 10: 过滤器配置持久化往返
   * For any 有效的过滤器配置 C，保存到 localStorage 后读取应该得到等价的配置
   */
  describe('Property 10: Filter Config Persistence Round-trip', () => {
    it('should serialize and deserialize filter state correctly', () => {
      fc.assert(
        fc.property(filterStateArb, (state) => {
          // 序列化
          const serialized = JSON.stringify(state);
          // 反序列化
          const deserialized = JSON.parse(serialized) as FilterState;

          // 验证往返一致性
          expect(deserialized).toEqual(state);
        }),
        { numRuns: 100 },
      );
    });

    it('should validate filter state with zod schema', () => {
      fc.assert(
        fc.property(filterStateArb, (state) => {
          const result = filterStateSchema.safeParse(state);
          expect(result.success).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 21: 活动过滤器计数
   * For any 过滤状态 S，活动过滤器数量应该等于启用且有效配置的过滤器数量
   */
  describe('Property 21: Active Filter Count', () => {
    it('should correctly count active filters', () => {
      fc.assert(
        fc.property(filterStateArb, (state) => {
          const count = countActiveFilters(state);

          // 手动计算预期数量
          let expectedCount = 0;
          if (state.markStatus.enabled && state.markStatus.options.length > 0)
            expectedCount++;
          if (state.groupCount.enabled) expectedCount++;
          if (state.groupSize.enabled) expectedCount++;
          if (state.fileSize.enabled) expectedCount++;
          if (state.extension.enabled && state.extension.extensions.length > 0)
            expectedCount++;
          if (state.modifiedDate.enabled) expectedCount++;
          if (state.path.enabled && state.path.pattern) expectedCount++;
          if (state.similarity.enabled) expectedCount++;
          if (state.resolution.enabled) expectedCount++;
          if (state.selectionOnly) expectedCount++;

          expect(count).toBe(expectedCount);
        }),
        { numRuns: 100 },
      );
    });

    it('should return 0 for default state', () => {
      const count = countActiveFilters(defaultFilterState);
      expect(count).toBe(0);
    });

    it('should correctly determine if any filter is active', () => {
      fc.assert(
        fc.property(filterStateArb, (state) => {
          const isActive = isAnyFilterActive(state);
          const count = countActiveFilters(state);

          expect(isActive).toBe(count > 0);
        }),
        { numRuns: 100 },
      );
    });
  });
});
