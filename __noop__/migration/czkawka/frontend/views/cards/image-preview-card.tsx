/**
 * ImagePreviewCard - 图片预览卡片
 * 显示选中图片的预览内容
 */
import { useAtomValue } from 'jotai';
import { ImageOff, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { sidebarImagePreviewAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { settingsAtom } from '@/nodes/czkawka/upstream/atom/settings';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import { ipc } from '@/nodes/czkawka/upstream/ipc';

export function ImagePreviewCard() {
  const sidebarState = useAtomValue(sidebarImagePreviewAtom);
  const { imagePath } = sidebarState;

  if (!imagePath) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <ImageOff className="h-8 w-8" />
      </div>
    );
  }

  return <ImageContent path={imagePath} />;
}

function ImageContent({ path }: { path: string }) {
  const [src, setSrc] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const _settings = useAtomValue(settingsAtom);
  const t = useT();

  useEffect(() => {
    setLoading(true);
    setError(false);
    setSrc('');

    const readImage = async () => {
      try {
        const { mimeType, base64 } = await ipc.readImage(path);
        setSrc(`data:${mimeType};base64,${base64}`);
      } catch (err) {
        console.error('Failed to read image:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    readImage();
  }, [path]);

  if (loading) {
    return (
      <div className="h-full flex justify-center items-center">
        <div className="flex flex-col items-center gap-2">
          <LoaderCircle className="animate-spin size-8" />
          <div className="text-sm text-muted-foreground">{t('Loading...')}</div>
        </div>
      </div>
    );
  }

  if (error || !src) {
    return (
      <div className="h-full flex flex-col justify-center items-center gap-2">
        <ImageOff className="size-16 text-muted-foreground" />
        <div className="text-sm text-muted-foreground text-center">
          {t('Failed to read image')}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-2">
      {/* 图片显示区域 */}
      <div className="flex-1 flex justify-center items-center bg-muted/30 rounded-lg overflow-hidden">
        <img
          className="max-h-full max-w-full object-contain"
          src={src}
          alt={path}
          onError={() => setError(true)}
        />
      </div>

      {/* 文件路径 */}
      <div className="px-2 py-1 text-xs text-muted-foreground border-t border-border/50">
        <div className="break-all line-clamp-2">{path}</div>
      </div>
    </div>
  );
}
