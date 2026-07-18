/**
 * 选择助手主面板
 * 包含三个可折叠区域：组选择、文本选择、目录选择
 * 顶部操作栏包含 Undo/Redo 和选择统计/操作按钮
 */

import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  ChevronDown,
  ChevronRight,
  Redo2,
  RotateCcw,
  ToggleLeft,
  Undo2,
} from 'lucide-react';
import { useCallback, useMemo } from 'react';
import {
  canRedoAtom,
  canUndoAtom,
  clearAllSelectionAtom,
  currentSelectionAtom,
  type ExpandedPanel,
  expandedPanelAtom,
  invertSelectionAtom,
  redoSelectionAtom,
  undoSelectionAtom,
} from '@/nodes/czkawka/upstream/atom/selection-assistant';
import { currentToolDataAtom } from '@/nodes/czkawka/upstream/atom/tools';
import { Button } from '@/components/ui/button';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import type { BaseEntry, RefEntry } from '@/nodes/czkawka/upstream/types';
import { cn } from '@/nodes/czkawka/upstream/utils/cn';
import { DirectorySelectionSection } from './directory-selection-section';
import { GroupSelectionSection } from './group-selection-section';
import { TextSelectionSection } from './text-selection-section';

interface AccordionItemProps {
  id: ExpandedPanel;
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

/** 可折叠区域组件 */
function AccordionItem({
  title,
  expanded,
  onToggle,
  children,
}: AccordionItemProps) {
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium hover:bg-accent/50 transition-colors"
        onClick={onToggle}
      >
        <span>{title}</span>
        {expanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
      </button>
      <div
        className={cn(
          'overflow-hidden transition-all duration-200',
          expanded ? 'opacity-100' : 'max-h-0 opacity-0',
        )}
      >
        <div className="px-3 pb-3">{children}</div>
      </div>
    </div>
  );
}

export function SelectionAssistantPanel() {
  const t = useT();
  const [expandedPanel, setExpandedPanel] = useAtom(expandedPanelAtom);
  const canUndo = useAtomValue(canUndoAtom);
  const canRedo = useAtomValue(canRedoAtom);
  const [, undo] = useAtom(undoSelectionAtom);
  const [, redo] = useAtom(redoSelectionAtom);

  // 选择统计和操作
  const currentSelection = useAtomValue(currentSelectionAtom);
  const currentToolData = useAtomValue(currentToolDataAtom);
  const clearAll = useSetAtom(clearAllSelectionAtom);
  const invert = useSetAtom(invertSelectionAtom);

  const selectedCount = useMemo(() => {
    return Object.keys(currentSelection).filter((k) => currentSelection[k])
      .length;
  }, [currentSelection]);

  const totalCount = currentToolData.length;

  const handleClearAll = useCallback(() => {
    clearAll();
  }, [clearAll]);

  const handleInvert = useCallback(() => {
    const data = currentToolData as (BaseEntry & Partial<RefEntry>)[];
    const allPaths = data.map((item) => item.path);
    invert(allPaths);
  }, [currentToolData, invert]);

  const handleToggle = useCallback(
    (panel: ExpandedPanel) => {
      setExpandedPanel((prev) => (prev === panel ? null : panel));
    },
    [setExpandedPanel],
  );

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* 顶部操作栏：Undo/Redo + 选择统计 + 清空/反选 - 随内容滚动 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border gap-2 flex-wrap">
        {/* 左侧：Undo/Redo */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!canUndo}
            onClick={() => undo()}
            title={t('Undo') + ' (Ctrl+Z)'}
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!canRedo}
            onClick={() => redo()}
            title={t('Redo') + ' (Ctrl+Y)'}
          >
            <Redo2 className="h-4 w-4" />
          </Button>
        </div>

        {/* 中间：选择统计 */}
        <span className="text-xs text-muted-foreground">
          {t('Selected')}: {selectedCount} / {totalCount}
        </span>

        {/* 右侧：清空/反选按钮 */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={selectedCount === 0}
            onClick={handleClearAll}
            title={t('Clear all')}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={totalCount === 0}
            onClick={handleInvert}
            title={t('Invert selection')}
          >
            <ToggleLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 可折叠区域 - 随内容滚动 */}
      <div className="flex-1">
        <AccordionItem
          id="group"
          title={t('Group Selection')}
          expanded={expandedPanel === 'group'}
          onToggle={() => handleToggle('group')}
        >
          <GroupSelectionSection />
        </AccordionItem>

        <AccordionItem
          id="text"
          title={t('Text Selection')}
          expanded={expandedPanel === 'text'}
          onToggle={() => handleToggle('text')}
        >
          <TextSelectionSection />
        </AccordionItem>

        <AccordionItem
          id="directory"
          title={t('Directory Selection')}
          expanded={expandedPanel === 'directory'}
          onToggle={() => handleToggle('directory')}
        >
          <DirectorySelectionSection />
        </AccordionItem>
      </div>
    </div>
  );
}
