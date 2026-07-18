/**
 * 过滤器引擎
 * Filter Engine - 核心过滤逻辑实现
 */

import type { BaseEntry, RefEntry } from '@/nodes/czkawka/upstream/types';
import type {
  DateFilterConfig,
  ExtensionFilterConfig,
  FilterableEntry,
  FilterContext,
  FilterResult,
  FilterState,
  FilterStats,
  GroupMarkStatus,
  MarkStatusOption,
  PathFilterConfig,
  RangeFilterConfig,
  ResolutionFilterConfig,
  SimilarityFilterConfig,
} from './types';
import {
  getDateRange,
  getFileExtension,
  getGroupFileCount,
  getGroupMarkStatus,
  getGroupTotalSize,
  getItemModifiedDate,
  getItemResolution,
  getItemSimilarity,
  getItemSize,
  getUniqueGroupIds,
  matchAspectRatio,
  matchPath,
} from './utils';

/**
 * 应用标记状态过滤
 */
export function applyMarkStatusFilter<T extends BaseEntry & Partial<RefEntry>>(
  data: T[],
  options: MarkStatusOption[],
  selection: Set<string>,
): T[] {
  if (options.length === 0) return data;

  const groupIds = getUniqueGroupIds(data);
  const groupStatuses = new Map<number, GroupMarkStatus>();

  // 预计算每个组的标记状态
  for (const groupId of groupIds) {
    groupStatuses.set(groupId, getGroupMarkStatus(data, groupId, selection));
  }

  return data.filter((item) => {
    const isMarked = selection.has(item.path);
    const groupId = 'groupId' in item ? (item.groupId as number) : undefined;
    const groupStatus =
      groupId !== undefined ? groupStatuses.get(groupId) : undefined;

    // OR 逻辑：匹配任意一个选项即可
    return options.some((option) => {
      switch (option) {
        case 'marked':
          return isMarked;
        case 'unmarked':
          return !isMarked;
        case 'groupHasSomeMarked':
          return groupStatus === 'someMarked' || groupStatus === 'someNotAll';
        case 'groupAllUnmarked':
          return groupStatus === 'allUnmarked';
        case 'groupSomeNotAll':
          return groupStatus === 'someNotAll';
        case 'groupAllMarked':
          return groupStatus === 'allMarked';
        case 'protected':
          return 'isRef' in item && item.isRef === true;
        default:
          return false;
      }
    });
  });
}

/**
 * 应用组文件数量过滤
 */
export function applyGroupCountFilter<T extends BaseEntry & Partial<RefEntry>>(
  data: T[],
  config: RangeFilterConfig,
): T[] {
  if (!config.enabled) return data;

  const groupIds = getUniqueGroupIds(data);
  const validGroupIds = new Set<number>();

  for (const groupId of groupIds) {
    const count = getGroupFileCount(data, groupId);
    if (count >= config.min && count <= config.max) {
      validGroupIds.add(groupId);
    }
  }

  return data.filter((item) => {
    if (!('groupId' in item)) return true;
    return validGroupIds.has(item.groupId as number);
  });
}

/**
 * 应用组大小过滤
 */
export function applyGroupSizeFilter<T extends FilterableEntry>(
  data: T[],
  config: RangeFilterConfig,
): T[] {
  if (!config.enabled) return data;

  const groupIds = getUniqueGroupIds(data);
  const validGroupIds = new Set<number>();

  for (const groupId of groupIds) {
    const totalSize = getGroupTotalSize(data, groupId);
    if (totalSize >= config.min && totalSize <= config.max) {
      validGroupIds.add(groupId);
    }
  }

  return data.filter((item) => {
    if (!('groupId' in item)) return true;
    return validGroupIds.has(item.groupId as number);
  });
}

/**
 * 应用文件大小过滤
 */
export function applyFileSizeFilter<T extends FilterableEntry>(
  data: T[],
  config: RangeFilterConfig,
): T[] {
  if (!config.enabled) return data;

  return data.filter((item) => {
    const size = getItemSize(item);
    return size >= config.min && size <= config.max;
  });
}

