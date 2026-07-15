/**
 * useFormatFilteredData - 格式筛选数据 hook
 * 将格式筛选状态应用到数据过滤
 */
import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { type FormatCategory, formatFilterAtom } from '@/nodes/czkawka/upstream/atom/format-filter';
import { EXTENSION_PRESETS } from '@/nodes/czkawka/upstream/lib/filter-panel/utils';
import type { BaseEntry } from '@/nodes/czkawka/upstream/types';

// 获取格式的分类
function getFormatCategory(format: string): FormatCategory {
  if (format === 'folder' || format === '文件夹') return 'folders';
  if (format === 'unknown') return 'other';
  for (const [category, config] of Object.entries(CATEGORY_EXTENSIONS)) {
    if (config.includes(format.toLowerCase())) {
      return category as FormatCategory;
    }
  }
  return 'other';
}

// 分类扩展名映射
const CATEGORY_EXTENSIONS: Record<FormatCategory, readonly string[]> = {
  images: EXTENSION_PRESETS.images,
  videos: EXTENSION_PRESETS.videos,
  audio: EXTENSION_PRESETS.audio,
  documents: EXTENSION_PRESETS.documents,
  archives: EXTENSION_PRESETS.archives,
  folders: [],
  other: [],
};

// 从路径获取扩展名 (与 useFormatStats.ts 保持一致)
function getExtension(item: any): string {
  if ('folderName' in item || item.isFolder) {
    return 'folder';
  }
  const path = item.path || '';
  const match = path.match(/\.([^.]+)$/);
  const ext = (match ? match[1].toLowerCase() : 'unknown').trim() || 'unknown';
  return ext;
}

/**
 * 应用格式过滤器到数据
 */
export function applyFormatFilter<T extends BaseEntry>(
  data: T[],
  excludedFormats: string[],
  excludedCategories: FormatCategory[],
): T[] {
  // 如果没有排除项，返回原始数据
  if (excludedFormats.length === 0 && excludedCategories.length === 0) {
    return data;
  }

  const excludedFormatSet = new Set(
    excludedFormats.map((f) => f.toLowerCase()),
  );
  const excludedCategorySet = new Set(excludedCategories);

  return data.filter((item) => {
    // 如果是隐藏项（通常是分组分隔符），保留它
    if ('hidden' in item && (item as any).hidden) {
      return true;
    }

    const ext = getExtension(item);

    // 检查是否直接排除了这个格式
    if (excludedFormatSet.has(ext)) {
      return false;
    }

    // 检查是否排除了这个格式所属的分类
    const category = getFormatCategory(ext);
    if (excludedCategorySet.has(category)) {
      return false;
    }

    return true;
  });
}

/**
 * 格式过滤 hook
 * 自动从 atom 获取筛选状态并应用
 */
export function useFormatFilteredData<T extends BaseEntry>(data: T[]): T[] {
  const filterState = useAtomValue(formatFilterAtom);

  return useMemo(() => {
    return applyFormatFilter(
      data,
      filterState.excludedFormats,
      filterState.excludedCategories,
    );
  }, [data, filterState.excludedFormats, filterState.excludedCategories]);
}

/**
 * 检查是否有任何格式过滤器激活
 */
export function useIsFormatFilterActive(): boolean {
  const filterState = useAtomValue(formatFilterAtom);
  return (
    filterState.excludedFormats.length > 0 ||
    filterState.excludedCategories.length > 0
  );
}
