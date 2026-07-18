/**
 * 过滤器引擎属性测试
 * Filter Engine Property Tests
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyDateFilter,
  applyExtensionFilter,
  applyFileSizeFilter,
  applyFilters,
  applyGroupCountFilter,
  applyGroupSizeFilter,
  applyMarkStatusFilter,
  applyPathFilter,
  applyResolutionFilter,
  applySelectionFilter,
  applyShowAllInFilteredGroups,
  applySimilarityFilter,
  calculateStats,
  countActiveFilters,
} from '../filter-engine';
import type { FilterableEntry, FilterState, MarkStatusOption } from '../types';
import { getUniqueGroupIds } from '../utils';

// 生成测试数据的 Arbitrary
const fileEntryArb = fc.record({
  path: fc.string({ minLength: 5, maxLength: 50 }),
  groupId: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
  isRef: fc.boolean(),
  size: fc.constantFrom('100 B', '1 KB', '10 MB', '1 GB'),
  modifiedDate: fc.date().map((d) => d.toISOString()),
  similarity: fc.constantFrom('90%', '80%', '70%', '60%'),
  dimensions: fc.constantFrom('1920x1080', '1280x720', '800x600'),
  raw: fc.record({
    size: fc.integer({ min: 0, max: 1000000000 }),
    modified_date: fc.integer({ min: 0, max: Date.now() }),
    width: fc.integer({ min: 100, max: 4000 }),
    height: fc.integer({ min: 100, max: 4000 }),
  }),
});

const fileEntriesArb = fc.array(fileEntryArb, { minLength: 1, maxLength: 30 });

describe('Filter Engine - Property Tests', () => {
  /**
   * Property 1: 标记状态过滤 OR 逻辑
   */
  describe('Property 1: Mark Status Filter OR Logic', () => {
    it('should return items matching ANY selected status (OR logic)', () => {
      fc.assert(
        fc.property(
          fileEntriesArb,
          fc.subarray(['marked', 'unmarked'] as MarkStatusOption[]),
          (data, options) => {
            const selection = new Set(
              data.filter(() => Math.random() > 0.5).map((d) => d.path),
            );
            const result = applyMarkStatusFilter(data, options, selection);

            if (options.length === 0) {
              expect(result.length).toBe(data.length);
            } else {
              // 每个结果项应该匹配至少一个选项
              for (const item of result) {
                const isMarked = selection.has(item.path);
                const matchesAny = options.some((opt) => {
                  if (opt === 'marked') return isMarked;
                  if (opt === 'unmarked') return !isMarked;
                  return false;
                });
                expect(matchesAny).toBe(true);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 2: 组文件数量范围过滤
   */
  describe('Property 2: Group Count Range Filter', () => {
    it('should only include groups with file count within range', () => {
      fc.assert(
        fc.property(
          fileEntriesArb,
          fc.integer({ min: 1, max: 5 }),
          fc.integer({ min: 5, max: 20 }),
          (data, minCount, maxCount) => {
            const config = { enabled: true, min: minCount, max: maxCount };
            const result = applyGroupCountFilter(data, config);

            const resultGroupIds = getUniqueGroupIds(result);
            for (const groupId of resultGroupIds) {
              const count = result.filter(
                (item) => 'groupId' in item && item.groupId === groupId,
              ).length;
              expect(count).toBeGreaterThanOrEqual(minCount);
              expect(count).toBeLessThanOrEqual(maxCount);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 3: 组大小范围过滤
   */
  describe('Property 3: Group Size Range Filter', () => {
    it('should only include groups with total size within range', () => {
      fc.assert(
        fc.property(
          fileEntriesArb,
          fc.integer({ min: 0, max: 1000000 }),
          fc.integer({ min: 1000000, max: 1000000000 }),
          (data, minSize, maxSize) => {
            const config = { enabled: true, min: minSize, max: maxSize };
            const result = applyGroupSizeFilter(data, config);

            // 验证结果中的组大小在范围内
            const resultGroupIds = getUniqueGroupIds(result);
            for (const groupId of resultGroupIds) {
              const groupItems = result.filter(
                (item) => 'groupId' in item && item.groupId === groupId,
              );
              const totalSize = groupItems.reduce(
                (sum, item) => sum + (item.raw?.size ?? 0),
                0,
              );
              expect(totalSize).toBeGreaterThanOrEqual(minSize);
              expect(totalSize).toBeLessThanOrEqual(maxSize);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 5: 文件大小范围过滤
   */
  describe('Property 5: File Size Range Filter', () => {
    it('should only include files with size within range', () => {
      fc.assert(
        fc.property(
          fileEntriesArb,
          fc.integer({ min: 0, max: 1000000 }),
          fc.integer({ min: 1000000, max: 1000000000 }),
          (data, minSize, maxSize) => {
            const config = { enabled: true, min: minSize, max: maxSize };
            const result = applyFileSizeFilter(data, config);

            for (const item of result) {
              const size = item.raw?.size ?? 0;
              expect(size).toBeGreaterThanOrEqual(minSize);
              expect(size).toBeLessThanOrEqual(maxSize);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 7: 已选择项过滤
   */
  describe('Property 7: Selection Filter', () => {
    it('should only include selected items when enabled', () => {
      fc.assert(
        fc.property(fileEntriesArb, (data) => {
          const selection = new Set(
            data.filter(() => Math.random() > 0.5).map((d) => d.path),
          );
          const result = applySelectionFilter(data, selection, true);

          // 所有结果项都应该在选择集合中
          for (const item of result) {
            expect(selection.has(item.path)).toBe(true);
          }
          // 结果数量应该等于选择数量（在数据中存在的）
          expect(result.length).toBe(
            data.filter((d) => selection.has(d.path)).length,
          );
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 8: 组内显示所有文件选项
   */
  describe('Property 8: Show All In Filtered Groups', () => {
    it('should show all files in groups that have at least one matching file', () => {
      fc.assert(
        fc.property(fileEntriesArb, (data) => {
          // 随机过滤一些数据
          const filtered = data.filter(() => Math.random() > 0.5);
          const result = applyShowAllInFilteredGroups(data, filtered, true);

          const filteredGroupIds = getUniqueGroupIds(filtered);
          const resultGroupIds = getUniqueGroupIds(result);

          // 结果中的组ID应该与过滤后的组ID相同
          expect(resultGroupIds).toEqual(filteredGroupIds);

          // 对于每个组，应该包含原始数据中该组的所有项目
          for (const groupId of filteredGroupIds) {
            const originalGroupItems = data.filter(
              (item) => 'groupId' in item && item.groupId === groupId,
            );
            const resultGroupItems = result.filter(
              (item) => 'groupId' in item && item.groupId === groupId,
            );
            expect(resultGroupItems.length).toBe(originalGroupItems.length);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 13: 扩展名过滤
   */
  describe('Property 13: Extension Filter', () => {
    it('should only include files with matching extensions (include mode)', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              path: fc.constantFrom(
                '/test/file.jpg',
                '/test/file.png',
                '/test/file.txt',
                '/test/file.mp4',
                '/test/file.doc',
              ),
              groupId: fc.option(fc.integer({ min: 1, max: 5 }), {
                nil: undefined,
              }),
            }),
            { minLength: 5, maxLength: 20 },
          ),
          fc.subarray(['jpg', 'png', 'txt', 'mp4', 'doc']),
          (data, extensions) => {
            const config = {
              enabled: true,
              extensions,
              mode: 'include' as const,
            };
            const result = applyExtensionFilter(data, config);

            if (extensions.length === 0) {
              expect(result.length).toBe(data.length);
            } else {
              for (const item of result) {
                const ext = item.path.split('.').pop()?.toLowerCase() || '';
                expect(extensions).toContain(ext);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should exclude files with matching extensions (exclude mode)', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              path: fc.constantFrom(
                '/test/file.jpg',
                '/test/file.png',
                '/test/file.txt',
              ),
              groupId: fc.option(fc.integer({ min: 1, max: 5 }), {
                nil: undefined,
              }),
            }),
            { minLength: 5, maxLength: 20 },
          ),
          fc.subarray(['jpg', 'png', 'txt']),
          (data, extensions) => {
            const config = {
              enabled: true,
              extensions,
              mode: 'exclude' as const,
            };
            const result = applyExtensionFilter(data, config);

            for (const item of result) {
              const ext = item.path.split('.').pop()?.toLowerCase() || '';
              expect(extensions).not.toContain(ext);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 15: 路径模式匹配
   */
  describe('Property 15: Path Pattern Matching', () => {
    it('should correctly filter by path contains', () => {
      fc.assert(
        fc.property(
          fileEntriesArb,
          fc.string({ minLength: 1, maxLength: 5 }),
          (data, pattern) => {
            const config = {
              enabled: true,
              mode: 'contains' as const,
              pattern,
              caseSensitive: false,
            };
            const result = applyPathFilter(data, config);

            for (const item of result) {
              expect(item.path.toLowerCase()).toContain(pattern.toLowerCase());
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 16: 相似度范围过滤
   */
  describe('Property 16: Similarity Range Filter', () => {
    it('should only include items with similarity within range', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              path: fc.string({ minLength: 5, maxLength: 30 }),
              similarity: fc.integer({ min: 0, max: 100 }).map((n) => `${n}%`),
            }),
            { minLength: 5, maxLength: 20 },
          ),
          fc.integer({ min: 0, max: 50 }),
          fc.integer({ min: 50, max: 100 }),
          (data, minSim, maxSim) => {
            const config = { enabled: true, min: minSim, max: maxSim };
            const result = applySimilarityFilter(data, config);

            for (const item of result) {
              const sim = Number.parseInt(
                item.similarity?.replace('%', '') || '100',
                10,
              );
              expect(sim).toBeGreaterThanOrEqual(minSim);
              expect(sim).toBeLessThanOrEqual(maxSim);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 17 & 18: 分辨率和宽高比过滤
   */
  describe('Property 17 & 18: Resolution and Aspect Ratio Filter', () => {
    it('should only include items with resolution within range', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              path: fc.string({ minLength: 5, maxLength: 30 }),
              raw: fc.record({
                width: fc.integer({ min: 100, max: 4000 }),
                height: fc.integer({ min: 100, max: 4000 }),
              }),
            }),
            { minLength: 5, maxLength: 20 },
          ),
          fc.integer({ min: 100, max: 1000 }),
          fc.integer({ min: 2000, max: 4000 }),
          (data, minWidth, maxWidth) => {
            const config = {
              enabled: true,
              minWidth,
              maxWidth,
              aspectRatio: 'any' as const,
            };
            const result = applyResolutionFilter(data, config);

            for (const item of result) {
              const width = item.raw?.width ?? 0;
              expect(width).toBeGreaterThanOrEqual(minWidth);
              expect(width).toBeLessThanOrEqual(maxWidth);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 19: 多过滤器 AND 组合
   */
  describe('Property 19: Multiple Filters AND Combination', () => {
    it('should apply all filters with AND logic', () => {
      fc.assert(
        fc.property(fileEntriesArb, (data) => {
          const selection = new Set<string>();
          const filterState: FilterState = {
            markStatus: { enabled: false, options: [] },
            groupCount: { enabled: true, min: 1, max: 100 },
            groupSize: { enabled: false, min: 0, max: 1e15 },
            fileSize: { enabled: true, min: 0, max: 1e9 },
            extension: { enabled: false, extensions: [], mode: 'include' },
            modifiedDate: { enabled: false, preset: 'custom' },
            path: {
              enabled: false,
              mode: 'contains',
              pattern: '',
              caseSensitive: false,
            },
            similarity: { enabled: false, min: 0, max: 100 },
            resolution: { enabled: false, aspectRatio: 'any' },
            selectionOnly: false,
            showAllInFilteredGroups: false,
            preset: 'none',
          };

          const result = applyFilters({ data, selection, filterState });

          // 结果应该满足所有启用的过滤条件
          for (const item of result.filteredData) {
            const size = item.raw?.size ?? 0;
            expect(size).toBeLessThanOrEqual(1e9);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 20: 过滤统计计算正确性
   */
  describe('Property 20: Filter Stats Calculation', () => {
    it('should calculate correct statistics', () => {
      fc.assert(
        fc.property(fileEntriesArb, (data) => {
          const filtered = data.filter(() => Math.random() > 0.3);
          const filterState: FilterState = {
            markStatus: { enabled: false, options: [] },
            groupCount: { enabled: false, min: 0, max: 100 },
            groupSize: { enabled: false, min: 0, max: 1e15 },
            fileSize: { enabled: false, min: 0, max: 1e15 },
            extension: { enabled: false, extensions: [], mode: 'include' },
            modifiedDate: { enabled: false, preset: 'custom' },
            path: {
              enabled: false,
              mode: 'contains',
              pattern: '',
              caseSensitive: false,
            },
            similarity: { enabled: false, min: 0, max: 100 },
            resolution: { enabled: false, aspectRatio: 'any' },
            selectionOnly: false,
            showAllInFilteredGroups: false,
            preset: 'none',
          };

          const stats = calculateStats(data, filtered, filterState);

          expect(stats.totalItems).toBe(data.length);
          expect(stats.filteredItems).toBe(filtered.length);
          expect(stats.filteredItems).toBeLessThanOrEqual(stats.totalItems);
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 21: 活动过滤器计数
   */
  describe('Property 21: Active Filter Count', () => {
    it('should correctly count active filters', () => {
      const filterState: FilterState = {
        markStatus: { enabled: true, options: ['marked'] },
        groupCount: { enabled: true, min: 1, max: 100 },
        groupSize: { enabled: false, min: 0, max: 1e15 },
        fileSize: { enabled: true, min: 0, max: 1e9 },
        extension: { enabled: false, extensions: [], mode: 'include' },
        modifiedDate: { enabled: false, preset: 'custom' },
        path: {
          enabled: false,
          mode: 'contains',
          pattern: '',
          caseSensitive: false,
        },
        similarity: { enabled: false, min: 0, max: 100 },
        resolution: { enabled: false, aspectRatio: 'any' },
        selectionOnly: true,
        showAllInFilteredGroups: false,
        preset: 'none',
      };

      const count = countActiveFilters(filterState);
      expect(count).toBe(4); // markStatus, groupCount, fileSize, selectionOnly
    });
  });
});
