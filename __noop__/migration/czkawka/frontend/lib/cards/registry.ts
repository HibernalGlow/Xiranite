/**
 * 卡片注册表
 * 统一定义所有卡片的元数据，支持动态发现和跨面板移动
 */
import {
  ArrowUpDown,
  BarChart3,
  Filter,
  Folder,
  FolderTree,
  Image,
  Info,
  Layers,
  LayoutGrid,
  ListFilter,
  Percent,
  PieChart,
  ScrollText,
  Settings2,
  Sliders,
  Type,
  Video,
  Zap,
} from 'lucide-react';
import type { CardDefinition, PanelId } from './types';

// 所有卡片注册表
export const cardRegistry: Record<string, CardDefinition> = {
  // ==================== 底栏卡片 ====================
  'tool-controls': {
    id: 'tool-controls',
    title: 'Tool Controls',
    icon: Sliders,
    defaultPanel: 'bottom-bar',
    canHide: false,
  },
  'algorithm-settings': {
    id: 'algorithm-settings',
    title: 'Algorithm Settings',
    icon: Settings2,
    defaultPanel: 'bottom-bar',
    canHide: false,
  },
  'format-filter': {
    id: 'format-filter',
    title: 'Format Filter',
    icon: ListFilter,
    defaultPanel: 'bottom-bar',
    canHide: true,
  },
  'included-dirs': {
    id: 'included-dirs',
    title: 'Include Directories',
    icon: Folder,
    defaultPanel: 'bottom-bar',
    canHide: false,
  },
  logs: {
    id: 'logs',
    title: 'Logs',
    icon: ScrollText,
    defaultPanel: 'bottom-bar',
    canHide: true,
  },

  // ==================== 图片预览悬浮窗卡片 ====================
  'image-preview': {
    id: 'image-preview',
    title: 'Image Preview',
    icon: Image,
    defaultPanel: 'image-preview',
    canHide: false,
    fullHeight: true,
    hideHeader: true,
  },
  'image-info': {
    id: 'image-info',
    title: 'Image Info',
    icon: Info,
    defaultPanel: 'image-preview',
    canHide: true,
  },

  // ==================== 视频预览悬浮窗卡片 ====================
  'video-preview': {
    id: 'video-preview',
    title: 'Video Preview',
    icon: Video,
    defaultPanel: 'video-preview',
    canHide: false,
    fullHeight: true,
    hideHeader: true,
  },
  'video-info': {
    id: 'video-info',
    title: 'Video Info',
    icon: Info,
    defaultPanel: 'video-preview',
    canHide: true,
  },

  // ==================== 选择助手悬浮窗卡片 ====================
  'group-selection': {
    id: 'group-selection',
    title: 'Group Selection',
    icon: Layers,
    defaultPanel: 'selection-assistant',
    canHide: false,
  },
  'text-selection': {
    id: 'text-selection',
    title: 'Text Selection',
    icon: Type,
    defaultPanel: 'selection-assistant',
    canHide: false,
  },
  'directory-selection': {
    id: 'directory-selection',
    title: 'Directory Selection',
    icon: FolderTree,
    defaultPanel: 'selection-assistant',
    canHide: false,
  },
  'sort-criteria': {
    id: 'sort-criteria',
    title: 'Sort Criteria',
    icon: ArrowUpDown,
    defaultPanel: 'selection-assistant',
    canHide: true,
  },

  // ==================== 过滤器悬浮窗卡片 ====================
  'file-filter': {
    id: 'file-filter',
    title: 'File Filter',
    icon: Filter,
    defaultPanel: 'filter-panel',
    canHide: false,
    fullHeight: true,
  },
  'similarity-filter': {
    id: 'similarity-filter',
    title: 'Similarity Filter',
    icon: Percent,
    defaultPanel: 'filter-panel',
    canHide: true,
  },
  'quick-filter': {
    id: 'quick-filter',
    title: 'Quick Filter',
    icon: Zap,
    defaultPanel: 'filter-panel',
    canHide: true,
  },

  // ==================== 图表分析悬浮窗卡片 ====================
  'format-donut-chart': {
    id: 'format-donut-chart',
    title: 'Format Distribution',
    icon: PieChart,
    defaultPanel: 'analysis-panel',
    canHide: false,
  },
  'format-bar-chart': {
    id: 'format-bar-chart',
    title: 'Format Size Chart',
    icon: BarChart3,
    defaultPanel: 'analysis-panel',
    canHide: true,
  },
  'similarity-distribution': {
    id: 'similarity-distribution',
    title: 'Similarity Distribution',
    icon: BarChart3,
    defaultPanel: 'analysis-panel',
    canHide: true,
  },

  // ==================== 设置面板卡片 ====================
  'card-panel-manager': {
    id: 'card-panel-manager',
    title: 'Card Panel Manager',
    icon: LayoutGrid,
    defaultPanel: 'settings',
    canHide: false,
  },
};

// 获取面板的默认卡片列表
export function getDefaultCardsForPanel(panelId: PanelId): string[] {
  return Object.values(cardRegistry)
    .filter((card) => card.defaultPanel === panelId)
    .map((card) => card.id);
}

// 获取卡片定义
export function getCardDefinition(cardId: string): CardDefinition | undefined {
  return cardRegistry[cardId];
}

// 获取所有卡片 ID
export function getAllCardIds(): string[] {
  return Object.keys(cardRegistry);
}

// 获取所有面板 ID
export function getAllPanelIds(): PanelId[] {
  return [
    'bottom-bar',
    'image-preview',
    'video-preview',
    'selection-assistant',
    'filter-panel',
    'analysis-panel',
    'settings',
  ];
}

// 获取面板标题
export function getPanelTitle(panelId: PanelId): string {
  const titles: Record<PanelId, string> = {
    'bottom-bar': 'Bottom Bar',
    'image-preview': 'Image Preview',
    'video-preview': 'Video Preview',
    'selection-assistant': 'Selection Assistant',
    'filter-panel': 'Filter Panel',
    'analysis-panel': 'Analysis Panel',
    settings: 'Settings',
  };
  return titles[panelId] || panelId;
}