/**
 * 应用扩展名过滤
 */
export function applyExtensionFilter<T extends BaseEntry>(
  data: T[],
  config: ExtensionFilterConfig,
): T[] {
  if (!config.enabled || config.extensions.length === 0) return data;

  const normalizedExtensions = new Set(
    config.extensions.map((ext) => ext.toLowerCase().replace(/^\./, '')),
  );

  return data.filter((item) => {
    const ext = getFileExtension(item.path);
    const hasExtension = normalizedExtensions.has(ext);
    return config.mode === 'include' ? hasExtension : !hasExtension;
  });
}

/**
 * 应用日期过滤
 */
export function applyDateFilter<T extends FilterableEntry>(
  data: T[],
  config: DateFilterConfig,
): T[] {
  if (!config.enabled) return data;

  const { start, end } = getDateRange(
    config.preset,
    config.startDate,
    config.endDate,
  );

  return data.filter((item) => {
    const modifiedDate = getItemModifiedDate(item);
    return modifiedDate >= start && modifiedDate <= end;
  });
}

/**
 * 应用路径过滤
 */
export function applyPathFilter<T extends BaseEntry>(
  data: T[],
  config: PathFilterConfig,
): T[] {
  if (!config.enabled || !config.pattern) return data;

  return data.filter((item) =>
    matchPath(item.path, config.pattern, config.mode, config.caseSensitive),
  );
}

/**
 * 应用相似度过滤
 */
export function applySimilarityFilter<T extends FilterableEntry>(
  data: T[],
  config: SimilarityFilterConfig,
): T[] {
  if (!config.enabled) return data;

  return data.filter((item) => {
    const similarity = getItemSimilarity(item);
    return similarity >= config.min && similarity <= config.max;
  });
}

/**
 * 应用分辨率过滤
 */
export function applyResolutionFilter<T extends FilterableEntry>(
  data: T[],
  config: ResolutionFilterConfig,
): T[] {
  if (!config.enabled) return data;

  return data.filter((item) => {
    const resolution = getItemResolution(item);
    if (!resolution) return true; // 没有分辨率信息的项目不过滤

    const { width, height } = resolution;

    // 检查最小/最大分辨率
    if (config.minWidth !== undefined && width < config.minWidth) return false;
    if (config.minHeight !== undefined && height < config.minHeight)
      return false;
    if (config.maxWidth !== undefined && width > config.maxWidth) return false;
    if (config.maxHeight !== undefined && height > config.maxHeight)
      return false;

    // 检查宽高比
    if (config.aspectRatio && config.aspectRatio !== 'any') {
      if (!matchAspectRatio(width, height, config.aspectRatio)) return false;
    }

    return true;
  });
}

/**
 * 应用已选择项过滤
 */
export function applySelectionFilter<T extends BaseEntry>(
  data: T[],
  selection: Set<string>,
  enabled: boolean,
): T[] {
  if (!enabled) return data;
  return data.filter((item) => selection.has(item.path));
}

/**
 * 应用"在已过滤的组中显示所有文件"选项
 */
export function applyShowAllInFilteredGroups<
  T extends BaseEntry & Partial<RefEntry>,
>(originalData: T[], filteredData: T[], showAll: boolean): T[] {
  if (!showAll) return filteredData;

  // 获取过滤后数据中的所有组ID
  const filteredGroupIds = getUniqueGroupIds(filteredData);

  // 如果没有分组数据，直接返回过滤后的数据
  if (filteredGroupIds.size === 0) return filteredData;

  // 返回原始数据中属于这些组的所有项目
  return originalData.filter((item) => {
    if (!('groupId' in item)) {
      // 非分组项目，检查是否在过滤结果中
      return filteredData.some((f) => f.path === item.path);
    }
    return filteredGroupIds.has(item.groupId as number);
  });
}

/**
 * 应用所有过滤器
 */
