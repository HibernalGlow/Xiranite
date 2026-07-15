/**
 * 选择助手 Jotai Atoms
 * 使用 jotai-history 实现撤销/重做功能
 * 使用 atomWithStorage 实现配置持久化
 */

import type { RowSelectionState } from '@tanstack/react-table';
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { REDO, RESET, UNDO, withHistory } from 'jotai-history';
import { currentToolRowSelectionAtom } from '@/nodes/czkawka/upstream/atom/tools';
import type {
  DirectoryRuleConfig,
  ExportConfig,
  GroupRuleConfig,
  TextRuleConfig,
} from '@/nodes/czkawka/upstream/lib/selection-assistant/types';

// ============ 默认配置 ============

/** 默认组选择规则配置 */
export const defaultGroupRuleConfig: GroupRuleConfig = {
  mode: 'selectAllExceptOne',
  sortCriteria: [
    {
      field: 'modifiedDate',
      direction: 'desc',
      preferEmpty: false,
      enabled: true,
    },
  ],
  keepExistingSelection: false,
};

/** 默认文本选择规则配置 */
export const defaultTextRuleConfig: TextRuleConfig = {
  column: 'fullPath',
  condition: 'contains',
  pattern: '',
  useRegex: false,
  caseSensitive: false,
  matchWholeColumn: false,
  keepExistingSelection: false,
};

/** 默认目录选择规则配置 */
export const defaultDirectoryRuleConfig: DirectoryRuleConfig = {
  mode: 'keepOnePerDirectory',
  directories: [],
  keepExistingSelection: false,
};

// ============ 配置持久化 Atoms ============

/** 组选择规则配置（持久化） */
export const groupRuleConfigAtom = atomWithStorage<GroupRuleConfig>(
  'selection-assistant-group-config',
  defaultGroupRuleConfig,
  undefined,
  { getOnInit: true },
);

/** 文本选择规则配置（持久化） */
export const textRuleConfigAtom = atomWithStorage<TextRuleConfig>(
  'selection-assistant-text-config',
  defaultTextRuleConfig,
  undefined,
  { getOnInit: true },
);

/** 目录选择规则配置（持久化） */
export const directoryRuleConfigAtom = atomWithStorage<DirectoryRuleConfig>(
  'selection-assistant-directory-config',
  defaultDirectoryRuleConfig,
  undefined,
  { getOnInit: true },
);

// ============ UI 状态 Atoms ============

/** 展开的面板（accordion 风格） */
export type ExpandedPanel = 'group' | 'text' | 'directory' | null;

export const expandedPanelAtom = atomWithStorage<ExpandedPanel>(
  'selection-assistant-expanded-panel',
  'group',
  undefined,
  { getOnInit: true },
);

/** 选择助手面板是否可见 */
export const selectionAssistantVisibleAtom = atomWithStorage<boolean>(
  'selection-assistant-visible',
  false,
  undefined,
  { getOnInit: true },
);

/** 选择助手面板状态 */
export interface SelectionAssistantPanelState {
  isOpen: boolean;
  mode: 'fixed' | 'floating';
  position: { x: number; y: number } | null;
  size: { width: number; height: number };
}

const defaultPanelState: SelectionAssistantPanelState = {
  isOpen: false,
  mode: 'fixed',
  position: null,
  size: { width: 360, height: 520 },
};

export const selectionAssistantPanelAtom =
  atomWithStorage<SelectionAssistantPanelState>(
    'selection-assistant-panel',
    defaultPanelState,
    undefined,
    { getOnInit: true },
  );

// ============ 选择状态历史管理 ============

/** 历史记录限制 */
const HISTORY_LIMIT = 50;

/**
 * 基础选择状态 atom
 * 直接使用表格的选择状态，确保同步
 */
export const baseSelectionAtom = atom(
  (get) => get(currentToolRowSelectionAtom),
  (_get, set, newSelection: RowSelectionState) => {
    set(currentToolRowSelectionAtom, newSelection);
  },
);

/** 带历史记录的选择状态 atom */
export const selectionHistoryAtom = withHistory(
  baseSelectionAtom,
  HISTORY_LIMIT,
);

// ============ 派生 Atoms ============

/** 当前选择状态（从历史中获取） */
export const currentSelectionAtom = atom(
  (get) => {
    // 直接从表格获取当前选择状态
    return get(currentToolRowSelectionAtom);
  },
  (_get, set, newSelection: RowSelectionState) => {
    set(currentToolRowSelectionAtom, newSelection);
  },
);

/** 是否可以撤销 */
export const canUndoAtom = atom((get) => {
  const history = get(selectionHistoryAtom);
  return history.canUndo ?? false;
});

/** 是否可以重做 */
export const canRedoAtom = atom((get) => {
  const history = get(selectionHistoryAtom);
  return history.canRedo ?? false;
});

// ============ 操作 Atoms ============

/** 撤销操作 */
export const undoSelectionAtom = atom(null, (_get, set) => {
  set(selectionHistoryAtom, UNDO);
});

/** 重做操作 */
export const redoSelectionAtom = atom(null, (_get, set) => {
  set(selectionHistoryAtom, REDO);
});

/** 重置历史 */
export const resetHistoryAtom = atom(null, (_get, set) => {
  set(selectionHistoryAtom, RESET);
});

/** 清空所有选择 */
export const clearAllSelectionAtom = atom(null, (_get, set) => {
  set(currentToolRowSelectionAtom, {});
});

/** 反选操作 */
export const invertSelectionAtom = atom(
  null,
  (get, set, allPaths: string[]) => {
    const current = get(currentSelectionAtom);
    const newSelection: RowSelectionState = {};

    for (const path of allPaths) {
      if (!current[path]) {
        newSelection[path] = true;
      }
    }

    set(currentToolRowSelectionAtom, newSelection);
  },
);

// ============ 导出 Action Symbols ============

export { UNDO, REDO, RESET };
