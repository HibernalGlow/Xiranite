/**
 * FloatingPanel - 悬浮面板容器组件
 * 使用 GlassCard 作为容器，支持拖拽移动和调整大小
 * 自动适配窗口大小变化和主题
 */

import { Pin, PinOff, X } from 'lucide-react';
import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/nodes/czkawka/upstream/utils/cn';
import { GlassCard } from './glass-card';

export interface FloatingPanelProps {
  // 面板标识
  panelId: string;
  title: string;
  icon?: ComponentType<{ className?: string }>;

  // 内容
  children: ReactNode;

  // 状态控制
  isOpen: boolean;
  onClose: () => void;

  // 模式
  mode: 'fixed' | 'floating';
  onModeChange?: (mode: 'fixed' | 'floating') => void;

  // 位置和大小
  position?: { x: number; y: number } | null;
  size?: { width: number; height: number };
  onPositionChange?: (position: { x: number; y: number }) => void;
  onSizeChange?: (size: { width: number; height: number }) => void;

  // 约束
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;

  // 固定模式位置
  fixedPosition?: {
    right?: number;
    top?: number;
    left?: number;
    bottom?: number;
  };

  // 样式
  className?: string;
}

export function FloatingPanel({
  panelId: _panelId,
  title,
  icon: Icon,
  children,
  isOpen,
  onClose,
  mode,
  onModeChange,
  position,
  size = { width: 400, height: 500 },
  onPositionChange,
  onSizeChange,
  minWidth = 200,
  minHeight = 150,
  maxWidth = 800,
  maxHeight = 800,
  fixedPosition = { right: 20, top: 80 },
  className,
}: FloatingPanelProps) {
  const dragRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<string | null>(null);
  const [resizeStartPos, setResizeStartPos] = useState({ x: 0, y: 0 });
  const [resizeStartSize, setResizeStartSize] = useState({
    width: 0,
    height: 0,
  });

  const isFloating = mode === 'floating';

  // 窗口大小变化时自动调整面板位置和大小
  useEffect(() => {
    if (!isOpen) return;

    const handleResize = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // 限制最大尺寸不超过视口
      const effectiveMaxWidth = Math.min(maxWidth, vw - 40);
      const effectiveMaxHeight = Math.min(maxHeight, vh - 40);

      let needsUpdate = false;
      let newWidth = size.width;
      let newHeight = size.height;
      let newX = position?.x ?? 0;
      let newY = position?.y ?? 0;

      // 调整尺寸
      if (size.width > effectiveMaxWidth) {
        newWidth = effectiveMaxWidth;
        needsUpdate = true;
      }
      if (size.height > effectiveMaxHeight) {
        newHeight = effectiveMaxHeight;
        needsUpdate = true;
      }

      // 调整位置确保在视口内
      if (isFloating && position) {
        if (position.x + newWidth > vw) {
          newX = Math.max(0, vw - newWidth - 20);
          needsUpdate = true;
        }
        if (position.y + newHeight > vh) {
          newY = Math.max(0, vh - newHeight - 20);
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        if (newWidth !== size.width || newHeight !== size.height) {
          onSizeChange?.({ width: newWidth, height: newHeight });
        }
        if (
          isFloating &&
          position &&
          (newX !== position.x || newY !== position.y)
        ) {
          onPositionChange?.({ x: newX, y: newY });
        }
      }
    };

    window.addEventListener('resize', handleResize);
    // 初始检查
    handleResize();

    return () => window.removeEventListener('resize', handleResize);
  }, [
    isOpen,
    isFloating,
    position,
    size,
    maxWidth,
    maxHeight,
    onPositionChange,
    onSizeChange,
  ]);

  const toggleMode = () => {
    const newMode = mode === 'fixed' ? 'floating' : 'fixed';
    onModeChange?.(newMode);

    if (newMode === 'floating' && !position) {
      // 切换到浮动模式时设置初始位置
      const vw = window.innerWidth;
      onPositionChange?.({
        x: Math.max(0, Math.min(vw / 2 - size.width / 2, vw - size.width - 20)),
        y: 100,
      });
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isFloating || isResizing) return;

    setIsDragging(true);
    if (position) {
      setDragOffset({
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      });
    }
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      if (isDragging && isFloating && position) {
        const newX = Math.max(
          0,
          Math.min(e.clientX - dragOffset.x, vw - size.width),
        );
        const newY = Math.max(
          0,
          Math.min(e.clientY - dragOffset.y, vh - size.height),
        );
        onPositionChange?.({ x: newX, y: newY });
      }

      if (isResizing && isFloating && position && resizeDirection) {
        const deltaX = e.clientX - resizeStartPos.x;
        const deltaY = e.clientY - resizeStartPos.y;

        // 动态计算最大尺寸
        const effectiveMaxWidth = Math.min(maxWidth, vw - 40);
        const effectiveMaxHeight = Math.min(maxHeight, vh - 40);

        let newWidth = resizeStartSize.width;
        let newHeight = resizeStartSize.height;
        let newX = position.x;
        let newY = position.y;

        // 处理不同方向的调整
        if (resizeDirection.includes('e')) {
          newWidth = Math.max(
            minWidth,
            Math.min(effectiveMaxWidth, resizeStartSize.width + deltaX),
          );
        }
        if (resizeDirection.includes('w')) {
          const widthChange = Math.min(
            resizeStartSize.width - minWidth,
            deltaX,
          );
          newWidth = Math.max(
            minWidth,
            Math.min(effectiveMaxWidth, resizeStartSize.width - deltaX),
          );
          newX = resizeStartPos.x + widthChange;
        }
        if (resizeDirection.includes('s')) {
          newHeight = Math.max(
            minHeight,
            Math.min(effectiveMaxHeight, resizeStartSize.height + deltaY),
          );
        }
        if (resizeDirection.includes('n')) {
          const heightChange = Math.min(
            resizeStartSize.height - minHeight,
            deltaY,
          );
          newHeight = Math.max(
            minHeight,
            Math.min(effectiveMaxHeight, resizeStartSize.height - deltaY),
          );
          newY = resizeStartPos.y + heightChange;
        }

        // 确保面板在视口内
        newX = Math.max(0, Math.min(newX, vw - newWidth));
        newY = Math.max(0, Math.min(newY, vh - newHeight));

        onPositionChange?.({ x: newX, y: newY });
        onSizeChange?.({ width: newWidth, height: newHeight });
      }
    },
    [
      isDragging,
      isResizing,
      isFloating,
      position,
      dragOffset,
      size,
      resizeDirection,
      resizeStartPos,
      resizeStartSize,
      minWidth,
      minHeight,
      maxWidth,
      maxHeight,
      onPositionChange,
      onSizeChange,
    ],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(false);
    setResizeDirection(null);
  }, []);

  const startResize = (e: React.MouseEvent, direction: string) => {
    if (!isFloating) return;

    e.preventDefault();
    e.stopPropagation();

    setIsResizing(true);
    setResizeDirection(direction);
    setResizeStartPos({ x: e.clientX, y: e.clientY });
    setResizeStartSize({ width: size.width, height: size.height });
  };

  useEffect(() => {
    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, handleMouseMove, handleMouseUp]);

  if (!isOpen) return null;

  // 计算样式，确保不超出视口
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const effectiveWidth = Math.min(size.width, vw - 40);
  const effectiveHeight = Math.min(size.height, vh - 40);

  const panelStyle =
    isFloating && position
      ? {
          left: Math.min(position.x, vw - effectiveWidth - 20),
          top: Math.min(position.y, vh - effectiveHeight - 20),
          width: effectiveWidth,
          height: effectiveHeight,
        }
      : {
          ...fixedPosition,
          width: effectiveWidth,
          height: effectiveHeight,
        };

  // 头部操作按钮
  const headerActions = (
    <div
      className="flex items-center gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={toggleMode}
        className="h-6 w-6 p-0 hover:bg-accent/50"
        title={isFloating ? 'Pin panel' : 'Unpin panel'}
      >
        {isFloating ? (
          <Pin className="h-4 w-4" />
        ) : (
          <PinOff className="h-4 w-4" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClose}
        className="h-6 w-6 p-0 hover:bg-destructive/20 hover:text-destructive"
        title="Close"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );

  return (
    <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 50 }}>
      <div
        ref={dragRef}
        className={cn(
          'pointer-events-auto fixed transition-shadow duration-200',
          isDragging && 'cursor-grabbing shadow-2xl',
          isResizing && 'select-none',
          !isDragging && !isResizing && 'shadow-lg',
          className,
        )}
        style={panelStyle}
      >
        <GlassCard
          title={title}
          icon={Icon}
          className={cn(
            'h-full transition-all duration-200',
            isFloating && 'cursor-grab',
            isDragging && 'ring-2 ring-primary/50',
          )}
          headerActions={headerActions}
          blurIntensity="lg"
          opacity={0.9}
        >
          {/* 拖拽区域 */}
          {isFloating && (
            <div
              className="absolute top-0 left-0 right-12 h-10 cursor-grab z-20"
              onMouseDown={handleMouseDown}
            />
          )}

          {/* 内容 - GlassCard 内部已有 overflow-auto，这里只需要 padding */}
          <div className="p-3">{children}</div>
        </GlassCard>

        {/* 调整大小手柄 - 仅浮动模式 */}
        {isFloating && (
          <>
            {/* 角落手柄 - 带视觉指示 */}
            <div
              className="absolute top-0 left-0 w-4 h-4 cursor-nw-resize z-30 group"
              onMouseDown={(e) => startResize(e, 'nw')}
            >
              <div className="absolute top-1 left-1 w-2 h-2 rounded-full bg-border/0 group-hover:bg-primary/50 transition-colors" />
            </div>
            <div
              className="absolute top-0 right-0 w-4 h-4 cursor-ne-resize z-30 group"
              onMouseDown={(e) => startResize(e, 'ne')}
            >
              <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-border/0 group-hover:bg-primary/50 transition-colors" />
            </div>
            <div
              className="absolute bottom-0 left-0 w-4 h-4 cursor-sw-resize z-30 group"
              onMouseDown={(e) => startResize(e, 'sw')}
            >
              <div className="absolute bottom-1 left-1 w-2 h-2 rounded-full bg-border/0 group-hover:bg-primary/50 transition-colors" />
            </div>
            <div
              className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-30 group"
              onMouseDown={(e) => startResize(e, 'se')}
            >
              <div className="absolute bottom-1 right-1 w-2 h-2 rounded-full bg-border/0 group-hover:bg-primary/50 transition-colors" />
            </div>
            {/* 边缘手柄 */}
            <div
              className="absolute top-0 left-4 right-4 h-2 cursor-n-resize z-30 hover:bg-primary/10 transition-colors"
              onMouseDown={(e) => startResize(e, 'n')}
            />
            <div
              className="absolute bottom-0 left-4 right-4 h-2 cursor-s-resize z-30 hover:bg-primary/10 transition-colors"
              onMouseDown={(e) => startResize(e, 's')}
            />
            <div
              className="absolute left-0 top-4 bottom-4 w-2 cursor-w-resize z-30 hover:bg-primary/10 transition-colors"
              onMouseDown={(e) => startResize(e, 'w')}
            />
            <div
              className="absolute right-0 top-4 bottom-4 w-2 cursor-e-resize z-30 hover:bg-primary/10 transition-colors"
              onMouseDown={(e) => startResize(e, 'e')}
            />
          </>
        )}
      </div>
    </div>
  );
}
