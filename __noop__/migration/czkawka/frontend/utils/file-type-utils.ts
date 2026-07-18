/**
 * 文件类型检测工具函数
 * 用于判断文件是否为图片、视频等可预览类型
 */

// 支持的图片格式
const IMAGE_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'bmp',
  'webp',
  'tiff',
  'tif',
  'svg',
  'jxl',
  'avif',
  'ico',
  'icns',
];

// 支持的视频格式
const VIDEO_EXTENSIONS = [
  'mp4',
  'mkv',
  'avi',
  'mov',
  'wmv',
  'flv',
  'webm',
  'm4v',
  'mpeg',
  'mpg',
  '3gp',
  'ts',
  'mts',
  'm2ts',
];

// 支持的音频格式（预留）
const AUDIO_EXTENSIONS = [
  'mp3',
  'wav',
  'flac',
  'aac',
  'ogg',
  'm4a',
  'wma',
  'opus',
];

/**
 * 获取文件扩展名（小写）
 */
function getExtension(path: string): string {
  const lastDot = path.lastIndexOf('.');
  if (lastDot === -1 || lastDot === path.length - 1) {
    return '';
  }
  return path.slice(lastDot + 1).toLowerCase();
}

/**
 * 检测是否为图片文件
 */
export function isImageFile(path: string): boolean {
  const ext = getExtension(path);
  return IMAGE_EXTENSIONS.includes(ext);
}

/**
 * 检测是否为视频文件
 */
export function isVideoFile(path: string): boolean {
  const ext = getExtension(path);
  return VIDEO_EXTENSIONS.includes(ext);
}

/**
 * 检测是否为音频文件（预留）
 */
export function isAudioFile(path: string): boolean {
  const ext = getExtension(path);
  return AUDIO_EXTENSIONS.includes(ext);
}

/**
 * 获取文件的预览类型
 * @returns 'image' | 'video' | 'audio' | null
 */
export function getPreviewType(
  path: string,
): 'image' | 'video' | 'audio' | null {
  if (isImageFile(path)) {
    return 'image';
  }
  if (isVideoFile(path)) {
    return 'video';
  }
  if (isAudioFile(path)) {
    return 'audio';
  }
  return null;
}

/**
 * 检测是否为可预览文件（图片或视频）
 */
export function isPreviewableFile(path: string): boolean {
  return isImageFile(path) || isVideoFile(path);
}
