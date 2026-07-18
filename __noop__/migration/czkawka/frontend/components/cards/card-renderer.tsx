/**
 * CardRenderer - 卡片渲染器组件
 * 根据卡片 ID 动态加载和渲染对应的卡片内容
 */

import { useAtomValue } from 'jotai';
import { LoaderCircle } from 'lucide-react';
import {
  type ComponentType,
  createContext,
  lazy,
  Suspense,
  useContext,
} from 'react';
import { getPanelCardsAtom } from '@/nodes/czkawka/upstream/atom/card-config';
import { cardRegistry } from '@/nodes/czkawka/upstream/lib/cards/registry';
import type { PanelId } from '@/nodes/czkawka/upstream/lib/cards/types';
import { GlassCard } from './glass-card';

// Context 用于传递 cardId 和 panelId
interface CardContextValue {
  cardId: string;
  panelId: PanelId;
}

const CardContext = createContext<CardContextValue | null>(null);

export function useCardContext() {
  const context = useContext(CardContext);
  if (!context) {
    throw new Error('useCardContext must be used within a CardRenderer');
  }
  return context;
}

// 懒加载组件映射
const lazyComponentMap: Record<
  string,
  () => Promise<{ default: ComponentType }>
> = {
  // 底栏卡片
  'tool-controls': () =>
    import('~/views/cards/tool-controls-card').then((m) => ({
      default: m.ToolControlsCard,
    })),
  'algorithm-settings': () =>
    import('~/views/cards/algorithm-settings-card').then((m) => ({
      default: m.AlgorithmSettingsCard,
    })),
  'included-dirs': () =>
    import('~/views/cards/included-dirs-card').then((m) => ({
      default: m.IncludedDirsCard,
    })),
  logs: () =>
    import('~/views/cards/logs-card').then((m) => ({ default: m.LogsCard })),

  // 图片预览卡片
  'image-preview': () =>
    import('~/views/cards/image-preview-card').then((m) => ({
      default: m.ImagePreviewCard,
    })),
  'image-info': () =>
    import('~/views/cards/image-info-card').then((m) => ({
      default: m.ImageInfoCard,
    })),

  // 视频预览卡片
  'video-preview': () =>
    import('~/views/cards/video-preview-card').then((m) => ({
      default: m.VideoPreviewCard,
    })),
  'video-info': () =>
    import('~/views/cards/video-info-card').then((m) => ({
      default: m.VideoInfoCard,
    })),

  // 选择助手卡片
  'group-selection': () =>
    import('~/views/cards/group-selection-card').then((m) => ({
      default: m.GroupSelectionCard,
    })),
  'text-selection': () =>
    import('~/views/cards/text-selection-card').then((m) => ({
      default: m.TextSelectionCard,
    })),
  'directory-selection': () =>
    import('~/views/cards/directory-selection-card').then((m) => ({
      default: m.DirectorySelectionCard,
    })),
  'sort-criteria': () =>
    import('~/views/cards/sort-criteria-card').then((m) => ({
      default: m.SortCriteriaCard,
    })),

  // 过滤器卡片
  'file-filter': () =>
    import('~/views/cards/file-filter-card').then((m) => ({
      default: m.FileFilterCard,
    })),
  'similarity-filter': () =>
    import('~/views/cards/similarity-filter-card').then((m) => ({
      default: m.SimilarityFilterCard,
    })),
  'quick-filter': () =>
    import('~/views/cards/quick-filter-card').then((m) => ({
      default: m.QuickFilterCard,
    })),

  // 图表分析卡片
  'format-donut-chart': () =>
    import('~/views/cards/format-donut-chart-card').then((m) => ({
      default: m.FormatDonutChartCard,
    })),
  'format-bar-chart': () =>
    import('~/views/cards/format-bar-chart-card').then((m) => ({
      default: m.FormatBarChartCard,
    })),
  'similarity-distribution': () =>
    import('~/views/cards/similarity-distribution-card').then((m) => ({
      default: m.SimilarityDistributionCard,
    })),

  // 设置卡片
  'card-panel-manager': () =>
    import('~/views/card-panel-manager').then((m) => ({
      default: m.CardPanelManager,
    })),
};

// 组件缓存
const componentCache = new Map<string, ComponentType>();

// 加载组件
async function loadComponent(id: string): Promise<ComponentType | null> {
  if (componentCache.has(id)) {
    return componentCache.get(id)!;
  }

  const loader = lazyComponentMap[id];
  if (!loader) return null;

  try {
    const module = await loader();
    componentCache.set(id, module.default);
    return module.default;
  } catch (err) {
    console.error(`加载卡片组件失败: ${id}`, err);
    return null;
  }
}

// 创建懒加载组件
function createLazyComponent(
  cardId: string,
): React.LazyExoticComponent<React.ComponentType> {
  return lazy(async (): Promise<{ default: React.ComponentType }> => {
    const Component = await loadComponent(cardId);
    if (!Component) {
      return { default: () => <CardError cardId={cardId} /> };
    }
    return { default: Component };
  });
}

// 加载状态组件
function CardLoading() {
  return (
    <div className="flex items-center justify-center py-4 text-muted-foreground text-xs">
      <LoaderCircle className="animate-spin h-4 w-4 mr-2" />
      加载中...
    </div>
  );
}

// 错误状态组件
function CardError({ cardId }: { cardId: string }) {
  return (
    <div className="py-2 text-xs text-destructive">卡片加载失败: {cardId}</div>
  );
}

interface CardRendererProps {
  cardId: string;
  panelId: PanelId;
}

export function CardRenderer({ cardId, panelId }: CardRendererProps) {
  const cardDef = cardRegistry[cardId];
  const panelCards = useAtomValue(getPanelCardsAtom(panelId));
  const cardConfig = panelCards.find((c) => c.id === cardId);

  // 如果卡片不可见，不渲染
  if (!cardConfig?.visible) return null;

  const LazyComponent = createLazyComponent(cardId);

  // 布局选项
  const hideHeader = cardDef?.hideHeader ?? false;
  const hideIcon = cardDef?.hideIcon ?? false;
  const hideTitle = cardDef?.hideTitle ?? false;
  const compact = cardDef?.compact ?? false;
  const fullHeight = cardDef?.fullHeight ?? false;

  return (
    <CardContext.Provider value={{ cardId, panelId }}>
      <GlassCard
        title={cardDef?.title || cardId}
        icon={cardDef?.icon}
        hideHeader={hideHeader}
        hideIcon={hideIcon}
        hideTitle={hideTitle}
        compact={compact}
        collapsible={!hideHeader}
        expanded={cardConfig?.expanded}
        className={fullHeight ? 'flex-1' : undefined}
      >
        <Suspense fallback={<CardLoading />}>
          <LazyComponent />
        </Suspense>
      </GlassCard>
    </CardContext.Provider>
  );
}

// 面板卡片列表渲染器
interface PanelCardsRendererProps {
  panelId: PanelId;
  className?: string;
}

export function PanelCardsRenderer({
  panelId,
  className,
}: PanelCardsRendererProps) {
  const panelCards = useAtomValue(getPanelCardsAtom(panelId));
  const visibleCards = panelCards
    .filter((c) => c.visible)
    .sort((a, b) => a.order - b.order);

  return (
    <div className={className}>
      {visibleCards.map((card) => (
        <CardRenderer key={card.id} cardId={card.id} panelId={panelId} />
      ))}
    </div>
  );
}
