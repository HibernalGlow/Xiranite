import type {
  Row,
  RowSelectionState,
  Table as TTable,
} from '@tanstack/react-table';
import { type RefObject, useCallback, useRef, useState } from 'react';

interface UseBoxSelectOptions<T> {
  containerRef: RefObject<HTMLDivElement | null>;
  rows: Row<T>[];
  rowHeight: number;
  table: TTable<T>;
}

const MIN_DRAG = 5;

export function useBoxSelect<T>(opts: UseBoxSelectOptions<T>) {
  const { containerRef, rows, rowHeight, table } = opts;

  const [isSelecting, setIsSelecting] = useState(false);
  const [box, setBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const start = useRef({ x: 0, y: 0, scrollTop: 0 });
  const dragging = useRef(false);
  const snapshot = useRef<RowSelectionState>({});
  const ctrl = useRef(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement;
      if (t.closest('button,input,a,[role="checkbox"],[data-no-box-select]'))
        return;

      const el = containerRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      start.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top + el.scrollTop,
        scrollTop: el.scrollTop,
      };
      dragging.current = false;
      ctrl.current = e.ctrlKey || e.metaKey;
      snapshot.current = { ...table.getState().rowSelection };

      const onMove = (me: MouseEvent) => {
        const rect = el.getBoundingClientRect();
        const cx = me.clientX - rect.left;
        // Current Y in content-space (accounting for scroll)
        const cy = me.clientY - rect.top + el.scrollTop;

        if (!dragging.current) {
          const dx = cx - start.current.x;
          const dy = cy - start.current.y;
          if (Math.sqrt(dx * dx + dy * dy) < MIN_DRAG) return;
          dragging.current = true;
          setIsSelecting(true);
        }

        // Content-space box
        const x1 = Math.max(0, Math.min(start.current.x, cx));
        const y1 = Math.min(start.current.y, cy);
        const x2 = Math.min(el.clientWidth, Math.max(start.current.x, cx));
        const y2 = Math.max(start.current.y, cy);

        // For visual rendering, convert back to viewport-relative (subtract current scrollTop)
        const visTop = y1 - el.scrollTop;
        const visHeight = y2 - y1;
        setBox({ left: x1, top: visTop, width: x2 - x1, height: visHeight });

        // Hit-test rows against content-space box
        const hitIds: string[] = [];
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const orig = row.original as { isRef?: boolean; hidden?: boolean };
          if (orig.isRef || orig.hidden) continue;
          const rowTop = i * rowHeight;
          const rowBot = rowTop + rowHeight;
          if (rowBot > y1 && rowTop < y2) hitIds.push(row.id);
        }

        let sel: RowSelectionState;
        if (ctrl.current) {
          sel = { ...snapshot.current };
          for (const id of hitIds) {
            if (snapshot.current[id]) delete sel[id];
            else sel[id] = true;
          }
        } else {
          sel = {};
          for (const id of hitIds) sel[id] = true;
        }
        table.setRowSelection(sel);
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        dragging.current = false;
        setIsSelecting(false);
        setBox(null);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [containerRef, table, rows, rowHeight],
  );

  const boxStyle: React.CSSProperties | null = box
    ? {
        position: 'absolute',
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        backgroundColor: 'rgba(59, 130, 246, 0.15)',
        border: '1px solid rgba(59, 130, 246, 0.5)',
        pointerEvents: 'none',
        zIndex: 50,
      }
    : null;

  return { onMouseDown, boxStyle, isSelecting };
}
