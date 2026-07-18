import type { RowSelectionState, SortingState } from '@tanstack/react-table';
import { atom } from 'jotai';
import type {
  FilterStateUpdater,
  RowSelectionUpdater,
  SortingStateUpdater,
} from '@/nodes/czkawka/upstream/components/data-table';
import type { BaseEntry, FolderStat } from '@/nodes/czkawka/upstream/types';
import {
  currentToolAtom,
  filterAtom,
  progressAtom,
  rowSelectionAtom,
  searchInputValueAtom,
  sortingAtom,
  toolDataAtom,
} from './primitive';

// 相似图片文件夹统计数据
export const similarImagesFoldersAtom = atom<FolderStat[]>([]);

// 相似图片视图模式：images（图片列表）或 folders（文件夹统计）
export type SimilarImagesViewMode = 'images' | 'folders';
export const similarImagesViewModeAtom = atom<SimilarImagesViewMode>('images');

export const currentToolDataAtom = atom(
  (get) => {
    const currentTool = get(currentToolAtom);
    const toolData = get(toolDataAtom);
    return toolData[currentTool];
  },
  (get, set, data: any[] | any[][]) => {
    const currentTool = get(currentToolAtom);
    const toolData = get(toolDataAtom);
    set(toolDataAtom, {
      ...toolData,
      [currentTool]: data,
    });
  },
);

export const toolInProgressDataAtom = atom(
  (get) => {
    const progress = get(progressAtom);
    if (!progress.tool) {
      return null;
    }
    const toolData = get(toolDataAtom);
    return toolData[progress.tool];
  },
  (get, set, data: any[] | any[][]) => {
    const progress = get(progressAtom);
    if (!progress.tool) {
      return;
    }
    const toolData = get(toolDataAtom);
    set(toolDataAtom, {
      ...toolData,
      [progress.tool]: data,
    });
  },
);

export const currentToolRowSelectionAtom = atom(
  (get) => {
    const currentTool = get(currentToolAtom);
    const rowSelection = get(rowSelectionAtom);
    return rowSelection[currentTool];
  },
  (get, set, updater: RowSelectionUpdater) => {
    const currentTool = get(currentToolAtom);
    const rowSelection = get(rowSelectionAtom);
    set(rowSelectionAtom, {
      ...rowSelection,
      [currentTool]:
        typeof updater === 'function'
          ? updater(rowSelection[currentTool])
          : updater,
    });
  },
);

export const toolInProgressRowSelectionAtom = atom(
  (get) => {
    const progress = get(progressAtom);
    if (!progress.tool) {
      return null;
    }
    const rowSelection = get(rowSelectionAtom);
    return rowSelection[progress.tool];
  },
  (get, set, updater: RowSelectionUpdater) => {
    const progress = get(progressAtom);
    if (!progress.tool) {
      return;
    }
    const rowSelection = get(rowSelectionAtom);
    set(rowSelectionAtom, {
      ...rowSelection,
      [progress.tool]:
        typeof updater === 'function'
          ? updater(rowSelection[progress.tool])
          : updater,
    });
  },
);

export const clearToolInProgressRowSelectionAtom = atom(null, (get, set) => {
  const progress = get(progressAtom);
  if (!progress.tool) {
    return;
  }
  const rowSelection = get(rowSelectionAtom);
  set(rowSelectionAtom, {
    ...rowSelection,
    [progress.tool]: {},
  });
});

export const currentToolSortingAtom = atom(
  (get) => {
    const currentTool = get(currentToolAtom);
    const sorting = get(sortingAtom);
    return sorting[currentTool];
  },
  (get, set, updater: SortingStateUpdater) => {
    const currentTool = get(currentToolAtom);
    const sorting = get(sortingAtom);
    set(sortingAtom, {
      ...sorting,
      [currentTool]:
        typeof updater === 'function' ? updater(sorting[currentTool]) : updater,
    });
  },
);

export const currentToolFilterAtom = atom(
  (get) => {
    const currentTool = get(currentToolAtom);
    const filter = get(filterAtom);
    return filter[currentTool];
  },
  (get, set, updater: FilterStateUpdater) => {
    const currentTool = get(currentToolAtom);
    const filter = get(filterAtom);
    set(filterAtom, {
      ...filter,
      [currentTool]:
        typeof updater === 'function' ? updater(filter[currentTool]) : updater,
    });
  },
);

