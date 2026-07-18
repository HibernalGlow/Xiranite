/**
 * VideoInfoCard - 视频信息卡片
 * 显示选中视频的详细信息
 */
import { useAtomValue } from 'jotai';
import { sidebarVideoPreviewAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { useT } from '@/nodes/czkawka/upstream/hooks';

export function VideoInfoCard() {
  const sidebarState = useAtomValue(sidebarVideoPreviewAtom);
  const { videoPath } = sidebarState;
  const t = useT();

  if (!videoPath) {
    return (
      <div className="p-2 text-sm text-muted-foreground text-center">
        No video selected
      </div>
    );
  }

  const format = videoPath.split('.').pop()?.toUpperCase() || 'Unknown';

  return (
    <div className="p-2 space-y-2 text-xs">
      <div className="grid grid-cols-2 gap-2">
        <div className="text-muted-foreground">{t('Format')}:</div>
        <div className="truncate">{format}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="text-muted-foreground">{t('Path')}:</div>
        <div className="truncate" title={videoPath}>
          {videoPath}
        </div>
      </div>
    </div>
  );
}
