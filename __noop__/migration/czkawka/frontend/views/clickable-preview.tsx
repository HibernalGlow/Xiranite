/**
 * ClickablePreview - 统一的可点击预览组件
 * 自动检测文件类型并显示对应的预览悬浮窗
 */
import { useAtom } from 'jotai';
import {
  sidebarImagePreviewAtom,
  sidebarVideoPreviewAtom,
} from '@/nodes/czkawka/upstream/atom/primitive';
import { getPreviewType } from '@/nodes/czkawka/upstream/utils/file-type-utils';

interface ClickablePreviewProps {
  path: string;
  children: React.ReactNode;
  className?: string;
  disableDefaultStyles?: boolean;
}

export function ClickablePreview(props: ClickablePreviewProps) {
  const { children, path, className, disableDefaultStyles = false } = props;
  const [, setImagePreview] = useAtom(sidebarImagePreviewAtom);
  const [, setVideoPreview] = useAtom(sidebarVideoPreviewAtom);

  const previewType = getPreviewType(path);

  const handleClick = () => {
    if (previewType === 'image') {
      setImagePreview((prev) => ({
        ...prev,
        isOpen: true,
        imagePath: path,
      }));
    } else if (previewType === 'video') {
      setVideoPreview((prev) => ({
        ...prev,
        isOpen: true,
        videoPath: path,
      }));
    }
    // 音频预览暂未实现
  };

  // 如果不是可预览类型，直接返回children
  if (!previewType || previewType === 'audio') {
    return <>{children}</>;
  }

  const defaultClassName = disableDefaultStyles
    ? 'cursor-pointer'
    : 'cursor-pointer hover:bg-accent/50 rounded px-1 py-0.5 transition-colors';

  return (
    <button
      type="button"
      className={className || defaultClassName}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      {children}
    </button>
  );
}