export const restoreFilterAtom = atom(null, (get, set) => {
  const filter = get(currentToolFilterAtom);
  set(searchInputValueAtom, filter);
});

// ----------------------------------------------------------------------------
// 整合后的过滤数据 Atom (整合格式过滤与搜索过滤)
// ----------------------------------------------------------------------------
import { Tools } from '@/nodes/czkawka/upstream/consts';
import { applyFormatFilter } from '@/nodes/czkawka/upstream/hooks/useFormatFilteredData';
import { formatFilterAtom } from './format-filter';

// 各工具对应的搜索字段映射
const TOOL_FILTER_KEYS: Record<string, string[]> = {
  [Tools.DuplicateFiles]: ['fileName', 'path'],
  [Tools.BigFiles]: ['fileName', 'path'],
  [Tools.TemporaryFiles]: ['fileName', 'path'],
  [Tools.BrokenFiles]: ['fileName', 'path', 'errorString'],
  [Tools.BadExtensions]: [
    'fileName',
    'path',
    'currentExtension',
    'properExtensionsGroup',
  ],
  [Tools.InvalidSymlinks]: [
    'symlinkName',
    'path',
    'destinationPath',
    'typeOfError',
  ],
  [Tools.SimilarImages]: ['fileName', 'path'],
  [Tools.SimilarVideos]: ['fileName', 'path'],
  [Tools.MusicDuplicates]: [
    'fileName',
    'path',
    'trackTitle',
    'trackArtist',
    'genre',
  ],
  [Tools.EmptyFiles]: ['fileName', 'path'],
  [Tools.EmptyFolders]: ['folderName', 'path'],
};

/**
 * 当前选定项的完整过滤后数据 (已被 RowSelectionMenu 和 Operations 使用)
 */
export const currentToolFilteredDataAtom = atom((get) => {
  const data = get(currentToolDataAtom);
  const filter = get(currentToolFilterAtom);
  const formatFilter = get(formatFilterAtom);
  const currentTool = get(currentToolAtom);

  if (!data || data.length === 0) return [];

  // 1. 应用格式过滤
  let filtered = applyFormatFilter(
    data as any[],
    formatFilter.excludedFormats,
    formatFilter.excludedCategories,
  );

  // 2. 应用搜索过滤
  if (filter) {
    const lowercaseFilter = filter.toLowerCase();
    const keys = TOOL_FILTER_KEYS[currentTool] || ['path'];

    filtered = filtered.filter((item) => {
      // 这里的 item 是原始数据项，不含 hidden 属性(hidden 是视图层添加的)
      // 但为了保险也检查一下
      if (item.hidden) return true;

      for (const key of keys) {
        const value = (item as any)[key];
        if (
          typeof value === 'string' &&
          value.toLowerCase().includes(lowercaseFilter)
        ) {
          return true;
        }
      }
      return false;
    });
  }

  return filtered;
});

/**
 * 正在处理中的工具过滤后数据
 */
export const toolInProgressFilteredDataAtom = atom((get) => {
  const data = get(toolInProgressDataAtom);
  const progress = get(progressAtom);
  const formatFilter = get(formatFilterAtom);
  const filter = get(currentToolFilterAtom); // 搜索过滤

  if (!data || data.length === 0 || !progress.tool) return [];

  // 1. 格式过滤
  let filtered = applyFormatFilter(
    data as any[],
    formatFilter.excludedFormats,
    formatFilter.excludedCategories,
  );

  // 2. 搜索过滤
  if (filter) {
    const lowercaseFilter = filter.toLowerCase();
    const keys = TOOL_FILTER_KEYS[progress.tool] || ['path'];

    filtered = filtered.filter((item) => {
      for (const key of keys) {
        const value = (item as any)[key];
        if (
          typeof value === 'string' &&
          value.toLowerCase().includes(lowercaseFilter)
        ) {
          return true;
        }
      }
      return false;
    });
  }

  return filtered;
});
