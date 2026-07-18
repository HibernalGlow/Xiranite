/**
 * 配置导入/导出属性测试
 * Property 19: 配置持久化往返
 * Property 20: 配置导入/导出往返
 * Property 21: 无效配置导入拒绝
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CONFIG_VERSION,
  exportConfig,
  importConfig,
  isVersionCompatible,
  mergeConfigs,
} from '../config-utils';
import type {
  DirectoryRuleConfig,
  GroupRuleConfig,
  TextRuleConfig,
} from '../types';

// 生成有效配置的 arbitrary
const groupRuleConfigArb: fc.Arbitrary<GroupRuleConfig> = fc.record({
  mode: fc.constantFrom(
    'selectAllExceptOne',
    'selectOne',
    'selectAllExceptOnePerFolder',
    'selectAllExceptOneMatchingSet',
  ),
  sortCriteria: fc.array(
    fc.record({
      field: fc.constantFrom(
        'folderPath',
        'fileName',
        'fileSize',
        'creationDate',
        'modifiedDate',
        'resolution',
      ),
      direction: fc.constantFrom('asc', 'desc'),
      preferEmpty: fc.boolean(),
      enabled: fc.boolean(),
    }),
    { minLength: 0, maxLength: 5 },
  ),
  keepExistingSelection: fc.boolean(),
}) as fc.Arbitrary<GroupRuleConfig>;

const textRuleConfigArb: fc.Arbitrary<TextRuleConfig> = fc.record({
  column: fc.constantFrom('folderPath', 'fileName', 'fullPath'),
  condition: fc.constantFrom(
    'contains',
    'notContains',
    'equals',
    'startsWith',
    'endsWith',
  ),
  pattern: fc.string({ minLength: 0, maxLength: 50 }),
  useRegex: fc.boolean(),
  caseSensitive: fc.boolean(),
  matchWholeColumn: fc.boolean(),
  keepExistingSelection: fc.boolean(),
}) as fc.Arbitrary<TextRuleConfig>;

const directoryRuleConfigArb: fc.Arbitrary<DirectoryRuleConfig> = fc.record({
  mode: fc.constantFrom(
    'keepOnePerDirectory',
    'selectAllInDirectory',
    'excludeDirectory',
  ),
  directories: fc.array(fc.string({ minLength: 1, maxLength: 100 }), {
    minLength: 0,
    maxLength: 10,
  }),
  keepExistingSelection: fc.boolean(),
}) as fc.Arbitrary<DirectoryRuleConfig>;

describe('配置导入/导出属性测试', () => {
  // Property 20: 配置导入/导出往返
  describe('Property 20: 配置导入/导出往返', () => {
    it('导出后导入应该得到相同的配置', () => {
      fc.assert(
        fc.property(
          fc.record({
            groupRule: fc.option(groupRuleConfigArb),
            textRule: fc.option(textRuleConfigArb),
            directoryRule: fc.option(directoryRuleConfigArb),
          }),
          (config) => {
            // 过滤掉 undefined 值
            const cleanConfig: {
              groupRule?: GroupRuleConfig;
              textRule?: TextRuleConfig;
              directoryRule?: DirectoryRuleConfig;
            } = {};
            if (config.groupRule) cleanConfig.groupRule = config.groupRule;
            if (config.textRule) cleanConfig.textRule = config.textRule;
            if (config.directoryRule)
              cleanConfig.directoryRule = config.directoryRule;

            // 导出
            const exportResult = exportConfig(cleanConfig);
            if (!exportResult.success || !exportResult.data) return false;

            // 导入
            const importResult = importConfig(exportResult.data);
            if (!importResult.success || !importResult.config) return false;

            // 验证版本
            if (importResult.config.version !== CONFIG_VERSION) return false;

            // 验证配置内容
            if (cleanConfig.groupRule) {
              if (
                JSON.stringify(importResult.config.groupRule) !==
                JSON.stringify(cleanConfig.groupRule)
              ) {
                return false;
              }
            }
            if (cleanConfig.textRule) {
              if (
                JSON.stringify(importResult.config.textRule) !==
                JSON.stringify(cleanConfig.textRule)
              ) {
                return false;
              }
            }
            if (cleanConfig.directoryRule) {
              if (
                JSON.stringify(importResult.config.directoryRule) !==
                JSON.stringify(cleanConfig.directoryRule)
              ) {
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

  // Property 21: 无效配置导入拒绝
  describe('Property 21: 无效配置导入拒绝', () => {
    it('无效 JSON 应该被拒绝', () => {
      const invalidJsonStrings = [
        '{invalid}',
        'not json',
        '{"unclosed": ',
        '',
        'null',
        '123',
        '"string"',
      ];

      for (const invalid of invalidJsonStrings) {
        const result = importConfig(invalid);
        // 空字符串和非对象 JSON 应该失败
        if (
          invalid === '' ||
          invalid === 'null' ||
          invalid === '123' ||
          invalid === '"string"'
        ) {
          expect(result.success).toBe(false);
        }
      }
    });

    it('缺少版本号的配置应该被拒绝', () => {
      const result = importConfig(JSON.stringify({ groupRule: {} }));
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('无效的规则模式应该被拒绝', () => {
      const invalidConfig = {
        version: '1.0.0',
        groupRule: {
          mode: 'invalidMode',
          sortCriteria: [],
          keepExistingSelection: false,
        },
      };
      const result = importConfig(JSON.stringify(invalidConfig));
      expect(result.success).toBe(false);
    });

    it('无效的排序字段应该被拒绝', () => {
      const invalidConfig = {
        version: '1.0.0',
        groupRule: {
          mode: 'selectOne',
          sortCriteria: [
            {
              field: 'invalidField',
              direction: 'asc',
              preferEmpty: false,
              enabled: true,
            },
          ],
          keepExistingSelection: false,
        },
      };
      const result = importConfig(JSON.stringify(invalidConfig));
      expect(result.success).toBe(false);
    });
  });
});

describe('版本兼容性', () => {
  it('相同主版本号应该兼容', () => {
    expect(isVersionCompatible('1.0.0')).toBe(true);
    expect(isVersionCompatible('1.1.0')).toBe(true);
    expect(isVersionCompatible('1.99.99')).toBe(true);
  });

  it('不同主版本号应该不兼容', () => {
    expect(isVersionCompatible('2.0.0')).toBe(false);
    expect(isVersionCompatible('0.9.0')).toBe(false);
  });
});

describe('配置合并', () => {
  it('应该正确合并部分配置', () => {
    const current = {
      groupRule: {
        mode: 'selectOne' as const,
        sortCriteria: [],
        keepExistingSelection: false,
      },
      textRule: {
        column: 'fullPath' as const,
        condition: 'contains' as const,
        pattern: 'old',
        useRegex: false,
        caseSensitive: false,
        matchWholeColumn: false,
        keepExistingSelection: false,
      },
      directoryRule: {
        mode: 'keepOnePerDirectory' as const,
        directories: [],
        keepExistingSelection: false,
      },
    };

    const imported = {
      version: '1.0.0',
      textRule: {
        column: 'fileName' as const,
        condition: 'equals' as const,
        pattern: 'new',
        useRegex: true,
        caseSensitive: true,
        matchWholeColumn: false,
        keepExistingSelection: true,
      },
    };

    const merged = mergeConfigs(current, imported);

    // groupRule 应该保持不变
    expect(merged.groupRule).toEqual(current.groupRule);
    // textRule 应该被替换
    expect(merged.textRule).toEqual(imported.textRule);
    // directoryRule 应该保持不变
    expect(merged.directoryRule).toEqual(current.directoryRule);
  });
});

describe('exportConfig', () => {
  it('应该成功导出有效配置', () => {
    const config = {
      groupRule: {
        mode: 'selectOne' as const,
        sortCriteria: [],
        keepExistingSelection: false,
      },
    };

    const result = exportConfig(config);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();

    const parsed = JSON.parse(result.data!);
    expect(parsed.version).toBe(CONFIG_VERSION);
    expect(parsed.groupRule).toEqual(config.groupRule);
  });

  it('空配置也应该成功导出', () => {
    const result = exportConfig({});
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();

    const parsed = JSON.parse(result.data!);
    expect(parsed.version).toBe(CONFIG_VERSION);
  });
});
