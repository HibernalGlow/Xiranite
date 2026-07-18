/**
 * 过滤作用域 Hook
 * Filtered Scope Hook - 处理过滤后的选择操作
 */

import type { BaseEntry } from '@/nodes/czkawka/upstream/types';

/**
 * 在过滤后的数据上执行全选操作
 * @param filteredData 过滤后的数据
 * @param currentSelection 当前选择集合
 * @returns 新的选择集合
 */
export function selectAllFiltered<T extends BaseEntry>(
  filteredData: T[],
  currentSelection: Set<string>,
): Set<string> {
  const newSelection = new Set(currentSelection);
  for (const item of filteredData) {
    newSelection.add(item.path);
  }
  return newSelection;
}

/**
 * 在过滤后的数据上执行反选操作
 * @param filteredData 过滤后的数据
 * @param currentSelection 当前选择集合
 * @returns 新的选择集合
 */
export function invertSelectionFiltered<T extends BaseEntry>(
  filteredData: T[],
  currentSelection: Set<string>,
): Set<string> {
  const newSelection = new Set(currentSelection);
  const filteredPaths = new Set(filteredData.map((item) => item.path));

  for (const path of filteredPaths) {
    if (newSelection.has(path)) {
      newSelection.delete(path);
    } else {
      newSelection.add(path);
    }
  }
  return newSelection;
}

/**
 * 在过滤后的数据上执行取消全选操作
 * @param filteredData 过滤后的数据
 * @param currentSelection 当前选择集合
 * @returns 新的选择集合
 */
export function deselectAllFiltered<T extends BaseEntry>(
  filteredData: T[],
  currentSelection: Set<string>,
): Set<string> {
  const newSelection = new Set(currentSelection);
  for (const item of filteredData) {
    newSelection.delete(item.path);
  }
  return newSelection;
}

/**
 * 获取过滤后数据中已选择的项目
 * @param filteredData 过滤后的数据
 * @param currentSelection 当前选择集合
 * @returns 已选择的项目列表
 */
export function getSelectedInFiltered<T extends BaseEntry>(
  filteredData: T[],
  currentSelection: Set<string>,
): T[] {
  return filteredData.filter((item) => currentSelection.has(item.path));
}

/**
 * 计算过滤后数据中的选择统计
 * @param filteredData 过滤后的数据
 * @param currentSelection 当前选择集合
 * @returns 选择统计
 */
export function getFilteredSelectionStats<T extends BaseEntry>(
  filteredData: T[],
  currentSelection: Set<string>,
): { total: number; selected: number } {
  const selected = filteredData.filter((item) =>
    currentSelection.has(item.path),
  ).length;
  return {
    total: filteredData.length,
    selected,
  };
}

/**
 * 检查是否所有过滤后的项目都已选择
 * @param filteredData 过滤后的数据
 * @param currentSelection 当前选择集合
 * @returns 是否全选
 */
export function isAllFilteredSelected<T extends BaseEntry>(
  filteredData: T[],
  currentSelection: Set<string>,
): boolean {
  if (filteredData.length === 0) return false;
  return filteredData.every((item) => currentSelection.has(item.path));
}

/**
 * 检查是否有任何过滤后的项目被选择
 * @param filteredData 过滤后的数据
 * @param currentSelection 当前选择集合
 * @returns 是否有选择
 */
export function isAnyFilteredSelected<T extends BaseEntry>(
  filteredData: T[],
  currentSelection: Set<string>,
): boolean {
  return filteredData.some((item) => currentSelection.has(item.path));
}
