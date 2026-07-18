/**
 * FormatAnalysisDialog - 格式分析对话框入口
 * 点击按钮打开图表分析悬浮面板
 */
import { useSetAtom } from 'jotai';
import { PieChart } from 'lucide-react';
import { analysisPanelAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { TooltipButton } from '@/nodes/czkawka/upstream/components';
import { useT } from '@/nodes/czkawka/upstream/hooks/use-t';
import { useFormatStats } from '@/nodes/czkawka/upstream/hooks/useFormatStats';
import { useSimilarityStats } from '@/nodes/czkawka/upstream/hooks/useSimilarityStats';

export function FormatAnalysisDialog() {
  const setAnalysisPanel = useSetAtom(analysisPanelAtom);
  const stats = useFormatStats();
  const similarityStats = useSimilarityStats();
  const t = useT();

  const hasData =
    (stats && stats.length > 0) ||
    (similarityStats && similarityStats.length > 0);

  if (!hasData) return null;

  const handleOpen = () => {
    setAnalysisPanel((prev) => ({ ...prev, isOpen: true }));
  };

  return (
    <TooltipButton
      tooltip={t('Format analysis')}
      onClick={handleOpen}
      size="sm"
    >
      <PieChart className="h-4 w-4" />
    </TooltipButton>
  );
}
