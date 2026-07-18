/**
 * 选择助手核心类型定义
 */

import type { BaseEntry, RefEntry } from '@/nodes/czkawka/upstream/types';

// ============ 基础类型 ============

/** 选择动作类型 */
export type SelectionAction = 'mark' | 'unmark';

/** 规则类型枚举 */
export type RuleType = 'group' | 'text' | 'directory';

/** 规则执行上下文 */
export interface RuleContext<
  T extends BaseEntry & Partial<RefEntry> = BaseEntry & Partial<RefEntry>,
> {
  /** 当前数据列表 */
  data: T[];
  /** 当前选择状态 */
  currentSelection: Set<string>;
  /** 是否保持已选择不变 */
  keepExistingSelection: boolean;
  /** 选择动作 */
  action: SelectionAction;
}

/** 规则执行结果 */
export interface RuleResult {
  /** 新的选择状态（路径集合） */
  selection: Set<string>;
  /** 受影响的文件数量 */
  affectedCount: number;
  /** 执行是否成功 */
  success: boolean;
  /** 错误信息（如果有） */
  error?: string;
}

/** 规则验证结果 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ============ 规则接口 ============

/** 选择规则基础接口 */
export interface SelectionRule<TConfig = unknown> {
  /** 规则唯一标识 */
  id: string;
  /** 规则类型 */
  type: RuleType;
  /** 规则配置 */
  config: TConfig;
  /** 是否启用 */
  enabled: boolean;
  /** 执行规则 */
  execute<T extends BaseEntry & Partial<RefEntry>>(
    ctx: RuleContext<T>,
  ): RuleResult;
  /** 验证配置 */
  validate(): ValidationResult;
  /** 获取规则描述 */
  describe(): string;
  /** 预览受影响的文件数 */
  preview<T extends BaseEntry & Partial<RefEntry>>(ctx: RuleContext<T>): number;
}

// ============ 组选择规则类型 ============

/** 组选择模式 */
export type GroupSelectionMode =
  | 'selectAllExceptOne' // 每组除了一份文件之外其他所有
  | 'selectOne' // 每组中仅一份文件
  | 'selectAllExceptOnePerFolder' // 同一组且同一文件夹中除了一份之外其他所有
  | 'selectAllExceptOneMatchingSet'; // 每组中除了一个匹配集之外其他所有

/** 排序字段 */
export type SortField =
  | 'folderPath' // 文件夹路径
  | 'fileName' // 文件名
  | 'fileSize' // 文件大小
  | 'creationDate' // 创建日期
  | 'modifiedDate' // 修改日期
  | 'resolution' // 分辨率（仅图片）
  | 'disk' // 磁盘/驱动器
  | 'fileType' // 文件类型/扩展名
  | 'hash' // 哈希值
  | 'hardLinks'; // 硬链接数

/** 排序方向 */
export type SortDirection = 'asc' | 'desc';

/** 过滤条件类型（用于排序字段的附加过滤） */
export type FilterCondition =
  | 'none' // 无过滤
  | 'contains' // 包含
  | 'notContains' // 不包含
  | 'startsWith' // 起始于
  | 'endsWith' // 结尾于
  | 'equals'; // 等于

/** 排序条件 */
export interface SortCriterion {
  field: SortField;
  direction: SortDirection;
  preferEmpty: boolean; // 空值优先
  enabled: boolean;
  /** 过滤条件（可选） */
  filterCondition?: FilterCondition;
  /** 过滤值（可选） */
  filterValue?: string;
}

/** 组选择规则配置 */
export interface GroupRuleConfig {
  mode: GroupSelectionMode;
  sortCriteria: SortCriterion[];
  keepExistingSelection: boolean;
}

// ============ 文本选择规则类型 ============

/** 文本匹配列 */
export type TextColumn = 'folderPath' | 'fileName' | 'fullPath';

/** 匹配条件 */
export type MatchCondition =
  | 'contains' // 包含
  | 'notContains' // 不包含
  | 'equals' // 等于
  | 'startsWith' // 开头是
  | 'endsWith'; // 结尾是

/** 文本选择规则配置 */
export interface TextRuleConfig {
  column: TextColumn;
  condition: MatchCondition;
  pattern: string;
  useRegex: boolean;
  caseSensitive: boolean;
  matchWholeColumn: boolean; // 匹配整列
  keepExistingSelection: boolean;
}

// ============ 目录选择规则类型 ============

/** 目录选择模式 */
export type DirectoryMode =
  | 'keepOnePerDirectory' // 每个目录保留一个
  | 'selectAllInDirectory' // 选择目录中所有
  | 'excludeDirectory'; // 排除目录

/** 目录选择规则配置 */
export interface DirectoryRuleConfig {
  mode: DirectoryMode;
  directories: string[];
  keepExistingSelection: boolean;
}

// ============ 管道类型 ============

/** 管道配置 */
export interface PipelineConfig {
  name: string;
  rules: SerializedRule[];
}

/** 序列化的规则 */
export interface SerializedRule {
  id: string;
  type: RuleType;
  config: GroupRuleConfig | TextRuleConfig | DirectoryRuleConfig;
  enabled: boolean;
}

// ============ 导入/导出配置类型 ============

/** 导出配置格式 */
export interface ExportConfig {
  version: string;
  groupRule?: GroupRuleConfig;
  textRule?: TextRuleConfig;
  directoryRule?: DirectoryRuleConfig;
}

// ============ 带原始数据的条目类型 ============

/** 带原始数据的条目 */
export interface EntryWithRaw extends BaseEntry, Partial<RefEntry> {
  raw?: {
    size?: number;
    modified_date?: number;
    created_date?: number;
    width?: number;
    height?: number;
    hash?: string;
    hardlinks?: number;
    [key: string]: unknown;
  };
}
