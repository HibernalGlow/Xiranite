/**
 * GlassCard - 毛玻璃效果卡片组件
 * 集成 MagicCard 提供鼠标跟随光效
 * 支持可折叠内容区域
 */

import { ChevronDown } from 'lucide-react';
import { type ComponentType, type ReactNode, useState } from 'react';
import { MagicCard } from '@/nodes/czkawka/upstream/components/magicui/magic-card';
import {
  BLUR_INTENSITY_MAP,
  DEFAULT_GLASS_CONFIG,
  type GlassEffectConfig,
} from '@/nodes/czkawka/upstream/lib/cards/types';
import { cn } from '@/nodes/czkawka/upstream/utils/cn';

export interface GlassCardProps {
  // 基础属性
  title?: string;
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
  className?: string;

  // 毛玻璃效果配置
  blurIntensity?: GlassEffectConfig['blurIntensity'];
  opacity?: number;

  // MagicCard 配置
  gradientSize?: number;
  gradientOpacity?: number;

  // 可折叠配置
  collapsible?: boolean;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;

  // 头部配置
  hideHeader?: boolean;
  hideIcon?: boolean;
  hideTitle?: boolean;
  compact?: boolean;

  // 操作按钮
  headerActions?: ReactNode;
}

export function GlassCard({
  title,
  icon: Icon,
  children,
  className,
  blurIntensity = DEFAULT_GLASS_CONFIG.blurIntensity,
  opacity = DEFAULT_GLASS_CONFIG.opacity,
  gradientSize = DEFAULT_GLASS_CONFIG.gradientSize,
  gradientOpacity = DEFAULT_GLASS_CONFIG.gradientOpacity,
  collapsible = false,
  defaultExpanded = true,
  expanded: controlledExpanded,
  onExpandedChange,
  hideHeader = false,
  hideIcon = false,
  hideTitle = false,
  compact = false,
  headerActions,
}: GlassCardProps) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);

  // 支持受控和非受控模式
  const isExpanded =
    controlledExpanded !== undefined ? controlledExpanded : internalExpanded;

  const handleToggleExpand = () => {
    const newExpanded = !isExpanded;
    if (controlledExpanded === undefined) {
      setInternalExpanded(newExpanded);
    }
    onExpandedChange?.(newExpanded);
  };

  const blurClass = BLUR_INTENSITY_MAP[blurIntensity];
  const bgOpacity = Math.round(opacity * 100);

  return (
    <MagicCard
      className={cn(
        'rounded-lg border border-border/50 overflow-hidden',
        blurClass,
        className,
      )}
      gradientSize={gradientSize}
      gradientOpacity={gradientOpacity}
    >
      <div
        className="h-full flex flex-col min-h-0"
        style={{
          backgroundColor: `hsl(var(--background) / ${bgOpacity}%)`,
        }}
      >
        {/* 头部 */}
        {!hideHeader && (title || Icon || headerActions) && (
          <div
            className={cn(
              'flex items-center justify-between border-b border-border/50',
              compact ? 'px-2 py-1' : 'px-3 py-2',
              collapsible && 'cursor-pointer select-none',
              'bg-muted/30',
            )}
            onClick={collapsible ? handleToggleExpand : undefined}
          >
            <div className="flex items-center gap-2 min-w-0">
              {!hideIcon && Icon && (
                <Icon
                  className={cn(
                    'flex-shrink-0',
                    compact ? 'h-3 w-3' : 'h-4 w-4',
                  )}
                />
              )}
              {!hideTitle && title && (
                <span
                  className={cn(
                    'font-medium truncate',
                    compact ? 'text-xs' : 'text-sm',
                  )}
                >
                  {title}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {headerActions}
              {collapsible && (
                <ChevronDown
                  className={cn(
                    'h-4 w-4 transition-transform duration-200',
                    !isExpanded && '-rotate-90',
                  )}
                />
              )}
            </div>
          </div>
        )}

        {/* 内容区域 - min-h-0 确保 flex 子元素可以正确收缩并滚动 */}
        <div
          className={cn(
            'flex-1 min-h-0 overflow-auto',
            collapsible && !isExpanded && 'hidden',
          )}
        >
          {children}
        </div>
      </div>
    </MagicCard>
  );
}
