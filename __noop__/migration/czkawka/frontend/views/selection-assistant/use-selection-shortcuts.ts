/**
 * 选择助手键盘快捷键 Hook
 * 实现 Ctrl+Z 撤销和 Ctrl+Y 重做
 */

import { useAtom, useAtomValue } from 'jotai';
import { useEffect } from 'react';
import {
  canRedoAtom,
  canUndoAtom,
  redoSelectionAtom,
  selectionAssistantPanelAtom,
  undoSelectionAtom,
} from '@/nodes/czkawka/upstream/atom/selection-assistant';

export function useSelectionShortcuts() {
  const [panelState] = useAtom(selectionAssistantPanelAtom);
  const canUndo = useAtomValue(canUndoAtom);
  const canRedo = useAtomValue(canRedoAtom);
  const [, undo] = useAtom(undoSelectionAtom);
  const [, redo] = useAtom(redoSelectionAtom);

  useEffect(() => {
    // 只在面板打开时启用快捷键
    if (!panelState.isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // 忽略输入框中的快捷键
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      // Ctrl+Z 撤销
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (canUndo) {
          undo();
        }
        return;
      }

      // Ctrl+Y 或 Ctrl+Shift+Z 重做
      if (
        (e.ctrlKey && e.key === 'y') ||
        (e.ctrlKey && e.shiftKey && e.key === 'z')
      ) {
        e.preventDefault();
        if (canRedo) {
          redo();
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [panelState.isOpen, canUndo, canRedo, undo, redo]);
}
