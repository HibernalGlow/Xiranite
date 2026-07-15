import { atom } from 'jotai';
import type { CustomThemeConfig, FolderStat } from '@/nodes/czkawka/upstream/types';

// ====== Local Features (Isolated for easier upstream sync) ======

// 相似图片文件夹统计数据
export const similarImagesFoldersAtom = atom<FolderStat[]>([]);

// 侧边栏图片预览状态
export const sidebarImagePreviewAtom = atom<{
  isOpen: boolean;
  imagePath: string | null;
  mode: 'floating' | 'fixed';
  position: { x: number; y: number } | null;
  size: { width: number; height: number };
}>({
  isOpen: false,
  imagePath: null,
  mode: 'fixed',
  position: null,
  size: { width: 320, height: 480 },
});

// 侧边栏视频预览状态
export const sidebarVideoPreviewAtom = atom<{
  isOpen: boolean;
  videoPath: string | null;
  mode: 'floating' | 'fixed';
  position: { x: number; y: number } | null;
  size: { width: number; height: number };
}>({
  isOpen: false,
  videoPath: null,
  mode: 'fixed',
  position: null,
  size: { width: 480, height: 320 },
});

// 筛选面板状态
export const filterPanelAtom = atom<{
  isOpen: boolean;
  mode: 'floating' | 'fixed';
  position: { x: number; y: number } | null;
  size: { width: number; height: number };
}>({
  isOpen: false,
  mode: 'fixed',
  position: null,
  size: { width: 400, height: 500 },
});

// 图表分析面板状态
export const analysisPanelAtom = atom<{
  isOpen: boolean;
  mode: 'floating' | 'fixed';
  position: { x: number; y: number } | null;
  size: { width: number; height: number };
}>({
  isOpen: false,
  mode: 'fixed',
  position: null,
  size: { width: 700, height: 500 },
});

// NOTE: selectedThemeAtom and customThemesAtom are defined in primitive.ts
// We keep these here for logical grouping with other local features
