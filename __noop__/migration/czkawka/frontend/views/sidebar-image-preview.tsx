/**
 * SidebarImagePreview - 图片预览悬浮窗
 * 使用统一的 FloatingPanel 和 GlassCard 组件
 */
import { useAtom } from 'jotai';
import { Image } from 'lucide-react';
import { sidebarImagePreviewAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { FloatingPanel } from '@/nodes/czkawka/upstream/components/cards/floating-panel';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import { ImagePreviewCard } from '@/nodes/czkawka/upstream/views/cards/image-preview-card';

export function SidebarImagePreview() {
  const [sidebarState, setSidebarState] = useAtom(sidebarImagePreviewAtom);
  const { isOpen, imagePath, mode, position, size } = sidebarState;
  const t = useT();

  const handleClose = () => {
    setSidebarState((prev) => ({ ...prev, isOpen: false, imagePath: null }));
  };

  const handleModeChange = (newMode: 'fixed' | 'floating') => {
    setSidebarState((prev) => ({
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
    setSidebarState((prev) => ({ ...prev, position: newPosition }));
  };

  const handleSizeChange = (newSize: { width: number; height: number }) => {
    setSidebarState((prev) => ({ ...prev, size: newSize }));
  };

  if (!imagePath) {
    return null;
  }

  return (
    <FloatingPanel
      panelId="image-preview"
      title={t('Image preview')}
      icon={Image}
      isOpen={isOpen}
      onClose={handleClose}
      mode={mode}
      onModeChange={handleModeChange}
      position={position}
      size={size}
      onPositionChange={handlePositionChange}
      onSizeChange={handleSizeChange}
      minWidth={200}
      minHeight={150}
      maxWidth={800}
      maxHeight={800}
      fixedPosition={{ right: 20, top: 80 }}
    >
      <ImagePreviewCard />
    </FloatingPanel>
  );
}
