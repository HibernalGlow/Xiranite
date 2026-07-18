/**
 * DynamicPreviewCell - 统一的动态预览单元格组件
 * 自动根据文件类型选择使用图片或视频缩略图组件
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { isImageFile, isVideoFile } from '@/nodes/czkawka/upstream/utils/file-type-utils';
import { ThumbnailCell } from './thumbnail-cell';
import { VideoThumbnailCell } from './video-thumbnail-cell';

interface DynamicPreviewCellProps {
  path: string;
  enableLazyLoad?: boolean;
  className?: string;
  onSizeChange?: (width: number) => void;
  onImageClick?: () => void;
  onVideoClick?: () => void;
}

export function DynamicPreviewCell({
  path,
  enableLazyLoad = true,
  className = '',
  onSizeChange,
  onImageClick,
  onVideoClick,
}: DynamicPreviewCellProps) {
  const [columnWidth, setColumnWidth] = useState(80);
  const cellRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<number>();

  const updateColumnWidth = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      if (cellRef.current) {
        const width = cellRef.current.offsetWidth;
        if (width > 0) {
          setColumnWidth(width);
          onSizeChange?.(width);
        }
      }
    }, 16);
  }, [onSizeChange]);

  useEffect(() => {
    updateColumnWidth();

    let resizeObserver: ResizeObserver | null = null;

    if (cellRef.current) {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === cellRef.current) {
            updateColumnWidth();
            break;
          }
        }
      });
      resizeObserver.observe(cellRef.current);
    }

    window.addEventListener('resize', updateColumnWidth);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('resize', updateColumnWidth);
    };
  }, [updateColumnWidth]);

  const isImage = isImageFile(path);
  const isVideo = isVideoFile(path);

  // 如果既不是图片也不是视频，返回 null
  if (!isImage && !isVideo) {
    return null;
  }

  return (
    <div
      ref={cellRef}
      className="flex items-center justify-center w-full h-full overflow-hidden"
    >
      {isImage ? (
        <ThumbnailCell
          path={path}
          size="dynamic"
          dynamicSize={columnWidth}
          enableLazyLoad={enableLazyLoad}
          className={className}
        />
      ) : (
        <VideoThumbnailCell
          path={path}
          size="dynamic"
          dynamicSize={columnWidth}
          enableLazyLoad={enableLazyLoad}
          className={className}
          onClick={onVideoClick}
        />
      )}
    </div>
  );
}
