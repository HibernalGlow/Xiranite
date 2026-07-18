import type { Tools } from './consts';

type ValueOf<T> = T[keyof T];

export type ToolsValues = ValueOf<typeof Tools>;

export interface ThemeCfg {
  display: string;
  className: string;
}

export interface ThemeColors {
  light: Record<string, string>;
  dark: Record<string, string>;
}

export interface CustomThemeConfig {
  name: string;
  description: string;
  colors: ThemeColors;
}

export interface RuntimeThemePayload {
  mode: 'light' | 'dark' | 'system';
  themeName?: string;
  themes: ThemeColors;
}

export interface Preset {
  name: string;
  active: boolean;
  changed: boolean;
  settings: Settings;
}

export interface Settings {
  includedDirectories: string[];
  includedDirectoriesReferenced: string[];
  excludedDirectories: string[];
  excludedItems: string;
  allowedExtensions: string;
  excludedExtensions: string;
  minimumFileSize: number;
  maximumFileSize: number;
  recursiveSearch: boolean;
  useCache: boolean;
  saveAlsoAsJson: boolean;
  moveDeletedFilesToTrash: boolean;
  threadNumber: number;
  referencePathKeywords: string; // Keywords for auto-marking reference paths
  customCacheFolderPath: string; // Custom path for cache folder
  customConfigFolderPath: string; // Custom path for config folder
  reversePathDisplay: boolean; // Enable reverse path display for easier comparison

  duplicateImagePreview: boolean;
  duplicateHideHardLinks: boolean;
  duplicateUsePrehash: boolean;
  duplicateMinimalHashCacheSize: number;
  duplicateMinimalPrehashCacheSize: number;
  duplicateDeleteOutdatedEntries: boolean;
  duplicatesSubCheckMethod: string;
  duplicatesSubAvailableHashType: string;
  duplicatesSubNameCaseSensitive: boolean;
  // 最小重复组大小过滤(>=该值的组才显示)
  duplicateGroupSizeThreshold: number;

  similarImagesHideHardLinks: boolean;
  similarImagesShowImagePreview: boolean;
  similarImagesEnableThumbnails: boolean;
  similarImagesDeleteOutdatedEntries: boolean;
  similarImagesSubHashSize: string;
  similarImagesSubHashAlg: string;
  similarImagesSubResizeAlgorithm: string;
  similarImagesSubIgnoreSameSize: boolean;
  similarImagesSubSimilarity: number;
  similarImagesFolderThreshold: number;

  biggestFilesSubMethod: string;
  biggestFilesSubNumberOfFiles: number;

  similarVideosHideHardLinks: boolean;
  similarVideosEnableThumbnails: boolean;
  similarVideosDeleteOutdatedEntries: boolean;
  similarVideosSubIgnoreSameSize: boolean;
  similarVideosSubSimilarity: number;
  // 高级参数：视频相似度计算
  // 每次取帧前向跳过的秒数（0 表示不跳过）
  similarVideosSkipForwardAmount: number;
  // 参与哈希的持续时长（秒）
  similarVideosVidHashDuration: number;
  // 裁剪检测策略：letterbox/motion/none
  similarVideosCropDetect: string;

  similarMusicDeleteOutdatedEntries: boolean;
  similarMusicSubAudioCheckType: string;
  similarMusicSubApproximateComparison: boolean;
  similarMusicCompareFingerprintsOnlyWithSimilarTitles: boolean;
  similarMusicSubTitle: boolean;
  similarMusicSubArtist: boolean;
  similarMusicSubYear: boolean;
  similarMusicSubBitrate: boolean;
  similarMusicSubGenre: boolean;
  similarMusicSubLength: boolean;
  similarMusicSubMaximumDifferenceValue: number;
  similarMusicSubMinimalFragmentDurationValue: number;

  brokenFilesSubAudio: boolean;
  brokenFilesSubPdf: boolean;
  brokenFilesSubArchive: boolean;
  brokenFilesSubImage: boolean;

  // 表格显示设置
  tableWrapText: boolean; // 表格文字折行
}

export interface PlatformSettings {
  includedDirectories: string[];
  excludedDirectories: string[];
  excludedItems: string;
  availableThreadNumber: number;
  cacheDirPath: string;
}

export type DirsType = Extract<
  keyof Settings,
  'includedDirectories' | 'excludedDirectories'
>;

export type ScanCmd =
  | 'scan_duplicate_files'
  | 'scan_empty_folders'
  | 'scan_big_files'
  | 'scan_empty_files'
  | 'scan_temporary_files'
  | 'scan_similar_images'
  | 'scan_similar_videos'
  | 'scan_music_duplicates'
  | 'scan_invalid_symlinks'
  | 'scan_broken_files'
  | 'scan_bad_extensions';

export interface Progress {
  tool: ToolsValues | '';
  stopping: boolean;
  data: ProgressData;
}

