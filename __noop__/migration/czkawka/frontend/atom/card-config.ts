/**
 * 卡片配置状态存储
 * 使用 Jotai atomWithStorage 实现持久化
 */
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { cardRegistry, getDefaultCardsForPanel } from '@/nodes/czkawka/upstream/lib/cards/registry';
import type { CardConfig, CardConfigState, PanelId } from '@/nodes/czkawka/upstream/lib/cards/types';

// 生成默认配置
function generateDefaultConfig(): CardConfigState {
  const configs: Record<PanelId, CardConfig[]> = {
    'bottom-bar': [],
    'image-preview': [],
    'video-preview': [],
    'selection-assistant': [],
    'filter-panel': [],
    'analysis-panel': [],
    settings: [],
  };

  // 从注册表生成默认配置
  Object.values(cardRegistry).forEach((def) => {
    const config: CardConfig = {
      id: def.id,
      panelId: def.defaultPanel,
      visible: true,
      expanded: true,
      order: configs[def.defaultPanel].length,
      title: def.title,
      canHide: def.canHide,
    };
    configs[def.defaultPanel].push(config);
  });

  return { configs };
}

// 默认配置
const defaultConfig = generateDefaultConfig();

// 持久化的卡片配置 atom
export const cardConfigAtom = atomWithStorage<CardConfigState>(
  'czkawka-card-config',
  defaultConfig,
);

// 获取指定面板的卡片列表
export const getPanelCardsAtom = (panelId: PanelId) =>
  atom((get) => {
    const state = get(cardConfigAtom);
    return state.configs[panelId] || [];
  });

// 设置卡片可见性
export const setCardVisibleAtom = atom(
  null,
  (
    get,
    set,
    params: { panelId: PanelId; cardId: string; visible: boolean },
  ) => {
    const { panelId, cardId, visible } = params;
    const state = get(cardConfigAtom);
    const cards = [...(state.configs[panelId] || [])];
    const index = cards.findIndex((c) => c.id === cardId);
    if (index !== -1) {
      cards[index] = { ...cards[index], visible };
      set(cardConfigAtom, {
        ...state,
        configs: { ...state.configs, [panelId]: cards },
      });
    }
  },
);

// 设置卡片展开状态
export const setCardExpandedAtom = atom(
  null,
  (
    get,
    set,
    params: { panelId: PanelId; cardId: string; expanded: boolean },
  ) => {
    const { panelId, cardId, expanded } = params;
    const state = get(cardConfigAtom);
    const cards = [...(state.configs[panelId] || [])];
    const index = cards.findIndex((c) => c.id === cardId);
    if (index !== -1) {
      cards[index] = { ...cards[index], expanded };
      set(cardConfigAtom, {
        ...state,
        configs: { ...state.configs, [panelId]: cards },
      });
    }
  },
);

// 设置卡片高度
export const setCardHeightAtom = atom(
  null,
  (
    get,
    set,
    params: { panelId: PanelId; cardId: string; height: number | undefined },
  ) => {
    const { panelId, cardId, height } = params;
    const state = get(cardConfigAtom);
    const cards = [...(state.configs[panelId] || [])];
    const index = cards.findIndex((c) => c.id === cardId);
    if (index !== -1) {
      cards[index] = { ...cards[index], height };
      set(cardConfigAtom, {
        ...state,
        configs: { ...state.configs, [panelId]: cards },
      });
    }
  },
);

// 移动卡片（在同一面板内调整顺序）
export const moveCardAtom = atom(
  null,
  (
    get,
    set,
    params: { panelId: PanelId; cardId: string; newOrder: number },
  ) => {
    const { panelId, cardId, newOrder } = params;
    const state = get(cardConfigAtom);
    const cards = [...(state.configs[panelId] || [])];
    const currentIndex = cards.findIndex((c) => c.id === cardId);

    if (currentIndex === -1 || newOrder < 0 || newOrder >= cards.length) return;

    // 移动卡片
    const [card] = cards.splice(currentIndex, 1);
    cards.splice(newOrder, 0, card);

    // 更新所有卡片的 order
    cards.forEach((c, i) => {
      c.order = i;
    });

    set(cardConfigAtom, {
      ...state,
      configs: { ...state.configs, [panelId]: cards },
    });
  },
);

// 移动卡片到不同面板
export const moveCardToPanelAtom = atom(
  null,
  (get, set, params: { cardId: string; targetPanelId: PanelId }) => {
    const { cardId, targetPanelId } = params;
    const state = get(cardConfigAtom);

    // 找到卡片当前所在面板
    let sourcePanelId: PanelId | null = null;
    let cardConfig: CardConfig | null = null;

    for (const [panelId, cards] of Object.entries(state.configs)) {
      const card = cards.find((c) => c.id === cardId);
      if (card) {
        sourcePanelId = panelId as PanelId;
        cardConfig = card;
        break;
      }
    }

    if (!sourcePanelId || !cardConfig || sourcePanelId === targetPanelId)
      return;

    // 从源面板移除
    const sourceCards = state.configs[sourcePanelId].filter(
      (c) => c.id !== cardId,
    );
    sourceCards.forEach((c, i) => {
      c.order = i;
    });

    // 添加到目标面板
    const targetCards = [...state.configs[targetPanelId]];
    const newCard: CardConfig = {
      ...cardConfig,
      panelId: targetPanelId,
      order: targetCards.length,
    };
    targetCards.push(newCard);

    set(cardConfigAtom, {
      ...state,
      configs: {
        ...state.configs,
        [sourcePanelId]: sourceCards,
        [targetPanelId]: targetCards,
      },
    });
  },
);

// 重置配置
export const resetCardConfigAtom = atom(null, (_get, set) => {
  set(cardConfigAtom, generateDefaultConfig());
});

// 批量重排序卡片（用于拖拽排序）
export const reorderCardsAtom = atom(
  null,
  (get, set, params: { panelId: PanelId; cardIds: string[] }) => {
    const { panelId, cardIds } = params;
    const state = get(cardConfigAtom);
    const cards = state.configs[panelId] || [];

    // 根据新顺序重排卡片
    const cardMap = new Map(cards.map((c) => [c.id, c]));
    const reorderedCards = cardIds
      .map((id) => cardMap.get(id))
      .filter((c): c is CardConfig => c !== undefined)
      .map((c, i) => ({ ...c, order: i }));

    set(cardConfigAtom, {
      ...state,
      configs: { ...state.configs, [panelId]: reorderedCards },
    });
  },
);

// 辅助函数：获取面板卡片
export function usePanelCards(panelId: PanelId) {
  return getPanelCardsAtom(panelId);
}
