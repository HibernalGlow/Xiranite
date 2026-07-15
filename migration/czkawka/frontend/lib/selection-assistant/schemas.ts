/**
 * 选择助手 Zod Schema 定义
 * 用于配置验证和导入校验
 */

import { z } from 'zod';

// ============ 排序条件 Schema ============

export const sortFieldSchema = z.enum([
  'folderPath',
  'fileName',
  'fileSize',
  'creationDate',
  'modifiedDate',
  'resolution',
  'disk',
  'fileType',
  'hash',
  'hardLinks',
]);

export const sortDirectionSchema = z.enum(['asc', 'desc']);

export const filterConditionSchema = z.enum([
  'none',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'equals',
]);

export const sortCriterionSchema = z.object({
  field: sortFieldSchema,
  direction: sortDirectionSchema,
  preferEmpty: z.boolean(),
  enabled: z.boolean(),
  filterCondition: filterConditionSchema.optional(),
  filterValue: z.string().optional(),
});

// ============ 组选择规则 Schema ============

export const groupSelectionModeSchema = z.enum([
  'selectAllExceptOne',
  'selectOne',
  'selectAllExceptOnePerFolder',
  'selectAllExceptOneMatchingSet',
]);

export const groupRuleConfigSchema = z.object({
  mode: groupSelectionModeSchema,
  sortCriteria: z.array(sortCriterionSchema),
  keepExistingSelection: z.boolean(),
});

// ============ 文本选择规则 Schema ============

export const textColumnSchema = z.enum(['folderPath', 'fileName', 'fullPath']);

export const matchConditionSchema = z.enum([
  'contains',
  'notContains',
  'equals',
  'startsWith',
  'endsWith',
]);

export const textRuleConfigSchema = z.object({
  column: textColumnSchema,
  condition: matchConditionSchema,
  pattern: z.string(),
  useRegex: z.boolean(),
  caseSensitive: z.boolean(),
  matchWholeColumn: z.boolean(),
  keepExistingSelection: z.boolean(),
});

// ============ 目录选择规则 Schema ============

export const directoryModeSchema = z.enum([
  'keepOnePerDirectory',
  'selectAllInDirectory',
  'excludeDirectory',
]);

export const directoryRuleConfigSchema = z.object({
  mode: directoryModeSchema,
  directories: z.array(z.string()),
  keepExistingSelection: z.boolean(),
});

// ============ 导入配置 Schema ============

export const importConfigSchema = z.object({
  version: z.string(),
  groupRule: groupRuleConfigSchema.optional(),
  textRule: textRuleConfigSchema.optional(),
  directoryRule: directoryRuleConfigSchema.optional(),
});

// ============ 序列化规则 Schema ============

export const ruleTypeSchema = z.enum(['group', 'text', 'directory']);

export const serializedRuleSchema = z.object({
  id: z.string(),
  type: ruleTypeSchema,
  config: z.union([
    groupRuleConfigSchema,
    textRuleConfigSchema,
    directoryRuleConfigSchema,
  ]),
  enabled: z.boolean(),
});

export const pipelineConfigSchema = z.object({
  name: z.string(),
  rules: z.array(serializedRuleSchema),
});

// ============ 类型导出 ============

export type SortCriterionInput = z.infer<typeof sortCriterionSchema>;
export type GroupRuleConfigInput = z.infer<typeof groupRuleConfigSchema>;
export type TextRuleConfigInput = z.infer<typeof textRuleConfigSchema>;
export type DirectoryRuleConfigInput = z.infer<
  typeof directoryRuleConfigSchema
>;
export type ImportConfigInput = z.infer<typeof importConfigSchema>;
export type PipelineConfigInput = z.infer<typeof pipelineConfigSchema>;
