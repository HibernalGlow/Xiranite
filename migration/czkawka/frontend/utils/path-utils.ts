/**
 * 路径显示工具函数
 */

/**
 * 将路径逆向显示，隐藏文件名只显示文件夹路径
 * 例如: "C:\Users\Documents\Project\file.txt" -> "Project\Documents\Users\C:"
 * @param path 原始路径
 * @returns 逆向显示的路径（不包含文件名）
 */
export function reversePathDisplay(path: string): string {
  if (!path) return path;

  // 标准化路径分隔符
  const normalizedPath = path.replace(/\\/g, '/');

  // 分割路径
  const parts = normalizedPath.split('/').filter((part) => part.length > 0);

  if (parts.length === 0) return path;

  // 移除最后一个部分（文件名），只保留文件夹路径
  const folderParts = parts.slice(0, -1);

  if (folderParts.length === 0) {
    // 如果只有文件名，返回空字符串或根目录标识
    return path.includes('\\') ? '\\' : '/';
  }

  // 逆向排列文件夹部分
  const reversedParts = folderParts.reverse();

  // 重新组合，使用原始路径的分隔符风格
  const separator = path.includes('\\') ? '\\' : '/';
  return reversedParts.join(separator);
}

/**
 * 根据设置决定是否逆向显示路径
 * @param path 原始路径
 * @param reverseEnabled 是否启用逆向显示
 * @returns 处理后的路径
 */
export function formatPathDisplay(
  path: string,
  reverseEnabled: boolean,
): string {
  return reverseEnabled ? reversePathDisplay(path) : path;
}
