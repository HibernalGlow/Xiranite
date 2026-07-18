/**
 * 过滤器面板 Zod Schema 定义
 * Filter Panel Zod Schema Definitions
 */

import { z } from 'zod';

/** 大小单位 Schema */
export const sizeUnitSchema = z.enum(['B', 'KB', 'MB', 'GB', 'TB']);

/** 标记状态选项 Schema */
export const markStatusOptionSchema = z.enum([
  'marked',
  'unmarked',
  'groupHasSomeMarked',
  'groupAllUnmarked',
  'groupSomeNotAll',
  'groupAllMarked',
  'protected',
]);

/** 日期预设 Schema */
export const datePresetSchema = z.enum([
  'today',
  'last7days',
  'last30days',
  'lastYear',
  'custom',
]);

/** 路径匹配模式 Schema */
export const pathMatchModeSchema = z.enum([
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
]);

/** 宽高比类型 Schema */
export const aspectRatioTypeSchema = z.enum(['16:9', '4:3', '1:1', 'any']);

/** 扩展名过滤模式 Schema */
export const extensionFilterModeSchema = z.enum(['include', 'exclude']);

/** 预设类型 Schema */
export const filterPresetSchema = z.enum([
  'none',
  'largeFilesFirst',
  'smallFilesFirst',
  'recentlyModified',
  'oldFiles',
]);

/** 范围过滤器配置 Schema */
export const rangeFilterConfigSchema = z.object({
  enabled: z.boolean(),
  min: z.number().min(0),
  max: z.number().min(0),
  unit: sizeUnitSchema.optional(),
});

/** 标记状态过滤器配置 Schema */
export const markStatusFilterConfigSchema = z.object({
  enabled: z.boolean(),
  options: z.array(markStatusOptionSchema),
});

/** 日期过滤器配置 Schema */
export const dateFilterConfigSchema = z.object({
  enabled: z.boolean(),
  preset: datePresetSchema,
  startDate: z.number().optional(),
  endDate: z.number().optional(),
});

/** 路径过滤器配置 Schema */
export const pathFilterConfigSchema = z.object({
  enabled: z.boolean(),
  mode: pathMatchModeSchema,
  pattern: z.string(),
  caseSensitive: z.boolean(),
});

/** 相似度过滤器配置 Schema */
export const similarityFilterConfigSchema = z.object({
  enabled: z.boolean(),
  min: z.number().min(0).max(100),
  max: z.number().min(0).max(100),
});

/** 分辨率过滤器配置 Schema */
export const resolutionFilterConfigSchema = z.object({
  enabled: z.boolean(),
  minWidth: z.number().optional(),
  minHeight: z.number().optional(),
  maxWidth: z.number().optional(),
  maxHeight: z.number().optional(),
  aspectRatio: aspectRatioTypeSchema.optional(),
});

/** 扩展名过滤器配置 Schema */
export const extensionFilterConfigSchema = z.object({
  enabled: z.boolean(),
  extensions: z.array(z.string()),
  mode: extensionFilterModeSchema,
});

/** 完整过滤器状态 Schema */
export const filterStateSchema = z.object({
  markStatus: markStatusFilterConfigSchema,
  groupCount: rangeFilterConfigSchema,
  groupSize: rangeFilterConfigSchema,
  fileSize: rangeFilterConfigSchema,
  extension: extensionFilterConfigSchema,
  modifiedDate: dateFilterConfigSchema,
  path: pathFilterConfigSchema,
  similarity: similarityFilterConfigSchema,
  resolution: resolutionFilterConfigSchema,
  selectionOnly: z.boolean(),
  showAllInFilteredGroups: z.boolean(),
  preset: filterPresetSchema,
});

/** 过滤统计 Schema */
export const filterStatsSchema = z.object({
  totalItems: z.number().min(0),
  filteredItems: z.number().min(0),
  totalGroups: z.number().min(0),
  filteredGroups: z.number().min(0),
  totalSize: z.number().min(0),
  filteredSize: z.number().min(0),
  activeFilterCount: z.number().min(0),
});

/** 导入配置 Schema */
export const importFilterConfigSchema = z.object({
  version: z.string(),
  filterState: filterStateSchema,
});

/** 验证过滤器状态 */
export function validateFilterState(state: unknown): boolean {
  const result = filterStateSchema.safeParse(state);
  return result.success;
}

/** 解析过滤器状态 */
export function parseFilterState(state: unknown) {
  return filterStateSchema.safeParse(state);
}
