/**
 * 过滤器面板 Jotai Atoms
 * Filter Panel Jotai Atoms
 */

import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import {
  countActiveFilters,
  isAnyFilterActive,
} from '@/nodes/czkawka/upstream/lib/filter-panel/filter-engine';
import { defaultFilterState } from '@/nodes/czkawka/upstream/lib/filter-panel/presets';
import type { FilterState, FilterStats } from '@/nodes/czkawka/upstream/lib/filter-panel/types';

/** 过滤器状态 atom（持久化到 localStorage） */
export const filterStateAtom = atomWithStorage<FilterState>(
  'filter-panel-state',
  defaultFilterState,
);

/** 过滤器统计 atom */
export const filterStatsAtom = atom<FilterStats>({
  totalItems: 0,
  filteredItems: 0,
  totalGroups: 0,
  filteredGroups: 0,
  totalSize: 0,
  filteredSize: 0,
  activeFilterCount: 0,
});

/** 过滤器是否激活 atom（派生） */
export const isFilterActiveAtom = atom((get) => {
  const state = get(filterStateAtom);
  return isAnyFilterActive(state);
});

/** 活动过滤器数量 atom（派生） */
export const activeFilterCountAtom = atom((get) => {
  const state = get(filterStateAtom);
  return countActiveFilters(state);
});

/** 原始数据缓存 atom（用于刷新和清除） */
export const originalDataCacheAtom = atom<unknown[]>([]);

/** 过滤后的数据 atom */
export const filteredDataAtom = atom<unknown[]>([]);

/** 过滤面板是否展开 atom */
export const filterPanelExpandedAtom = atomWithStorage<boolean>(
  'filter-panel-expanded',
  true,
);

/** 当前展开的过滤器类别 atom */
export const expandedFilterCategoriesAtom = atomWithStorage<string[]>(
  'filter-panel-expanded-categories',
  ['markStatus', 'groupFilters', 'fileFilters'],
);
