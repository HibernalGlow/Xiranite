/**
 * FloatingFilterPanel - 过滤器悬浮面板
 * 使用统一的 FloatingPanel 和新的 FilterPanel 组件
 */
import { useAtom } from 'jotai';
import { Filter } from 'lucide-react';
import { filterPanelAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { FloatingPanel } from '@/nodes/czkawka/upstream/components/cards/floating-panel';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import { FilterPanel } from './filter-panel';

export function FloatingFilterPanel() {
  const [panelState, setPanelState] = useAtom(filterPanelAtom);
  const { isOpen, mode, position, size } = panelState;
  const t = useT();

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

  return (
    <FloatingPanel
      panelId="filter-panel"
      title={t('Filter')}
      icon={Filter}
      isOpen={isOpen}
      onClose={handleClose}
      mode={mode}
      onModeChange={handleModeChange}
      position={position}
      size={size}
      onPositionChange={handlePositionChange}
      onSizeChange={handleSizeChange}
      minWidth={300}
      minHeight={200}
      maxWidth={600}
      maxHeight={700}
      fixedPosition={{ right: 16, top: 64 }}
    >
      <FilterPanel />
    </FloatingPanel>
  );
}
