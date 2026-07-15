/**
 * useFilterShortcuts - 过滤器快捷键 Hook
 * 提供键盘快捷键支持
 */

import { useSetAtom } from 'jotai';
import { useCallback, useEffect } from 'react';
import { filterPanelExpandedAtom, filterStateAtom } from '@/nodes/czkawka/upstream/atom/filter-panel';
import { defaultFilterState } from '@/nodes/czkawka/upstream/lib/filter-panel/presets';

interface UseFilterShortcutsOptions {
  /** 是否启用快捷键 */
  enabled?: boolean;
  /** 过滤面板容器引用 */
  containerRef?: React.RefObject<HTMLElement>;
}

export function useFilterShortcuts(options: UseFilterShortcutsOptions = {}) {
  const { enabled = true, containerRef } = options;
  const setFilterState = useSetAtom(filterStateAtom);
  const setFilterPanelExpanded = useSetAtom(filterPanelExpandedAtom);

  // 清除所有过滤器
  const clearFilters = useCallback(() => {
    setFilterState(defaultFilterState);
  }, [setFilterState]);

  // 刷新过滤器
  const refreshFilters = useCallback(() => {
    setFilterState((prev) => ({ ...prev }));
  }, [setFilterState]);

  // 切换面板展开状态
  const togglePanel = useCallback(() => {
    setFilterPanelExpanded((prev) => !prev);
  }, [setFilterPanelExpanded]);

  // 聚焦过滤面板
  const focusPanel = useCallback(() => {
    if (containerRef?.current) {
      containerRef.current.focus();
    }
    setFilterPanelExpanded(true);
  }, [containerRef, setFilterPanelExpanded]);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // 忽略输入框中的按键
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        // 只处理 Escape 键
        if (event.key === 'Escape') {
          clearFilters();
          event.preventDefault();
        }
        return;
      }

      // Ctrl+F / Cmd+F: 聚焦过滤面板
      if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
        focusPanel();
        event.preventDefault();
        return;
      }

      // Escape: 清除所有过滤器
      if (event.key === 'Escape') {
        clearFilters();
        event.preventDefault();
        return;
      }

      // Ctrl+R / Cmd+R: 刷新过滤器（阻止浏览器刷新）
      if ((event.ctrlKey || event.metaKey) && event.key === 'r') {
        refreshFilters();
        event.preventDefault();
        return;
      }

      // Ctrl+Shift+F: 切换面板展开
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key === 'F'
      ) {
        togglePanel();
        event.preventDefault();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, clearFilters, refreshFilters, focusPanel, togglePanel]);

  return {
    clearFilters,
    refreshFilters,
    togglePanel,
    focusPanel,
  };
}
