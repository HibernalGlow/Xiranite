/**
 * 过滤器工具函数属性测试
 * Filter Panel Utils Property Tests
 *
 * **Property 4: 大小单位转换一致性**
 * **Validates: Requirements 3.3, 4.2**
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { PathMatchMode, SizeUnit } from '../types';
import {
  convertSize,
  formatBytes,
  getFileExtension,
  matchPath,
  parseSizeToBytes,
} from '../utils';

describe('Filter Panel Utils - Property Tests', () => {
  /**
   * Property 4: 大小单位转换一致性
   * For any 大小值 V 和单位 U1、U2，convertSize(convertSize(V, U1, U2), U2, U1) 应该等于 V
   */
  describe('Property 4: Size Unit Conversion Consistency', () => {
    const sizeUnits: SizeUnit[] = ['B', 'KB', 'MB', 'GB', 'TB'];

    it('should maintain consistency when converting back and forth', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 1e12, noNaN: true }),
          fc.constantFrom(...sizeUnits),
          fc.constantFrom(...sizeUnits),
          (value, fromUnit, toUnit) => {
            const converted = convertSize(value, fromUnit, toUnit);
            const backConverted = convertSize(converted, toUnit, fromUnit);
            // 考虑浮点精度，允许 0.0001% 的误差
            const tolerance = Math.max(Math.abs(value) * 1e-6, 1e-10);
            expect(Math.abs(backConverted - value)).toBeLessThanOrEqual(
              tolerance,
            );
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should correctly convert between adjacent units', () => {
      fc.assert(
        fc.property(fc.double({ min: 0, max: 1e6, noNaN: true }), (value) => {
          // KB to B and back
          const kbToB = convertSize(value, 'KB', 'B');
          expect(kbToB).toBeCloseTo(value * 1024, 5);

          // MB to KB and back
          const mbToKb = convertSize(value, 'MB', 'KB');
          expect(mbToKb).toBeCloseTo(value * 1024, 5);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('parseSizeToBytes and formatBytes round-trip', () => {
    it('should parse formatted bytes back to original value', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 1e15 }), (bytes) => {
          const formatted = formatBytes(bytes);
          const parsed = parseSizeToBytes(formatted);
          // 允许格式化精度损失
          const tolerance = Math.max(bytes * 0.01, 1);
          expect(Math.abs(parsed - bytes)).toBeLessThanOrEqual(tolerance);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('getFileExtension', () => {
    it('should extract extension from any valid path', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 5 }),
          (name, ext) => {
            const safeName = name.replace(/\./g, '_');
            const safeExt = ext.replace(/\./g, '').toLowerCase();
            if (safeExt.length === 0) return; // 跳过空扩展名
            const path = `/some/path/${safeName}.${safeExt}`;
            const result = getFileExtension(path);
            expect(result).toBe(safeExt);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should return empty string for paths without extension', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 20 }), (name) => {
          const safeName = name.replace(/\./g, '_');
          const path = `/some/path/${safeName}`;
          const result = getFileExtension(path);
          expect(result).toBe('');
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('matchPath', () => {
    const pathModes: PathMatchMode[] = [
      'contains',
      'notContains',
      'startsWith',
      'endsWith',
    ];

    it('should correctly match contains pattern', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.string({ minLength: 1, maxLength: 10 }),
          fc.string({ minLength: 0, maxLength: 10 }),
          (prefix, pattern, suffix) => {
            const path = prefix + pattern + suffix;
            expect(matchPath(path, pattern, 'contains', true)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should correctly match notContains pattern', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 5, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 5 }),
          (path, pattern) => {
            // 确保 pattern 不在 path 中
            if (!path.includes(pattern)) {
              expect(matchPath(path, pattern, 'notContains', true)).toBe(true);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should correctly match startsWith pattern', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 10 }),
          fc.string({ minLength: 0, maxLength: 20 }),
          (pattern, suffix) => {
            const path = pattern + suffix;
            expect(matchPath(path, pattern, 'startsWith', true)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should correctly match endsWith pattern', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 10 }),
          (prefix, pattern) => {
            const path = prefix + pattern;
            expect(matchPath(path, pattern, 'endsWith', true)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should handle case sensitivity correctly', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.constantFrom(...pathModes),
          (str, mode) => {
            const upper = str.toUpperCase();
            const lower = str.toLowerCase();

            if (
              mode === 'contains' ||
              mode === 'startsWith' ||
              mode === 'endsWith'
            ) {
              // 不区分大小写时应该匹配
              expect(matchPath(upper, lower, mode, false)).toBe(true);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
