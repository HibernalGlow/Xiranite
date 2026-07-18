/**
 * 过滤器面板类型定义
 * Filter Panel Type Definitions
 */

import type { BaseEntry, RefEntry } from '@/nodes/czkawka/upstream/types';

/** 过滤器类别 */
export type FilterCategory =
  | 'markStatus' // 标记状态
  | 'groupCount' // 组别文件数量
  | 'groupSize' // 组别大小
  | 'fileSize' // 文件大小
  | 'extension' // 扩展名
  | 'modifiedDate' // 修改日期
  | 'path' // 路径
  | 'similarity' // 相似度
  | 'resolution' // 分辨率
  | 'selection' // 已选择
  | 'preset'; // 预设

/** 标记状态选项 */
export type MarkStatusOption =
  | 'marked' // 已标记
  | 'unmarked' // 未标记
  | 'groupHasSomeMarked' // 存在部分标记项目的组别
  | 'groupAllUnmarked' // 所有项目均无标记的组别
  | 'groupSomeNotAll' // 存在部分但非全部标记的组别
  | 'groupAllMarked' // 所有项目均被标记的组别
  | 'protected'; // 已保护

/** 大小单位 */
export type SizeUnit = 'B' | 'KB' | 'MB' | 'GB' | 'TB';

/** 范围过滤器配置 */
export interface RangeFilterConfig {
  enabled: boolean;
  min: number;
  max: number;
  unit?: SizeUnit;
}

/** 日期范围预设 */
export type DatePreset =
  | 'today'
  | 'last7days'
  | 'last30days'
  | 'lastYear'
  | 'custom';

/** 日期过滤器配置 */
export interface DateFilterConfig {
  enabled: boolean;
  preset: DatePreset;
  startDate?: number; // timestamp
  endDate?: number; // timestamp
}

/** 路径匹配模式 */
export type PathMatchMode =
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith';

/** 路径过滤器配置 */
export interface PathFilterConfig {
  enabled: boolean;
  mode: PathMatchMode;
  pattern: string;
  caseSensitive: boolean;
}

/** 相似度过滤器配置 */
export interface SimilarityFilterConfig {
  enabled: boolean;
  min: number; // 0-100
  max: number; // 0-100
}

/** 宽高比类型 */
export type AspectRatioType = '16:9' | '4:3' | '1:1' | 'any';

/** 分辨率过滤器配置 */
export interface ResolutionFilterConfig {
  enabled: boolean;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  aspectRatio?: AspectRatioType;
}

/** 扩展名过滤模式 */
export type ExtensionFilterMode = 'include' | 'exclude';

/** 扩展名过滤器配置 */
export interface ExtensionFilterConfig {
  enabled: boolean;
  extensions: string[];
  mode: ExtensionFilterMode;
}

/** 预设类型 */
export type FilterPreset =
  | 'none'
  | 'largeFilesFirst'
  | 'smallFilesFirst'
  | 'recentlyModified'
  | 'oldFiles';

/** 标记状态过滤器配置 */
export interface MarkStatusFilterConfig {
  enabled: boolean;
  options: MarkStatusOption[];
}

/** 完整过滤器状态 */
export interface FilterState {
  /** 标记状态过滤 */
  markStatus: MarkStatusFilterConfig;
  /** 组别过滤（文件数量） */
  groupCount: RangeFilterConfig;
  /** 组别过滤（大小） */
  groupSize: RangeFilterConfig;
  /** 文件大小过滤 */
  fileSize: RangeFilterConfig;
  /** 扩展名过滤 */
  extension: ExtensionFilterConfig;
  /** 修改日期过滤 */
  modifiedDate: DateFilterConfig;
  /** 路径过滤 */
  path: PathFilterConfig;
  /** 相似度过滤（仅相似图片/视频） */
  similarity: SimilarityFilterConfig;
  /** 分辨率过滤（仅图片/视频） */
  resolution: ResolutionFilterConfig;
  /** 已选择项过滤 */
  selectionOnly: boolean;
  /** 在已过滤的组中显示所有文件 */
  showAllInFilteredGroups: boolean;
  /** 当前预设 */
  preset: FilterPreset;
}

/** 过滤结果统计 */
export interface FilterStats {
  totalItems: number;
  filteredItems: number;
  totalGroups: number;
  filteredGroups: number;
  totalSize: number;
  filteredSize: number;
  activeFilterCount: number;
}

/** 过滤器上下文 */
export interface FilterContext<T extends BaseEntry & Partial<RefEntry>> {
  /** 当前数据列表 */
  data: T[];
  /** 当前选择状态 */
  selection: Set<string>;
  /** 过滤器状态 */
  filterState: FilterState;
}

/** 过滤器结果 */
export interface FilterResult<T> {
  /** 过滤后的数据 */
  filteredData: T[];
  /** 统计信息 */
  stats: FilterStats;
}

/** 组标记状态 */
export type GroupMarkStatus =
  | 'allMarked'
  | 'allUnmarked'
  | 'someMarked'
  | 'someNotAll';

/** 带大小信息的条目 */
export interface EntryWithSize extends BaseEntry, Partial<RefEntry> {
  size?: string;
  raw?: { size?: number };
}

/** 带日期信息的条目 */
export interface EntryWithDate extends BaseEntry, Partial<RefEntry> {
  modifiedDate?: string;
  raw?: { modified_date?: number };
}

/** 带相似度信息的条目 */
export interface EntryWithSimilarity extends BaseEntry, Partial<RefEntry> {
  similarity?: string;
}

/** 带分辨率信息的条目 */
export interface EntryWithResolution extends BaseEntry, Partial<RefEntry> {
  dimensions?: string;
  raw?: { width?: number; height?: number };
}

/** 通用过滤条目类型 */
export type FilterableEntry = BaseEntry &
  Partial<RefEntry> & {
    size?: string;
    modifiedDate?: string;
    similarity?: string;
    dimensions?: string;
    raw?: {
      size?: number;
      modified_date?: number;
      width?: number;
      height?: number;
    };
  };
