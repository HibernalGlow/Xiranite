/**
 * SidebarVideoPreview - 视频预览悬浮窗
 * 使用统一的 FloatingPanel 和 GlassCard 组件
 */
import { useAtom } from 'jotai';
import { Video } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { sidebarVideoPreviewAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { FloatingPanel } from '@/nodes/czkawka/upstream/components/cards/floating-panel';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import { useVideoServer } from '@/nodes/czkawka/upstream/hooks/use-video-server';

export function SidebarVideoPreview() {
  const [sidebarState, setSidebarState] = useAtom(sidebarVideoPreviewAtom);
  const { isOpen, videoPath, mode, position, size } = sidebarState;
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const { getVideoUrl } = useVideoServer();

  const handleClose = () => {
    // 关闭时暂停视频
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
    setSidebarState((prev) => ({ ...prev, isOpen: false, videoPath: null }));
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

  // 打开时自动播放
  useEffect(() => {
    if (isOpen && videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, [isOpen, videoPath]);

  if (!videoPath) {
    return null;
  }

  const src = getVideoUrl(videoPath);

  return (
    <FloatingPanel
      panelId="video-preview"
      title={t('Video preview')}
      icon={Video}
      isOpen={isOpen}
      onClose={handleClose}
      mode={mode}
      onModeChange={handleModeChange}
      position={position}
      size={size}
      onPositionChange={handlePositionChange}
      onSizeChange={handleSizeChange}
      minWidth={320}
      minHeight={180}
      maxWidth={1200}
      maxHeight={800}
      fixedPosition={{ right: 20, top: 80 }}
    >
      <div className="h-full flex flex-col gap-2">
        {/* 视频播放区域 */}
        <div className="flex-1 flex items-center justify-center bg-muted/30 rounded-lg overflow-hidden">
          {src ? (
            <video
              ref={videoRef}
              src={src}
              className="max-w-full max-h-full"
              controls
              autoPlay
              onError={() => {
                console.warn('[video] failed to load src', src);
              }}
            />
          ) : (
            <div className="text-xs text-muted-foreground">
              Loading video server...
            </div>
          )}
        </div>

        {/* 文件路径 */}
        <div className="px-2 py-1 text-xs text-muted-foreground border-t border-border/50">
          <div className="break-all line-clamp-2">{videoPath}</div>
        </div>
      </div>
    </FloatingPanel>
  );
}
