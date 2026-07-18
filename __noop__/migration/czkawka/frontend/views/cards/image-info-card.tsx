/**
 * ImageInfoCard - 图片信息卡片
 * 显示选中图片的详细信息
 */
import { useAtomValue } from 'jotai';
import { sidebarImagePreviewAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { useT } from '@/nodes/czkawka/upstream/hooks';

export function ImageInfoCard() {
  const sidebarState = useAtomValue(sidebarImagePreviewAtom);
  const { imagePath } = sidebarState;
  const t = useT();

  if (!imagePath) {
    return (
      <div className="p-2 text-sm text-muted-foreground text-center">
        No image selected
      </div>
    );
  }

  const format = imagePath.split('.').pop()?.toUpperCase() || 'Unknown';

  return (
    <div className="p-2 space-y-2 text-xs">
      <div className="grid grid-cols-2 gap-2">
        <div className="text-muted-foreground">{t('Format')}:</div>
        <div className="truncate">{format}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="text-muted-foreground">{t('Path')}:</div>
        <div className="truncate" title={imagePath}>
          {imagePath}
        </div>
      </div>
    </div>
  );
}
