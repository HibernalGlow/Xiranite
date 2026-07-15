/**
 * 选择助手匹配器
 * 使用 ts-pattern 实现文本匹配逻辑
 */

import { match } from 'ts-pattern';
import type { MatchCondition, TextColumn } from './types';

/**
 * 文本匹配器
 * @param text 要匹配的文本
 * @param pattern 匹配模式
 * @param condition 匹配条件
 * @param caseSensitive 是否大小写敏感
 * @param useRegex 是否使用正则表达式
 * @returns 是否匹配
 */
export function matchText(
  text: string,
  pattern: string,
  condition: MatchCondition,
  caseSensitive: boolean,
  useRegex: boolean,
): boolean {
  // 空模式不匹配任何内容
  if (!pattern) {
    return false;
  }

  // 正则表达式模式
  if (useRegex) {
    try {
      const flags = caseSensitive ? '' : 'i';
      return new RegExp(pattern, flags).test(text);
    } catch {
      // 无效正则表达式返回 false
      return false;
    }
  }

  // 普通文本匹配
  const normalizedText = caseSensitive ? text : text.toLowerCase();
  const normalizedPattern = caseSensitive ? pattern : pattern.toLowerCase();

  return match(condition)
    .with('contains', () => normalizedText.includes(normalizedPattern))
    .with('notContains', () => !normalizedText.includes(normalizedPattern))
    .with('equals', () => normalizedText === normalizedPattern)
    .with('startsWith', () => normalizedText.startsWith(normalizedPattern))
    .with('endsWith', () => normalizedText.endsWith(normalizedPattern))
    .exhaustive();
}

/**
 * 获取文件的指定列值
 * @param path 文件完整路径
 * @param column 要获取的列
 * @returns 列值
 */
export function getColumnValue(path: string, column: TextColumn): string {
  return match(column)
    .with('fullPath', () => path)
    .with('fileName', () => {
      const lastSep = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
      return lastSep >= 0 ? path.substring(lastSep + 1) : path;
    })
    .with('folderPath', () => {
      const lastSep = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
      return lastSep > 0 ? path.substring(0, lastSep) : '';
    })
    .exhaustive();
}

/**
 * 获取文件所在目录
 * @param path 文件完整路径
 * @returns 目录路径
 */
export function getDirectory(path: string): string {
  const lastSep = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return lastSep > 0 ? path.substring(0, lastSep) : '';
}

/**
 * 检查路径是否在指定目录下
 * @param path 文件路径
 * @param directory 目录路径
 * @returns 是否在目录下
 */
export function isInDirectory(path: string, directory: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/').toLowerCase();
  const normalizedDir = directory.replace(/\\/g, '/').toLowerCase();

  // 确保目录路径以 / 结尾进行比较
  const dirWithSlash = normalizedDir.endsWith('/')
    ? normalizedDir
    : `${normalizedDir}/`;

  return (
    normalizedPath.toLowerCase().startsWith(dirWithSlash) ||
    getDirectory(normalizedPath).toLowerCase() ===
      normalizedDir.replace(/\/$/, '')
  );
}

/**
 * 验证正则表达式是否有效
 * @param pattern 正则表达式字符串
 * @returns 是否有效
 */
export function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}
