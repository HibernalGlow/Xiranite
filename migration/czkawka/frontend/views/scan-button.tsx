import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { Ban, Search } from 'lucide-react';
import { useEffect } from 'react';
import { currentToolAtom, logsAtom, progressAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { settingsAtom } from '@/nodes/czkawka/upstream/atom/settings';
import {
  similarImagesFoldersAtom,
  toolInProgressDataAtom,
  toolInProgressRowSelectionAtom,
} from '@/nodes/czkawka/upstream/atom/tools';
import { OperationButton } from '@/nodes/czkawka/upstream/components';
import { getDefaultProgress, Tools } from '@/nodes/czkawka/upstream/consts';
import { useListenEffect, useT } from '@/nodes/czkawka/upstream/hooks';
import { ipc } from '@/nodes/czkawka/upstream/ipc';
import type { AllScanResult, ProgressData, ScanCmd } from '@/nodes/czkawka/upstream/types';
import {
  convertBadFileEntries,
  convertBorkenEntries,
  convertDuplicateEntries,
  convertFileEntries,
  convertFolderEntries,
  convertImagesEntries,
  convertMusicEntries,
  convertSymlinksFileEntries,
  convertTemporaryFileEntries,
  convertVideosEntries,
} from '@/nodes/czkawka/upstream/utils/common';

const scanCmdMap: Record<string, ScanCmd> = {
  [Tools.DuplicateFiles]: 'scan_duplicate_files',
  [Tools.EmptyFolders]: 'scan_empty_folders',
  [Tools.BigFiles]: 'scan_big_files',
  [Tools.EmptyFiles]: 'scan_empty_files',
  [Tools.TemporaryFiles]: 'scan_temporary_files',
  [Tools.SimilarImages]: 'scan_similar_images',
  [Tools.SimilarVideos]: 'scan_similar_videos',
  [Tools.MusicDuplicates]: 'scan_music_duplicates',
  [Tools.InvalidSymlinks]: 'scan_invalid_symlinks',
  [Tools.BrokenFiles]: 'scan_broken_files',
  [Tools.BadExtensions]: 'scan_bad_extensions',
};

const convertFnMap: Record<ScanCmd, (v: any[]) => any[]> = {
  scan_duplicate_files: convertDuplicateEntries,
  scan_empty_folders: convertFolderEntries,
  scan_big_files: convertFileEntries,
  scan_empty_files: convertFileEntries,
  scan_temporary_files: convertTemporaryFileEntries,
  scan_similar_images: convertImagesEntries,
  scan_similar_videos: convertVideosEntries,
  scan_music_duplicates: convertMusicEntries,
  scan_invalid_symlinks: convertSymlinksFileEntries,
  scan_broken_files: convertBorkenEntries,
  scan_bad_extensions: convertBadFileEntries,
};

export function ScanButton() {
  const currentTool = useAtomValue(currentToolAtom);
  const settings = useAtomValue(settingsAtom);
  const [progress, setProgress] = useAtom(progressAtom);
  const setLogs = useSetAtom(logsAtom);
  const setToolInProgressData = useSetAtom(toolInProgressDataAtom);
  const setToolInProgressRowSelection = useSetAtom(
    toolInProgressRowSelectionAtom,
  );
  const setSimilarImagesFolders = useSetAtom(similarImagesFoldersAtom);
  const t = useT();

  useEffect(() => {
    ipc.startListenScanProgress();
  }, []);

  useListenEffect('scan-result', (result: AllScanResult) => {
    const { cmd, message, list, folders } = result as any;
    setLogs(message);
    const convertFn = convertFnMap[cmd as ScanCmd];
    const data = convertFn(list);
    setToolInProgressData(data);
    setToolInProgressRowSelection({});
    if (cmd === 'scan_similar_images' && Array.isArray(folders)) {
      setSimilarImagesFolders(folders);
    } else {
      setSimilarImagesFolders([]);
    }
    setProgress(getDefaultProgress());
  });

  useListenEffect('scan-progress', (result: ProgressData) => {
    setProgress((old) => {
      return { ...old, data: result };
    });
  });

  const handleScan = () => {
    if (progress.tool) {
      return;
    }
    setProgress({ ...progress, tool: currentTool });
    ipc.scan(scanCmdMap[currentTool], settings);
  };

  const handleStopScan = () => {
    if (progress.stopping) {
      return;
    }
    setProgress({ ...progress, stopping: true });
    ipc.stopScan();
  };

  return (
    <>
      {progress.tool ? (
        <OperationButton disabled={progress.stopping} onClick={handleStopScan}>
          <Ban />
          {t('Stop')}
        </OperationButton>
      ) : (
        <OperationButton
          disabled={!settings.includedDirectories.length}
          onClick={handleScan}
        >
          <Search />
          {t('Scan')}
        </OperationButton>
      )}
    </>
  );
}
