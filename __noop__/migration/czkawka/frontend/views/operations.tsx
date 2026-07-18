import { useAtomValue, useSetAtom } from 'jotai';
import { Info, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { currentToolAtom, progressAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { selectionAssistantPanelAtom } from '@/nodes/czkawka/upstream/atom/selection-assistant';
import { currentToolFilteredDataAtom } from '@/nodes/czkawka/upstream/atom/tools';
import { TooltipButton } from '@/nodes/czkawka/upstream/components';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tools } from '@/nodes/czkawka/upstream/consts';
import {
  getAllSimilarityLevelsWithRanges,
  getSimilarityLevelText,
} from '@/nodes/czkawka/upstream/utils/similarity-utils';
import { DeleteFiles } from './delete-files';
import { FormatAnalysisDialog } from './format-analysis';
import { MoveFiles } from './move-files';
import { OrganizeSimilarGroups } from './organize-similar-groups';
import { RenameExt } from './rename-ext';
import { RowSelectionMenu } from './row-selection-menu';
import { SaveResult } from './save-result';
import { ScanButton } from './scan-button';
import { FloatingSelectionAssistant } from './selection-assistant';

function SimilarityQuickTableDialog() {
  const [open, setOpen] = useState(false);
  const hashSizes = [8, 16, 32, 64];
  // 获取所有级别
  const levels = getAllSimilarityLevelsWithRanges(16).map((l) => l.level);
  // 构造表格数据：每行一个级别，每列一个hashSize
  const tableData = levels.map((level) => {
    return {
      level,
      text: getSimilarityLevelText(level),
      ranges: hashSizes.map(
        (hs) =>
          getAllSimilarityLevelsWithRanges(hs).find((l) => l.level === level)
            ?.range || '',
      ),
    };
  });
  return (
    <>
      <TooltipButton
        tooltip="相似度速查表"
        onClick={() => setOpen(true)}
        size="sm"
      >
        <Info className="h-4 w-4" />
      </TooltipButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>相似度与哈希大小速查表</DialogTitle>
          </DialogHeader>
          <table className="w-full border border-border rounded text-xs whitespace-nowrap">
            <thead>
              <tr className="bg-muted/40">
                <th className="px-2 py-1 font-medium text-left">级别</th>
                {hashSizes.map((hs) => (
                  <th key={hs} className="px-2 py-1 font-medium text-left">
                    hashSize {hs}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableData.map((row) => (
                <tr key={row.level} className="border-t border-border">
                  <td className="px-2 py-1 text-left align-middle">
                    {row.text}
                  </td>
                  {row.ranges.map((range, idx) => (
                    <td
                      key={`${row.level}-${idx}`}
                      className="px-2 py-1 text-left align-middle"
                    >
                      {range}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Operations() {
  const progress = useAtomValue(progressAtom);
  const currentToolData = useAtomValue(currentToolFilteredDataAtom);
  const currentTool = useAtomValue(currentToolAtom);
  const setSelectionAssistantPanel = useSetAtom(selectionAssistantPanelAtom);

  const disabled = !!progress.tool || !currentToolData.length;

  const openSelectionAssistant = () => {
    setSelectionAssistantPanel((prev) => ({ ...prev, isOpen: true }));
  };

  return (
    <div className="flex gap-1">
      <ScanButton />
      <RowSelectionMenu disabled={disabled} />
      <TooltipButton
        tooltip="Selection Assistant"
        disabled={disabled}
        onClick={openSelectionAssistant}
        size="sm"
      >
        <Wand2 className="h-4 w-4" />
      </TooltipButton>
      <OrganizeSimilarGroups disabled={disabled} />
      <MoveFiles disabled={disabled} />
      <DeleteFiles disabled={disabled} />
      <SaveResult disabled={disabled} />
      {currentTool === Tools.BadExtensions && <RenameExt disabled={disabled} />}
      <FormatAnalysisDialog />
      <SimilarityQuickTableDialog />
      <FloatingSelectionAssistant />
    </div>
  );
}
