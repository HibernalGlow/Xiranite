/**
 * 过滤器面板工具函数
 * Filter Panel Utility Functions
 */

import type { BaseEntry, RefEntry } from '@/nodes/czkawka/upstream/types';
import type {
  FilterableEntry,
  GroupMarkStatus,
  PathMatchMode,
  SizeUnit,
} from './types';

/** 大小单位乘数 */
const SIZE_MULTIPLIERS: Record<SizeUnit, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
  TB: 1024 * 1024 * 1024 * 1024,
};

/**
 * 解析文件大小字符串为字节数
 * @param sizeStr 大小字符串，如 "1.5 MB", "100KB"
 * @returns 字节数
 */
export function parseSizeToBytes(sizeStr: string): number {
  if (!sizeStr || typeof sizeStr !== 'string') return 0;

  const match = sizeStr.trim().match(/^([\d.]+)\s*([KMGTPE]?B?)$/i);
  if (!match) return 0;

  const [, numStr, unitStr] = match;
  const value = Number.parseFloat(numStr);
  if (Number.isNaN(value)) return 0;

  const unit = unitStr.toUpperCase() as SizeUnit;
  const multiplier = SIZE_MULTIPLIERS[unit] || 1;
  return Math.round(value * multiplier);
}

/**
 * 格式化字节数为可读字符串
 * @param bytes 字节数
 * @param targetUnit 目标单位（可选，自动选择最合适的单位）
 * @returns 格式化后的字符串
 */
export function formatBytes(bytes: number, targetUnit?: SizeUnit): string {
  if (bytes === 0) return '0 B';
  if (targetUnit) {
    const value = bytes / SIZE_MULTIPLIERS[targetUnit];
    return `${value.toFixed(2)} ${targetUnit}`;
  }

  const units: SizeUnit[] = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let value = bytes;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * 转换大小单位
 * @param value 数值
 * @param fromUnit 源单位
 * @param toUnit 目标单位
 * @returns 转换后的数值
 */
export function convertSize(
  value: number,
  fromUnit: SizeUnit,
  toUnit: SizeUnit,
): number {
  const bytes = value * SIZE_MULTIPLIERS[fromUnit];
  return bytes / SIZE_MULTIPLIERS[toUnit];
}

/**
 * 获取文件扩展名
 * @param path 文件路径
 * @returns 扩展名（小写，不含点）
 */
export function getFileExtension(path: string): string {
  if (!path) return '';
  const fileName = path.split(/[/\\]/).pop() || '';
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1 || lastDot === 0) return '';
  return fileName.substring(lastDot + 1).toLowerCase();
}

/**
 * 检查路径是否匹配模式
 * @param path 文件路径
 * @param pattern 匹配模式
 * @param mode 匹配方式
 * @param caseSensitive 是否区分大小写
 * @returns 是否匹配
 */
export function matchPath(
  path: string,
  pattern: string,
  mode: PathMatchMode,
  caseSensitive: boolean,
): boolean {
  if (!path || !pattern) return false;

  const normalizedPath = caseSensitive ? path : path.toLowerCase();
  const normalizedPattern = caseSensitive ? pattern : pattern.toLowerCase();

  switch (mode) {
    case 'contains':
      return normalizedPath.includes(normalizedPattern);
    case 'notContains':
      return !normalizedPath.includes(normalizedPattern);
    case 'startsWith':
      return normalizedPath.startsWith(normalizedPattern);
    case 'endsWith':
      return normalizedPath.endsWith(normalizedPattern);
    default:
      return false;
  }
}

/**
 * 获取组内文件数量
 * @param data 数据列表
 * @param groupId 组ID
 * @returns 文件数量
 */
export function getGroupFileCount<T extends BaseEntry & Partial<RefEntry>>(
  data: T[],
  groupId: number,
): number {
  return data.filter((item) => 'groupId' in item && item.groupId === groupId)
    .length;
}

/**
 * 获取组内文件总大小
 * @param data 数据列表
 * @param groupId 组ID
 * @returns 总大小（字节）
 */
export function getGroupTotalSize<T extends FilterableEntry>(
  data: T[],
  groupId: number,
): number {
  return data
    .filter((item) => 'groupId' in item && item.groupId === groupId)
    .reduce((total, item) => {
      const size = item.raw?.size ?? parseSizeToBytes(item.size || '0');
      return total + size;
    }, 0);
}

/**
 * 检查组的标记状态
 * @param data 数据列表
 * @param groupId 组ID
 * @param selection 选择集合
 * @returns 组标记状态
 */
