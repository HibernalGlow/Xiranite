/**
 * 卡片系统类型定义
 * 定义所有面板类型、卡片配置和卡片定义接口
 */
import type { ComponentType } from 'react';

// 面板类型：底栏、图片预览、视频预览、选择助手、过滤器、图表分析、设置
export type PanelId =
  | 'bottom-bar'
  | 'image-preview'
  | 'video-preview'
  | 'selection-assistant'
  | 'filter-panel'
  | 'analysis-panel'
  | 'settings';

// 卡片定义接口
export interface CardDefinition {
  id: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  defaultPanel: PanelId;
  canHide: boolean;
  // 布局选项
  fullHeight?: boolean;
  hideIcon?: boolean;
  hideTitle?: boolean;
  hideHeader?: boolean;
  compact?: boolean;
}

// 卡片配置接口（运行时状态）
export interface CardConfig {
  id: string;
  panelId: PanelId;
  visible: boolean;
  expanded: boolean;
  order: number;
  height?: number;
  title: string;
  canHide: boolean;
}

// 卡片配置状态
export interface CardConfigState {
  configs: Record<PanelId, CardConfig[]>;
}

// 悬浮面板状态
export interface FloatingPanelState {
  isOpen: boolean;
  mode: 'fixed' | 'floating';
  position: { x: number; y: number } | null;
  size: { width: number; height: number };
}

// 毛玻璃效果配置
export interface GlassEffectConfig {
  blurIntensity: 'sm' | 'md' | 'lg' | 'xl';
  opacity: number;
  gradientSize: number;
  gradientOpacity: number;
}

// 默认毛玻璃效果配置
export const DEFAULT_GLASS_CONFIG: GlassEffectConfig = {
  blurIntensity: 'lg',
  opacity: 0.85,
  gradientSize: 200,
  gradientOpacity: 0.15,
};

// 模糊强度映射
export const BLUR_INTENSITY_MAP: Record<
  GlassEffectConfig['blurIntensity'],
  string
> = {
  sm: 'backdrop-blur-sm',
  md: 'backdrop-blur-md',
  lg: 'backdrop-blur-lg',
  xl: 'backdrop-blur-xl',
};
