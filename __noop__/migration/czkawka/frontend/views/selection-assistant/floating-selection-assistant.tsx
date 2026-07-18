/**
 * FloatingSelectionAssistant - 选择助手悬浮面板
 * 使用统一的 FloatingPanel 和 GlassCard 组件
 */
import { useAtom } from 'jotai';
import { Wand2 } from 'lucide-react';
import { selectionAssistantPanelAtom } from '@/nodes/czkawka/upstream/atom/selection-assistant';
import { FloatingPanel } from '@/nodes/czkawka/upstream/components/cards/floating-panel';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import { SelectionAssistantPanel } from './selection-assistant-panel';
import { useSelectionShortcuts } from './use-selection-shortcuts';

export function FloatingSelectionAssistant() {
  const [panelState, setPanelState] = useAtom(selectionAssistantPanelAtom);
  const { isOpen, mode, position, size } = panelState;
  const t = useT();

  // 启用键盘快捷键
  useSelectionShortcuts();

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
      panelId="selection-assistant"
      title={t('Selection Assistant')}
      icon={Wand2}
      isOpen={isOpen}
      onClose={handleClose}
      mode={mode}
      onModeChange={handleModeChange}
      position={position}
      size={size}
      onPositionChange={handlePositionChange}
      onSizeChange={handleSizeChange}
      minWidth={320}
      minHeight={400}
      maxWidth={600}
      maxHeight={800}
      fixedPosition={{ right: 16, top: 64 }}
    >
      <SelectionAssistantPanel />
    </FloatingPanel>
  );
}
