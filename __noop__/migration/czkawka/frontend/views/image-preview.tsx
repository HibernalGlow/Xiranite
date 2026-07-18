import { useAtomValue } from 'jotai';
import { ImageOff, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { settingsAtom } from '@/nodes/czkawka/upstream/atom/settings';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import { ipc } from '@/nodes/czkawka/upstream/ipc';

interface ImgPreviewProps {
  path: string;
}

export function ImagePreview(props: React.PropsWithChildren<ImgPreviewProps>) {
  const { children, path } = props;

  return (
    <HoverCard openDelay={100} closeDelay={0}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent className="p-0 h-[450px] w-[500px]" side="right">
        <Image path={path} />
      </HoverCardContent>
    </HoverCard>
  );
}

function Image(props: { path: string }) {
  const { path } = props;

  const [src, setSrc] = useState('');
  const [loading, setLoading] = useState(true);
  const settings = useAtomValue(settingsAtom);
  const t = useT();

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    const readImage = async () => {
      try {
        if (settings.similarImagesEnableThumbnails) {
          // 使用缩略图
          const { mimeType, base64 } = await ipc.readThumbnail(path);
          setSrc(`data:${mimeType};base64,${base64}`);
        } else {
          // 使用原图
          const { mimeType, base64 } = await ipc.readImage(path);
          setSrc(`data:${mimeType};base64,${base64}`);
        }
      } catch (_) {
        //
      } finally {
        setLoading(false);
      }
    };
    readImage();
  }, [settings.similarImagesEnableThumbnails]);

  if (src) {
    return (
      <img className="h-full w-full object-contain" src={src} alt={path} />
    );
  }

  if (loading) {
    return (
      <div className="h-full w-full flex justify-center items-center">
        <LoaderCircle className="animate-spin size-8" />
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col justify-center items-center">
      <ImageOff className="size-24" />
      {t('Failed to read image')}
    </div>
  );
}