export function applyFilters<T extends FilterableEntry>(
  ctx: FilterContext<T>,
): FilterResult<T> {
  const { data, selection, filterState } = ctx;
  let filtered = [...data];

  // 按顺序应用各个过滤器（AND 逻辑）
  if (
    filterState.markStatus.enabled &&
    filterState.markStatus.options.length > 0
  ) {
    filtered = applyMarkStatusFilter(
      filtered,
      filterState.markStatus.options,
      selection,
    );
  }

  if (filterState.groupCount.enabled) {
    filtered = applyGroupCountFilter(filtered, filterState.groupCount);
  }

  if (filterState.groupSize.enabled) {
    filtered = applyGroupSizeFilter(filtered, filterState.groupSize);
  }

  if (filterState.fileSize.enabled) {
    filtered = applyFileSizeFilter(filtered, filterState.fileSize);
  }

  if (filterState.extension.enabled) {
    filtered = applyExtensionFilter(filtered, filterState.extension);
  }

  if (filterState.modifiedDate.enabled) {
    filtered = applyDateFilter(filtered, filterState.modifiedDate);
  }

  if (filterState.path.enabled) {
    filtered = applyPathFilter(filtered, filterState.path);
  }

  if (filterState.similarity.enabled) {
    filtered = applySimilarityFilter(filtered, filterState.similarity);
  }

  if (filterState.resolution.enabled) {
    filtered = applyResolutionFilter(filtered, filterState.resolution);
  }

  if (filterState.selectionOnly) {
    filtered = applySelectionFilter(filtered, selection, true);
  }

  // 应用"在已过滤的组中显示所有文件"选项
  if (filterState.showAllInFilteredGroups) {
    filtered = applyShowAllInFilteredGroups(data, filtered, true);
  }

  const stats = calculateStats(data, filtered, filterState);

  return { filteredData: filtered, stats };
}

/**
 * 计算过滤统计
 */
export function calculateStats<T extends FilterableEntry>(
  originalData: T[],
  filteredData: T[],
  filterState: FilterState,
): FilterStats {
  const totalGroups = getUniqueGroupIds(originalData).size;
  const filteredGroups = getUniqueGroupIds(filteredData).size;

  const totalSize = originalData.reduce(
    (sum, item) => sum + getItemSize(item),
    0,
  );
  const filteredSize = filteredData.reduce(
    (sum, item) => sum + getItemSize(item),
    0,
  );

  return {
    totalItems: originalData.length,
    filteredItems: filteredData.length,
    totalGroups,
    filteredGroups,
    totalSize,
    filteredSize,
    activeFilterCount: countActiveFilters(filterState),
  };
}

/**
 * 计算活动过滤器数量
 */
export function countActiveFilters(state: FilterState): number {
  let count = 0;
  if (state.markStatus.enabled && state.markStatus.options.length > 0) count++;
  if (state.groupCount.enabled) count++;
  if (state.groupSize.enabled) count++;
  if (state.fileSize.enabled) count++;
  if (state.extension.enabled && state.extension.extensions.length > 0) count++;
  if (state.modifiedDate.enabled) count++;
  if (state.path.enabled && state.path.pattern) count++;
  if (state.similarity.enabled) count++;
  if (state.resolution.enabled) count++;
  if (state.selectionOnly) count++;
  return count;
}

/**
 * 检查是否有任何过滤器激活
 */
export function isAnyFilterActive(state: FilterState): boolean {
  return countActiveFilters(state) > 0;
}

/**
 * 重置过滤器状态到默认值
 */
export function resetToDefault(): FilterState {
  return {
    markStatus: { enabled: false, options: [] },
    groupCount: { enabled: false, min: 2, max: 100 },
    groupSize: {
      enabled: false,
      min: 0,
      max: 100 * 1024 * 1024 * 1024,
      unit: 'MB',
    },
    fileSize: {
      enabled: false,
      min: 0,
      max: 100 * 1024 * 1024 * 1024,
      unit: 'MB',
    },
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
    showAllInFilteredGroups: true,
    preset: 'none',
  };
}

/**
 * 刷新过滤器 - 重新应用当前过滤条件
 * 这是一个幂等操作，多次调用结果相同
 */
export function refreshFilters<T extends FilterableEntry>(
  ctx: FilterContext<T>,
): FilterResult<T> {
  return applyFilters(ctx);
}
