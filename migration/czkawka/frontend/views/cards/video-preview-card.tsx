/**
 * VideoPreviewCard - 视频预览卡片
 * 显示选中视频的预览内容
 */
import { useAtomValue } from 'jotai';
import { Video } from 'lucide-react';
import { sidebarVideoPreviewAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { useT } from '@/nodes/czkawka/upstream/hooks';

export function VideoPreviewCard() {
  const sidebarState = useAtomValue(sidebarVideoPreviewAtom);
  const { videoPath } = sidebarState;
  const t = useT();

  if (!videoPath) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <Video className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-2">
      {/* 视频显示区域 */}
      <div className="flex-1 flex justify-center items-center bg-muted/30 rounded-lg overflow-hidden">
        <video
          className="max-h-full max-w-full object-contain"
          src={videoPath}
          controls
          autoPlay={false}
        />
      </div>

      {/* 文件路径 */}
      <div className="px-2 py-1 text-xs text-muted-foreground border-t border-border/50">
        <div className="break-all line-clamp-2">{videoPath}</div>
      </div>
    </div>
  );
}
