/**
 * MagicCard - 鼠标跟随光效卡片组件
 * 参考 magicui 实现，提供鼠标悬停时的渐变光效
 */
import { type CSSProperties, type ReactNode, useRef, useState } from 'react';
import { cn } from '@/nodes/czkawka/upstream/utils/cn';

interface MagicCardProps {
  children: ReactNode;
  className?: string;
  gradientSize?: number;
  gradientColor?: string;
  gradientOpacity?: number;
}

export function MagicCard({
  children,
  className,
  gradientSize = 200,
  gradientColor = 'hsl(var(--primary))',
  gradientOpacity = 0.15,
}: MagicCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    setMousePosition({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const gradientStyle: CSSProperties = {
    background: isHovered
      ? `radial-gradient(${gradientSize}px circle at ${mousePosition.x}px ${mousePosition.y}px, ${gradientColor}, transparent)`
      : 'transparent',
    opacity: gradientOpacity,
  };

  return (
    <div
      ref={cardRef}
      className={cn('relative overflow-hidden', className)}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 光效层 */}
      <div
        className="pointer-events-none absolute inset-0 z-0 transition-opacity duration-300"
        style={gradientStyle}
      />
      {/* 内容层 - 使用 absolute inset-0 确保填满父容器 */}
      <div className="absolute inset-0 z-10">{children}</div>
    </div>
  );
}
