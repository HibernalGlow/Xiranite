/**
 * 格式筛选状态管理
 * Format Filter State Management
 * 用于在底栏卡片中筛选显示的文件格式
 */
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

// 格式分类类型
export type FormatCategory =
  | 'images'
  | 'videos'
  | 'audio'
  | 'documents'
  | 'archives'
  | 'folders'
  | 'other';

// 格式筛选状态
export interface FormatFilterState {
  // 排除的格式列表
  excludedFormats: string[];
  // 排除的分类列表
  excludedCategories: FormatCategory[];
}

// 默认状态：全选（不排除任何格式）
const defaultState: FormatFilterState = {
  excludedFormats: [],
  excludedCategories: [],
};

// 持久化的格式筛选状态
export const formatFilterAtom = atomWithStorage<FormatFilterState>(
  'czkawka-format-filter',
  defaultState,
);

// 切换单个格式的选中状态
export const toggleFormatAtom = atom(null, (get, set, format: string) => {
  const state = get(formatFilterAtom);
  const isExcluded = state.excludedFormats.includes(format);

  set(formatFilterAtom, {
    ...state,
    excludedFormats: isExcluded
      ? state.excludedFormats.filter((f) => f !== format)
      : [...state.excludedFormats, format],
  });
});

// 切换整个分类的选中状态
export const toggleCategoryAtom = atom(
  null,
  (get, set, category: FormatCategory) => {
    const state = get(formatFilterAtom);
    const isExcluded = state.excludedCategories.includes(category);

    set(formatFilterAtom, {
      ...state,
      excludedCategories: isExcluded
        ? state.excludedCategories.filter((c) => c !== category)
        : [...state.excludedCategories, category],
    });
  },
);

// 全选（清空排除列表）
export const selectAllFormatsAtom = atom(null, (_get, set) => {
  set(formatFilterAtom, {
    excludedFormats: [],
    excludedCategories: [],
  });
});

// 全不选（排除所有）
export const excludeAllFormatsAtom = atom(
  null,
  (get, set, allFormats: string[], allCategories: FormatCategory[]) => {
    set(formatFilterAtom, {
      excludedFormats: [...allFormats],
      excludedCategories: [...allCategories],
    });
  },
);

// 重置为默认状态
export const resetFormatFilterAtom = atom(null, (_get, set) => {
  set(formatFilterAtom, defaultState);
});
