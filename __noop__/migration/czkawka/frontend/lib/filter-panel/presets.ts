/**
 * 过滤器预设定义
 * Filter Presets Definition
 */

import type { FilterPreset, FilterState } from './types';

/** 默认过滤器状态 */
export const defaultFilterState: FilterState = {
  markStatus: {
    enabled: false,
    options: [],
  },
  groupCount: {
    enabled: false,
    min: 2,
    max: 100,
  },
  groupSize: {
    enabled: false,
    min: 0,
    max: 100 * 1024 * 1024 * 1024, // 100GB
    unit: 'MB',
  },
  fileSize: {
    enabled: false,
    min: 0,
    max: 100 * 1024 * 1024 * 1024, // 100GB
    unit: 'MB',
  },
  extension: {
    enabled: false,
    extensions: [],
    mode: 'include',
  },
  modifiedDate: {
    enabled: false,
    preset: 'custom',
  },
  path: {
    enabled: false,
    mode: 'contains',
    pattern: '',
    caseSensitive: false,
  },
  similarity: {
    enabled: false,
    min: 0,
    max: 100,
  },
  resolution: {
    enabled: false,
    aspectRatio: 'any',
  },
  selectionOnly: false,
  showAllInFilteredGroups: true,
  preset: 'none',
};

/** 预设配置映射 */
export const presetConfigs: Record<FilterPreset, Partial<FilterState>> = {
  none: {},

  // 大文件优先 - 过滤出大于 100MB 的文件
  largeFilesFirst: {
    fileSize: {
      enabled: true,
      min: 100 * 1024 * 1024, // 100MB
      max: 100 * 1024 * 1024 * 1024, // 100GB
      unit: 'MB',
    },
  },

  // 小文件优先 - 过滤出小于 1MB 的文件
  smallFilesFirst: {
    fileSize: {
      enabled: true,
      min: 0,
      max: 1 * 1024 * 1024, // 1MB
      unit: 'KB',
    },
  },

  // 最近修改 - 过滤出最近 30 天修改的文件
  recentlyModified: {
    modifiedDate: {
      enabled: true,
      preset: 'last30days',
    },
  },

  // 旧文件 - 过滤出超过 1 年未修改的文件
  oldFiles: {
    modifiedDate: {
      enabled: true,
      preset: 'custom',
      startDate: 0,
      endDate: Date.now() - 365 * 24 * 60 * 60 * 1000,
    },
  },
};

/**
 * 应用预设
 * @param currentState 当前过滤器状态
 * @param preset 预设名称
 * @returns 应用预设后的过滤器状态
 */
export function applyPreset(
  currentState: FilterState,
  preset: FilterPreset,
): FilterState {
  if (preset === 'none') {
    return { ...defaultFilterState, preset: 'none' };
  }

  const presetConfig = presetConfigs[preset];
  return {
    ...defaultFilterState,
    ...presetConfig,
    preset,
  };
}

/**
 * 获取预设显示名称
 */
export function getPresetDisplayName(preset: FilterPreset): string {
  const names: Record<FilterPreset, string> = {
    none: '暂无',
    largeFilesFirst: '大文件优先',
    smallFilesFirst: '小文件优先',
    recentlyModified: '最近修改',
    oldFiles: '旧文件',
  };
  return names[preset];
}

/**
 * 重置过滤器状态到默认值
 */
export function resetFilterState(): FilterState {
  return { ...defaultFilterState };
}
