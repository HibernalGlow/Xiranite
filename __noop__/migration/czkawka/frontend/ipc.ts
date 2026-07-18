import { invoke, isTauri } from '@/nodes/czkawka/upstream/adapters/tauri-core';
import { mockIPC } from '@/nodes/czkawka/upstream/adapters/tauri-mocks';
import type {
  ImageInfo,
  PlatformSettings,
  ScanCmd,
  Settings,
  ThumbnailInfo,
} from '@/nodes/czkawka/upstream/types';

interface MoveFilesOptions {
  paths: string[];
  destination: string;
  copyMode: boolean;
  preserveStructure: boolean;
  overrideMode: boolean;
}

interface MoveFilesToDestinationsOptions {
  items: {
    path: string;
    destination: string;
  }[];
  copyMode: boolean;
  overrideMode: boolean;
}

interface DeleteFilesOptions {
  paths: string[];
  moveDeletedFilesToTrash: boolean;
  isEmptyFoldersTool: boolean;
}

interface SaveResultOptions {
  currentTool: string;
  destination: string;
}

interface RenameExtOptions {
  items: {
    path: string;
    ext: string;
  }[];
}

export const ipc = {
  getPlatformSettings(): Promise<PlatformSettings> {
    return invoke('get_platform_settings');
  },

  setupNumberOfThreads(numberOfThreads: number): Promise<number> {
    return invoke('setup_number_of_threads', { numberOfThreads });
  },

  scan(scanCmd: ScanCmd, settings: Settings) {
    return invoke(scanCmd, { settings });
  },

  startListenScanProgress() {
    return invoke('listen_scan_progress');
  },

  stopScan() {
    return invoke('stop_scan');
  },

  readImage(path: string): Promise<ImageInfo> {
    return invoke('read_image', { path });
  },

  readThumbnail(path: string): Promise<ThumbnailInfo> {
    return invoke('read_thumbnail', { path });
  },

  batchGenerateThumbnails(paths: string[]): Promise<void> {
    return invoke('batch_generate_thumbnails', { paths });
  },

  hasThumbnail(path: string): Promise<boolean> {
    return invoke('has_thumbnail', { path });
  },

  clearThumbnailCache(): Promise<void> {
    return invoke('clear_thumbnail_cache');
  },

  getThumbnailCacheStats(): Promise<[number, number]> {
    return invoke('get_thumbnail_cache_stats');
  },

  moveFiles(options: MoveFilesOptions) {
    return invoke('move_files', { options });
  },

  moveFilesToDestinations(options: MoveFilesToDestinationsOptions) {
    return invoke('move_files_to_destinations', { options });
  },

  deleteFiles(options: DeleteFilesOptions) {
    return invoke('delete_files', { options });
  },

  saveResult(options: SaveResultOptions) {
    return invoke('save_result', { options });
  },

  renameExt(options: RenameExtOptions) {
    return invoke('rename_ext', { options });
  },

  copyFileToClipboard(path: string): Promise<void> {
    return invoke('copy_file_to_clipboard', { path });
  },
};

export function mockIPCForDev() {
  if (!isTauri()) {
    mockIPC((cmd) => {
      if (cmd === 'get_platform_settings') {
        const data: PlatformSettings = {
          includedDirectories: ['foo'],
          excludedDirectories: [
            'bar',
            'baz',
            'fjiefj',
            'jfiefjiej',
            'sjfie',
            'fjeifj',
          ],
          excludedItems: 'foo,bar,baz',
          availableThreadNumber: 8,
          cacheDirPath: '',
        };
        return Promise.resolve(data);
      }
      if (cmd === 'setup_number_of_threads') {
        return Promise.resolve(8);
      }
    });
  }
}
