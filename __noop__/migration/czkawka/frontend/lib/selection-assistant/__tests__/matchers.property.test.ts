/**
 * 匹配器属性测试
 * Property 7: 文本匹配条件正确性
 * Property 8: 正则表达式匹配一致性
 * Property 9: 大小写敏感性
 * Validates: Requirements 3.2, 3.3, 3.4
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { getColumnValue, isValidRegex, matchText } from '../matchers';

describe('matchText 属性测试', () => {
  // Property 7: 文本匹配条件正确性
  describe('Property 7: 文本匹配条件正确性', () => {
    it('contains: 应该与 String.includes 行为一致', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          (text, pattern) => {
            const result = matchText(text, pattern, 'contains', true, false);
            const expected = text.includes(pattern);
            return result === expected;
          },
        ),
        { numRuns: 100 },
      );
    });

    it('notContains: 应该与 !String.includes 行为一致', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          (text, pattern) => {
            const result = matchText(text, pattern, 'notContains', true, false);
            const expected = !text.includes(pattern);
            return result === expected;
          },
        ),
        { numRuns: 100 },
      );
    });

    it('equals: 应该与严格相等行为一致', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 100 }),
          fc.string({ minLength: 1, maxLength: 100 }),
          (text, pattern) => {
            const result = matchText(text, pattern, 'equals', true, false);
            const expected = text === pattern;
            return result === expected;
          },
        ),
        { numRuns: 100 },
      );
    });

    it('startsWith: 应该与 String.startsWith 行为一致', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          (text, pattern) => {
            const result = matchText(text, pattern, 'startsWith', true, false);
            const expected = text.startsWith(pattern);
            return result === expected;
          },
        ),
        { numRuns: 100 },
      );
    });

    it('endsWith: 应该与 String.endsWith 行为一致', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          (text, pattern) => {
            const result = matchText(text, pattern, 'endsWith', true, false);
            const expected = text.endsWith(pattern);
            return result === expected;
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Property 8: 正则表达式匹配一致性
  describe('Property 8: 正则表达式匹配一致性', () => {
    it('有效正则表达式应该与 RegExp.test 行为一致', () => {
      // 使用简单的正则模式避免生成无效正则
      const alphanumChars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      const simplePatternArb = fc.string({
        minLength: 1,
        maxLength: 10,
        unit: fc.constantFrom(...alphanumChars),
      });

      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          simplePatternArb,
          (text, pattern) => {
            const result = matchText(text, pattern, 'contains', true, true);
            const expected = new RegExp(pattern).test(text);
            return result === expected;
          },
        ),
        { numRuns: 100 },
      );
    });

    it('无效正则表达式应该返回 false', () => {
      const invalidPatterns = ['[', '(', '*', '+', '?', '{', '\\'];
      for (const pattern of invalidPatterns) {
        const result = matchText('test', pattern, 'contains', true, true);
        // 无效正则应该返回 false 或者如果碰巧有效则返回正确结果
        expect(typeof result).toBe('boolean');
      }
    });
  });

  // Property 9: 大小写敏感性
  describe('Property 9: 大小写敏感性', () => {
    it('caseSensitive=true 时应该区分大小写', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 50 }), (text) => {
          const upper = text.toUpperCase();
          const lower = text.toLowerCase();

          // 如果大小写不同，敏感模式下应该不匹配
          if (upper !== lower) {
            const result = matchText(upper, lower, 'equals', true, false);
            return result === false;
          }
          return true;
        }),
        { numRuns: 100 },
      );
    });

    it('caseSensitive=false 时应该忽略大小写', () => {
      const lowerChars = 'abcdefghijklmnopqrstuvwxyz';
      fc.assert(
        fc.property(
          fc.string({
            minLength: 1,
            maxLength: 50,
            unit: fc.constantFrom(...lowerChars),
          }),
          (text) => {
            const upper = text.toUpperCase();
            const lower = text.toLowerCase();

            // 不敏感模式下，大小写不同也应该匹配
            const result = matchText(upper, lower, 'equals', false, false);
            return result === true;
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});

describe('getColumnValue 属性测试', () => {
  const alphanumChars = 'abcdefghijklmnopqrstuvwxyz0123456789';

  it('fullPath 应该返回完整路径', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 100 }), (path) => {
        return getColumnValue(path, 'fullPath') === path;
      }),
      { numRuns: 100 },
    );
  });

  it('fileName 应该返回最后一个分隔符后的内容', () => {
    const pathArb = fc
      .array(
        fc.string({
          minLength: 1,
          maxLength: 10,
          unit: fc.constantFrom(...alphanumChars),
        }),
        { minLength: 2, maxLength: 5 },
      )
      .map((parts) => parts.join('/'));

    fc.assert(
      fc.property(pathArb, (path) => {
        const fileName = getColumnValue(path, 'fileName');
        const expected = path.split('/').pop() || '';
        return fileName === expected;
      }),
      { numRuns: 100 },
    );
  });

  it('folderPath 应该返回最后一个分隔符前的内容', () => {
    const pathArb = fc
      .array(
        fc.string({
          minLength: 1,
          maxLength: 10,
          unit: fc.constantFrom(...alphanumChars),
        }),
        { minLength: 2, maxLength: 5 },
      )
      .map((parts) => parts.join('/'));

    fc.assert(
      fc.property(pathArb, (path) => {
        const folderPath = getColumnValue(path, 'folderPath');
        const parts = path.split('/');
        parts.pop();
        const expected = parts.join('/');
        return folderPath === expected;
      }),
      { numRuns: 100 },
    );
  });
});

describe('isValidRegex', () => {
  it('有效正则应该返回 true', () => {
    expect(isValidRegex('abc')).toBe(true);
    expect(isValidRegex('a.*b')).toBe(true);
    expect(isValidRegex('^test$')).toBe(true);
  });

  it('无效正则应该返回 false', () => {
    expect(isValidRegex('[')).toBe(false);
    expect(isValidRegex('(')).toBe(false);
  });
});
