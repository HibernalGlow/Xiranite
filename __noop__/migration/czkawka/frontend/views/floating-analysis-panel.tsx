/**
 * FloatingAnalysisPanel - 图表分析悬浮面板
 * 使用统一的 FloatingPanel 和 GlassCard 组件
 */
import { useAtom } from 'jotai';
import { BarChart3, Layers, PieChart } from 'lucide-react';
import { analysisPanelAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { FloatingPanel } from '@/nodes/czkawka/upstream/components/cards/floating-panel';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import { useFormatStats } from '@/nodes/czkawka/upstream/hooks/useFormatStats';
import { useSimilarityStats } from '@/nodes/czkawka/upstream/hooks/useSimilarityStats';
import { FormatBarChartCard } from './cards/format-bar-chart-card';
import { FormatDonutChartCard } from './cards/format-donut-chart-card';
import { SimilarityDistributionCard } from './cards/similarity-distribution-card';

export function FloatingAnalysisPanel() {
  const [panelState, setPanelState] = useAtom(analysisPanelAtom);
  const { isOpen, mode, position, size } = panelState;
  const t = useT();
  const stats = useFormatStats();
  const similarityStats = useSimilarityStats();

  const handleClose = () => {
    setPanelState((prev) => ({ ...prev, isOpen: false }));
  };

  const handleModeChange = (newMode: 'fixed' | 'floating') => {
    setPanelState((prev) => ({
      ...prev,
      mode: newMode,
      position:
        newMode === 'floating' && !prev.position
          ? {
              x: Math.max(
                0,
                Math.min(
                  window.innerWidth / 2 - size.width / 2,
                  window.innerWidth - size.width - 20,
                ),
              ),
              y: 100,
            }
          : prev.position,
    }));
  };

  const handlePositionChange = (newPosition: { x: number; y: number }) => {
    setPanelState((prev) => ({ ...prev, position: newPosition }));
  };

  const handleSizeChange = (newSize: { width: number; height: number }) => {
    setPanelState((prev) => ({ ...prev, size: newSize }));
  };

  const hasData =
    (stats && stats.length > 0) ||
    (similarityStats && similarityStats.length > 0);

  return (
    <FloatingPanel
      panelId="analysis-panel"
      title={t('Data analysis')}
      icon={BarChart3}
      isOpen={isOpen}
      onClose={handleClose}
      mode={mode}
      onModeChange={handleModeChange}
      position={position}
      size={size}
      onPositionChange={handlePositionChange}
      onSizeChange={handleSizeChange}
      minWidth={400}
      minHeight={300}
      maxWidth={900}
      maxHeight={700}
      fixedPosition={{ right: 20, top: 80 }}
    >
      {hasData ? (
        <Tabs defaultValue="format" className="flex flex-col">
          <TabsList className="grid w-full grid-cols-2 mb-2 flex-shrink-0">
            <TabsTrigger value="format" className="flex items-center gap-2">
              <PieChart className="h-4 w-4" />
              {t('File format')}
            </TabsTrigger>
            <TabsTrigger value="similarity" className="flex items-center gap-2">
              <Layers className="h-4 w-4" />
              {t('Similarity')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="format" className="mt-0">
            <div className="space-y-4">
              <FormatDonutChartCard />
              <FormatBarChartCard />
            </div>
          </TabsContent>

          <TabsContent value="similarity" className="mt-0">
            <SimilarityDistributionCard />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="flex items-center justify-center text-muted-foreground py-8">
          <div className="text-center">
            <BarChart3 className="h-12 w-12 mx-auto mb-2 opacity-20" />
            <p className="text-sm">{t('No data available')}</p>
          </div>
        </div>
      )}
    </FloatingPanel>
  );
}