export function getGroupMarkStatus<T extends BaseEntry & Partial<RefEntry>>(
  data: T[],
  groupId: number,
  selection: Set<string>,
): GroupMarkStatus {
  const groupItems = data.filter(
    (item) => 'groupId' in item && item.groupId === groupId,
  );

  if (groupItems.length === 0) return 'allUnmarked';

  const markedCount = groupItems.filter((item) =>
    selection.has(item.path),
  ).length;

  if (markedCount === 0) return 'allUnmarked';
  if (markedCount === groupItems.length) return 'allMarked';
  if (markedCount > 0 && markedCount < groupItems.length) return 'someNotAll';
  return 'someMarked';
}

/**
 * 获取所有唯一的组ID
 * @param data 数据列表
 * @returns 组ID集合
 */
export function getUniqueGroupIds<T extends BaseEntry & Partial<RefEntry>>(
  data: T[],
): Set<number> {
  const groupIds = new Set<number>();
  for (const item of data) {
    if ('groupId' in item && typeof item.groupId === 'number') {
      groupIds.add(item.groupId);
    }
  }
  return groupIds;
}

/**
 * 获取文件大小（字节）
 * @param item 数据条目
 * @returns 文件大小（字节）
 */
export function getItemSize(item: FilterableEntry): number {
  if (item.raw?.size !== undefined) return item.raw.size;
  if (item.size) return parseSizeToBytes(item.size);
  return 0;
}

/**
 * 获取文件修改日期（时间戳）
 * @param item 数据条目
 * @returns 修改日期时间戳
 */
export function getItemModifiedDate(item: FilterableEntry): number {
  if (item.raw?.modified_date !== undefined) return item.raw.modified_date;
  if (item.modifiedDate) return new Date(item.modifiedDate).getTime();
  return 0;
}

/**
 * 获取相似度值
 * @param item 数据条目
 * @returns 相似度百分比 (0-100)
 */
export function getItemSimilarity(item: FilterableEntry): number {
  if (!item.similarity) return 100;
  // 相似度字符串可能是 "95%" 或 "95" 格式
  const match = item.similarity.match(/(\d+)/);
  if (match) return Number.parseInt(match[1], 10);
  return 100;
}

/**
 * 获取分辨率
 * @param item 数据条目
 * @returns { width, height } 或 null
 */
export function getItemResolution(
  item: FilterableEntry,
): { width: number; height: number } | null {
  if (item.raw?.width !== undefined && item.raw?.height !== undefined) {
    return { width: item.raw.width, height: item.raw.height };
  }
  if (item.dimensions) {
    const match = item.dimensions.match(/(\d+)\s*[x×]\s*(\d+)/i);
    if (match) {
      return {
        width: Number.parseInt(match[1], 10),
        height: Number.parseInt(match[2], 10),
      };
    }
  }
  return null;
}

/**
 * 检查宽高比是否匹配
 * @param width 宽度
 * @param height 高度
 * @param aspectRatio 目标宽高比
 * @returns 是否匹配
 */
export function matchAspectRatio(
  width: number,
  height: number,
  aspectRatio: '16:9' | '4:3' | '1:1' | 'any',
): boolean {
  if (aspectRatio === 'any') return true;
  if (height === 0) return false;

  const ratio = width / height;
  const tolerance = 0.1; // 10% 容差

  switch (aspectRatio) {
    case '16:9':
      return Math.abs(ratio - 16 / 9) < tolerance;
    case '4:3':
      return Math.abs(ratio - 4 / 3) < tolerance;
    case '1:1':
      return Math.abs(ratio - 1) < tolerance;
    default:
      return true;
  }
}

/**
 * 获取日期范围的开始和结束时间戳
 * @param preset 日期预设
 * @param customStart 自定义开始时间
 * @param customEnd 自定义结束时间
 * @returns { start, end } 时间戳
 */
export function getDateRange(
  preset: 'today' | 'last7days' | 'last30days' | 'lastYear' | 'custom',
  customStart?: number,
  customEnd?: number,
): { start: number; end: number } {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  switch (preset) {
    case 'today': {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      return { start: todayStart.getTime(), end: now };
    }
    case 'last7days':
      return { start: now - 7 * dayMs, end: now };
    case 'last30days':
      return { start: now - 30 * dayMs, end: now };
    case 'lastYear':
      return { start: now - 365 * dayMs, end: now };
    case 'custom':
      return {
        start: customStart ?? 0,
        end: customEnd ?? now,
      };
    default:
      return { start: 0, end: now };
  }
}

/** 常用扩展名预设 */
export const EXTENSION_PRESETS = {
  images: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff'],
  videos: ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a'],
  documents: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt'],
  archives: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'],
} as const;