export interface ProgressData {
  currentProgress: number;
  allProgress: number;
  stepName: string;
}

export interface BaseEntry {
  path: string;
}

export interface RefEntry {
  isRef: boolean;
  hidden: boolean;
  groupId?: number;
}

export interface RawFileEntry {
  path: string;
  size: number;
  modified_date: number;
}

export interface FileEntry extends BaseEntry {
  size: string;
  fileName: string;
  modifiedDate: string;
}

export interface RawDuplicateEntry {
  path: string;
  modified_date: number;
  size: number;
  hash: string;
}

export interface DuplicateEntry extends BaseEntry, RefEntry {
  size: string;
  fileName: string;
  modifiedDate: string;
  hash: string;
  isImage: boolean;
  raw: RawDuplicateEntry;
}

export interface RawFolderOrTemporaryFileEntry {
  path: string;
  modified_date: number;
}

export interface FolderEntry extends BaseEntry {
  folderName: string;
  modifiedDate: string;
}

export interface TemporaryFileEntry extends BaseEntry {
  fileName: string;
  modifiedDate: string;
}

export interface RawImagesEntry {
  path: string;
  size: number;
  width: number;
  height: number;
  modified_date: number;
  similarity: string;
}

export interface ImagesEntry extends BaseEntry, RefEntry {
  fileName: string;
  size: string;
  modifiedDate: string;
  similarity: string;
  dimensions: string;
  raw: RawImagesEntry;
}

export interface RawVideosEntry {
  path: string;
  size: number;
  modified_date: number;
}

export interface VideosEntry extends BaseEntry, RefEntry {
  fileName: string;
  size: string;
  modifiedDate: string;
  raw: RawVideosEntry;
}

export interface RawMusicEntry {
  size: number;
  path: string;
  modified_date: number;
  track_title: string;
  track_artist: string;
  year: string;
  length: string;
  genre: string;
  bitrate: number;
}

export interface MusicEntry extends BaseEntry, RefEntry {
  size: string;
  fileName: string;
  modifiedDate: string;
  trackTitle: string;
  trackArtist: string;
  year: string;
  length: string;
  genre: string;
  bitrate: string;
  raw: RawMusicEntry;
}

export interface RawSymlinksFileEntry {
  path: string;
  size: number;
  modified_date: number;
  symlink_info: {
    destination_path: string;
    type_of_error: string;
  };
}

export interface SymlinksFileEntry extends BaseEntry {
  symlinkName: string;
  modifiedDate: string;
  destinationPath: string;
  typeOfError: string;
  size: string;
}

export interface RawBrokenEntry {
  path: string;
  modified_date: number;
  size: number;
  error_string: string;
}

export interface BrokenEntry extends BaseEntry {
  fileName: string;
  modifiedDate: string;
  size: string;
  errorString: string;
}

export interface RawBadFileEntry {
  path: string;
  modified_date: number;
  size: number;
  current_extension: string;
  proper_extensions_group: string;
  proper_extension: string;
}

export interface BadFileEntry extends BaseEntry {
  fileName: string;
  modifiedDate: string;
  currentExtension: string;
  properExtensionsGroup: string;
  properExtension: string;
}

interface ScanResult<C extends ScanCmd, L> {
  cmd: C;
  list: L;
  message: string;
}

export type TupleWithRefItem<T> = [T | null, T[]];

export type AllScanResult =
  | ScanResult<'scan_duplicate_files', TupleWithRefItem<RawDuplicateEntry>[]>
  | ScanResult<'scan_empty_folders', RawFolderOrTemporaryFileEntry[]>
  | ScanResult<'scan_big_files', RawFileEntry[]>
  | ScanResult<'scan_empty_files', RawFileEntry[]>
  | ScanResult<'scan_temporary_files', RawFolderOrTemporaryFileEntry[]>
  | ScanResult<'scan_similar_images', TupleWithRefItem<RawImagesEntry>[]>
  | ScanResult<'scan_similar_videos', TupleWithRefItem<RawVideosEntry>[]>
  | ScanResult<'scan_music_duplicates', TupleWithRefItem<RawMusicEntry>[]>
  | ScanResult<'scan_invalid_symlinks', RawSymlinksFileEntry[]>
  | ScanResult<'scan_broken_files', RawBrokenEntry[]>
  | ScanResult<'scan_bad_extensions', RawBadFileEntry[]>;

export interface FolderStat {
  path: string;
  count: number;
}
export interface ScanResultWithFolders
  extends ScanResult<
    'scan_similar_images',
    TupleWithRefItem<RawImagesEntry>[]
  > {
  folders: FolderStat[];
}

export interface ImageInfo {
  base64: string;
  mimeType: string;
}

export interface ThumbnailInfo {
  base64: string;
  mimeType: string;
  width: number;
  height: number;
}
