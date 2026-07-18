import type { SortingState } from '@tanstack/react-table';
import type { BaseEntry, RefEntry } from '@/nodes/czkawka/upstream/types';

export function filterGroups<T extends BaseEntry>(
  groups: T[][],
  filter: string,
  filterKeys: (keyof T)[],
): T[][] {
  if (!filter) {
    return groups;
  }

  const lowercaseFilter = filter.toLowerCase();

  const filtered = groups
    .map((group) => {
      return group.filter((item) => {
        for (const key of filterKeys) {
          const value = item[key];
          if (typeof value !== 'string') {
            continue;
          }
          if (value.toLowerCase().includes(lowercaseFilter)) {
            return true;
          }
        }
        return false;
      });
    })
    .filter((group) => group.length > 0);

  return filtered;
}

// For non-grouped data
export function filterItems<T extends BaseEntry>(
  items: T[],
  filter: string,
  filterKeys: (keyof T)[],
): T[] {
  if (!filter) {
    return items;
  }

  const lowercaseFilter = filter.toLowerCase();

  return items.filter((item) => {
    for (const key of filterKeys) {
      const value = item[key];
      if (typeof value !== 'string') {
        continue;
      }
      if (value.toLowerCase().includes(lowercaseFilter)) {
        return true;
      }
    }
    return false;
  });
}

/** Extra fields added by processDataWithGroups */
export interface GroupedFields {
  _isGroupEnd?: boolean;
  groupSize?: number;
  groupId?: number;
}

/**
 * Generic group processing for any RefEntry-based data.
 * Splits flat array (with hidden separators) into groups,
 * assigns groupId, groupSize, and _isGroupEnd to each item,
 * and removes hidden separator rows.
 */
export function processDataWithGroups<T extends RefEntry>(
  data: T[],
): (T & GroupedFields)[] {
  const result: (T & GroupedFields)[] = [];
  let currentGroup: (T & GroupedFields)[] = [];
  let groupId = 0;

  for (let i = 0; i < data.length; i++) {
    const curr = data[i];
    if (curr.hidden) {
      if (currentGroup.length > 0) {
        const refCount = currentGroup.filter((item) => item.isRef).length;
        const groupSize = currentGroup.length - refCount;
        for (const item of currentGroup) {
          item.groupSize = groupSize;
          item.groupId = groupId;
        }
        result.push(...currentGroup);
        currentGroup = [];
      }
      groupId++;
      continue;
    }
    const next = data[i + 1];
    currentGroup.push({
      ...curr,
      _isGroupEnd: !!next?.hidden,
    } as T & GroupedFields);
  }
  // Handle last group
  if (currentGroup.length > 0) {
    const refCount = currentGroup.filter((item) => item.isRef).length;
    const groupSize = currentGroup.length - refCount;
    for (const item of currentGroup) {
      item.groupSize = groupSize;
      item.groupId = groupId;
    }
    result.push(...currentGroup);
  }
  return result;
}

const parseSize = (str: string): number => {
  const match = str?.match(/^([\d.]+)\s*(B|KB|MB|GB)?$/i);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = match[2]?.toUpperCase() as 'B' | 'KB' | 'MB' | 'GB' | undefined;
  const multiplier =
    { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[unit || 'B'] ?? 1;
  return num * multiplier;
};

/**
 * Sort grouped data by sorting whole groups as units.
 * Uses groupId (assigned by processDataWithGroups) to identify groups.
 * The sort key is derived from the first row of each group.
 */
export function sortGroupedData<T extends GroupedFields>(
  data: T[],
  sorting: SortingState,
): T[] {
  if (!sorting.length || !data.length) return data;

  // Split into groups by groupId
  const groupMap = new Map<number, T[]>();
  for (const row of data) {
    const gid = row.groupId ?? 0;
    if (!groupMap.has(gid)) {
      groupMap.set(gid, []);
    }
    groupMap.get(gid)!.push(row);
  }

  const groups = Array.from(groupMap.values());

  const getValue = (row: T, id: string): any => {
    const val = (row as any)[id];
    if (id === 'size') return parseSize(String(val ?? ''));
    if (id === 'modifiedDate') return new Date(val).getTime();
    if (id === 'groupSize') return Number(val) || 0;
    return val;
  };

  // Sort groups by representative value from first row
  groups.sort((ga, gb) => {
    const a = ga[0];
    const b = gb[0];
    for (const sort of sorting) {
      const aVal = getValue(a, sort.id);
      const bVal = getValue(b, sort.id);
      let cmp = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        cmp = aVal - bVal;
      } else if (typeof aVal === 'string' && typeof bVal === 'string') {
        cmp = aVal.localeCompare(bVal);
      }
      if (cmp !== 0) return sort.desc ? -cmp : cmp;
    }
    return 0;
  });

  return groups.flat();
}
