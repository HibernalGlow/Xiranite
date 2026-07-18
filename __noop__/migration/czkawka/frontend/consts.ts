import type { PlatformSettings, Preset, Progress, Settings } from '@/nodes/czkawka/upstream/types';

export const Theme = {
  Dark: 'dark',
  Light: 'light',
  System: 'system',
} as const;

export const DARK_MODE_MEDIA = '(prefers-color-scheme: dark)';

export function getDefaultPreset(): Preset {
  return {
    name: 'Default',
    active: true,
    changed: false,
    settings: getDefaultSettings(),
  };
}

export const MAXIMUM_FILE_SIZE = Math.floor((2 ** 31 - 1) / 1000);

export const BigFilesSearchMode = {
  BiggestFiles: 'BiggestFiles',
  SmallestFiles: 'SmallestFiles',
} as const;

export const SimilarImagesHashAlgorithm = {
  DoubleGradient: 'DoubleGradient',
  Gradient: 'Gradient',
  Mean: 'Mean',
  BlockHash: 'BlockHash',
  VertGradient: 'VertGradient',
  Median: 'Median',
} as const;

export const SimilarImagesResizeAlgorithm = {
  Lanczos3: 'Lanczos3',
  Gaussian: 'Gaussian',
  CatmullRom: 'CatmullRom',
  Triangle: 'Triangle',
  Nearest: 'Nearest',
} as const;

export const DuplicatesCheckMethod = {
  Hash: 'Hash',
  Size: 'Size',
  Name: 'Name',
  SizeAndName: 'SizeAndName',
} as const;

export const DuplicatesAvailableHashType = {
  Blake3: 'Blake3',
  CRC32: 'CRC32',
  XXH3: 'XXH3',
} as const;

export const SimilarMusicAudioCheckType = {
  Tags: 'Tags',
  Fingerprint: 'Fingerprint',
} as const;

export function getDefaultSettings(): Settings {
  return {
    includedDirectories: [],
    includedDirectoriesReferenced: [],
    excludedDirectories: [],
    excludedItems: '',
    allowedExtensions: '',
    excludedExtensions: '',
    minimumFileSize: 0,
    maximumFileSize: MAXIMUM_FILE_SIZE,
    recursiveSearch: true,
    useCache: true,
    saveAlsoAsJson: false,
    moveDeletedFilesToTrash: true,
    threadNumber: 1,
    referencePathKeywords: '#compare', // Default reference path keyword
    customCacheFolderPath: '', // Default to empty string (use system default)
    customConfigFolderPath: '', // Default to empty string (use system default)
    reversePathDisplay: false, // Default to normal path display

    duplicateImagePreview: true,
    duplicateHideHardLinks: true,
    duplicateUsePrehash: true,
    duplicateMinimalHashCacheSize: 256,
    duplicateMinimalPrehashCacheSize: 256,
    duplicateDeleteOutdatedEntries: true,
    duplicatesSubCheckMethod: DuplicatesCheckMethod.Hash,
    duplicatesSubAvailableHashType: DuplicatesAvailableHashType.Blake3,
    duplicatesSubNameCaseSensitive: false,
    duplicateGroupSizeThreshold: 2,

    similarImagesHideHardLinks: true,
    similarImagesShowImagePreview: true,
    similarImagesEnableThumbnails: true,
    similarImagesDeleteOutdatedEntries: true,
    similarImagesSubHashSize: '16',
    similarImagesSubHashAlg: SimilarImagesHashAlgorithm.Mean,
    similarImagesSubResizeAlgorithm: SimilarImagesResizeAlgorithm.Lanczos3,
    similarImagesSubIgnoreSameSize: false,
    similarImagesSubSimilarity: 10,
    similarImagesFolderThreshold: 5,

    biggestFilesSubMethod: BigFilesSearchMode.BiggestFiles,
    biggestFilesSubNumberOfFiles: 50,

    similarVideosHideHardLinks: true,
    similarVideosEnableThumbnails: true,
    similarVideosDeleteOutdatedEntries: true,
    similarVideosSubIgnoreSameSize: false,
    similarVideosSubSimilarity: 15,
    // 高级参数默认值
    similarVideosSkipForwardAmount: 15,
    similarVideosVidHashDuration: 10,
    similarVideosCropDetect: 'letterbox',

    similarMusicDeleteOutdatedEntries: true,
    similarMusicSubAudioCheckType: SimilarMusicAudioCheckType.Tags,
    similarMusicSubApproximateComparison: false,
    similarMusicCompareFingerprintsOnlyWithSimilarTitles: false,
    similarMusicSubTitle: true,
    similarMusicSubArtist: true,
    similarMusicSubYear: false,
    similarMusicSubBitrate: false,
    similarMusicSubGenre: false,
    similarMusicSubLength: false,
    similarMusicSubMaximumDifferenceValue: 3,
    similarMusicSubMinimalFragmentDurationValue: 5,

    brokenFilesSubAudio: true,
    brokenFilesSubPdf: false,
    brokenFilesSubArchive: false,
    brokenFilesSubImage: false,
    tableWrapText: true,
  };
}

export function getDefaultPlatformSettings(): PlatformSettings {
  return {
    includedDirectories: [],
    excludedDirectories: [],
    excludedItems: '',
    availableThreadNumber: 1,
    cacheDirPath: '',
  };
}

export const Tools = {
  DuplicateFiles: 'Duplicate Files',
  EmptyFolders: 'Empty Folders',
  BigFiles: 'Big Files',
  EmptyFiles: 'Empty Files',
  TemporaryFiles: 'Temporary Files',
  SimilarImages: 'Similar Images',
  SimilarVideos: 'Similar Videos',
  MusicDuplicates: 'Music Duplicates',
  InvalidSymlinks: 'Invalid Symlinks',
  BrokenFiles: 'Broken Files',
  BadExtensions: 'Bad Extensions',
} as const;

export function getDefaultProgress(): Progress {
  return {
    tool: '',
    stopping: false,
    data: {
      currentProgress: 0,
      allProgress: 0,
      stepName: '',
    },
  };
}
