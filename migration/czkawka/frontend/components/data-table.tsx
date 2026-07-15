import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  type Row,
  type RowSelectionState,
  type SortingState,
  type Table as TTable,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { revealItemInDir } from '@/nodes/czkawka/upstream/adapters/tauri-opener';
import { ArrowDown, ArrowUp, ArrowUpDown, FolderOpen } from 'lucide-react';
import { useCallback, useRef } from 'react';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import { useBoxSelect } from '@/nodes/czkawka/upstream/hooks/use-box-select';
import type { BaseEntry } from '@/nodes/czkawka/upstream/types';
import { cn } from '@/nodes/czkawka/upstream/utils/cn';
import { Checkbox } from './shadcn/checkbox';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from './shadcn/context-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './shadcn/table';
import { toastError } from './toast';
import { TooltipButton } from './tooltip-button';

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  className?: string;
  emptyTip?: React.ReactNode;
  layout?: 'grid' | 'resizeable';
  rowSelection: RowSelectionState;
  onRowSelectionChange: (v: RowSelectionState) => void;
  rowHeight?: number; // 动态行高度
  enableSorting?: boolean;
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  onRowContextMenu?: (row: Row<T>, table: TTable<T>) => React.ReactNode;
  globalFilter?: string;
  onGlobalFilterChange?: (filter: string) => void;
  manualFiltering?: boolean;
}

export type RowSelection = RowSelectionState;
export type FilterStateUpdater = string | ((prev: string) => string);
export type RowSelectionUpdater =
  | RowSelectionState
  | ((prev: RowSelectionState) => RowSelectionState);
export type SortingStateUpdater =
  | SortingState
  | ((prev: SortingState) => SortingState);

export function DataTable<T extends BaseEntry>(props: DataTableProps<T>) {
  'use no memo';

  const {
    data,
    columns,
    className,
    emptyTip,
    layout = 'resizeable',
    rowSelection,
    onRowSelectionChange,
    rowHeight = 40, // 默认行高度
    enableSorting = false,
    sorting,
    onSortingChange,
    onRowContextMenu,
    globalFilter,
    onGlobalFilterChange,
    manualFiltering,
  } = props;

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.path,
    onRowSelectionChange: (updater) => {
      const newSelection =
        typeof updater === 'function' ? updater(rowSelection) : updater;
      onRowSelectionChange(newSelection);
    },
    enableRowSelection: (row) => {
      const original = row.original as { isRef?: boolean; hidden?: boolean };
      if (original.isRef || original.hidden) {
        return false;
      }
      return true;
    },
    state: {
      rowSelection,
      ...(sorting !== undefined && { sorting }),
      ...(globalFilter !== undefined && { globalFilter }),
    },
    columnResizeMode: 'onChange',
    enableSorting,
    ...(onSortingChange && {
      onSortingChange: (updater) => {
        const newSorting =
          typeof updater === 'function' ? updater(sorting || []) : updater;
        onSortingChange(newSorting);
      },
    }),
    getFilteredRowModel: getFilteredRowModel(),
    onGlobalFilterChange,
    manualFiltering,
    globalFilterFn: 'includesStringSensitive',
  });

  const isGrid = layout === 'grid';
  const isResizeable = layout === 'resizeable';

  return (
    <div
      className={cn(
        'h-full rounded-sm border overflow-x-auto overflow-y-hidden scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent scrollbar-thumb-rounded-full',
        className,
      )}
    >
      <Table
        className={cn('h-full', isResizeable && 'min-w-full')}
        style={{ width: isResizeable ? table.getTotalSize() : undefined }}
      >
        <TableHeader className="sticky top-0 z-10 bg-background shadow-sm">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow
              key={headerGroup.id}
              className={cn(
                isGrid && 'grid grid-cols-12',
                isResizeable && 'flex',
              )}
            >
              {headerGroup.headers.map((header) => {
                const span = header.column.columnDef.meta?.span;
                return (
                  <TableHead
                    key={header.id}
                    className={cn(
                      'relative flex items-center',
                      header.column.id === 'select' && 'justify-center',
                    )}
                    style={{
                      gridColumn:
                        isGrid && span
                          ? `span ${span} / span ${span}`
                          : undefined,
                      width: isResizeable ? header.getSize() : undefined,
                    }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                    {header.column.getCanSort() && (
                      <button
                        className="ml-2 h-4 w-4"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {header.column.getIsSorted() === 'asc' ? (
                          <ArrowUp className="h-4 w-4" />
                        ) : header.column.getIsSorted() === 'desc' ? (
                          <ArrowDown className="h-4 w-4" />
                        ) : (
                          <ArrowUpDown className="h-4 w-4" />
                        )}
                      </button>
                    )}
                    {isResizeable && (
                      <div
                        className="w-1 h-full border-border border-r hover:bg-primary cursor-col-resize absolute right-0"
                        onDoubleClick={() => header.column.resetSize()}
                        onMouseDown={header.getResizeHandler()}
                      />
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <DataTableBody
          table={table}
          emptyTip={emptyTip}
          layout={layout}
          rowHeight={rowHeight}
          onRowContextMenu={onRowContextMenu}
        />
      </Table>
    </div>
  );
}

interface TableBodyProps<T> {
  table: TTable<T>;
  emptyTip?: React.ReactNode;
  layout?: 'grid' | 'resizeable';
  rowHeight?: number; // 动态行高度
  onRowContextMenu?: (row: Row<T>, table: TTable<T>) => React.ReactNode;
}

function DataTableBody<T>(props: TableBodyProps<T>) {
  const { table, emptyTip, layout, rowHeight = 40, onRowContextMenu } = props;
  const { rows = [] } = table.getRowModel();

  const containerRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    estimateSize: () => rowHeight, // 紧密排列，不额外增加间距
    getScrollElement: () => containerRef.current,
    measureElement: (element) => element?.getBoundingClientRect().height,
    overscan: 5,
  });
  const t = useT();

  const isGrid = layout === 'grid';
  const isResizeable = layout === 'resizeable';

  // --- Shift/Ctrl click support ---
  const lastClickedIndex = useRef<number | null>(null);

  const handleRowClick = useCallback(
    (
      e: React.MouseEvent,
      row: import('@tanstack/react-table').Row<T>,
      rowIndex: number,
    ) => {
      const original = row.original as { isRef?: boolean; hidden?: boolean };
      if (original.isRef || original.hidden) return;

      // Only handle Shift or Ctrl clicks — let normal clicks through to checkboxes
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        lastClickedIndex.current = rowIndex;
        return;
      }

      e.preventDefault();

      if (e.ctrlKey || e.metaKey) {
        // Ctrl+Click: toggle this row
        const sel = { ...table.getState().rowSelection };
        if (sel[row.id]) {
          delete sel[row.id];
        } else {
          sel[row.id] = true;
        }
        table.setRowSelection(sel);
        lastClickedIndex.current = rowIndex;
      } else if (e.shiftKey) {
        // Shift+Click: range select from last clicked to current
        const start = lastClickedIndex.current ?? 0;
        const end = rowIndex;
        const lo = Math.min(start, end);
        const hi = Math.max(start, end);

        const sel = { ...table.getState().rowSelection };
        for (let i = lo; i <= hi; i++) {
          const r = rows[i];
          if (!r) continue;
          const orig = r.original as { isRef?: boolean; hidden?: boolean };
          if (orig.isRef || orig.hidden) continue;
          sel[r.id] = true;
        }
        table.setRowSelection(sel);
        // Don't update lastClickedIndex for shift-click
      }
    },
    [table, rows],
  );

  // --- Box select support ---
  const {
    onMouseDown: boxMouseDown,
    boxStyle,
    isSelecting,
  } = useBoxSelect({
    containerRef,
    rows,
    rowHeight,
    table,
  });

  return (
    <div
      ref={containerRef}
      className="overflow-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent scrollbar-thumb-rounded-full"
      style={{
        height: 'calc(100% - 41px)',
        position: 'relative',
        ...(isSelecting ? { userSelect: 'none' } : {}),
      }}
      onMouseDown={boxMouseDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {boxStyle && <div style={boxStyle} />}
      <TableBody
        className="relative"
        style={{
          height: rows.length ? rowVirtualizer.getTotalSize() : '100%',
        }}
      >
        {rows.length ? (
          rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            const tableRow = (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && 'selected'}
                data-index={virtualRow.index}
                ref={(node) => rowVirtualizer.measureElement(node)}
                className={cn(
                  'absolute w-full items-center',
                  isGrid && 'grid grid-cols-12',
                  isResizeable && 'flex',
                )}
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                  height: `${rowHeight}px`,
                  borderBottom: '1px solid hsl(var(--border))',
                  marginBottom: '0px',
                }}
                onClick={(e) => handleRowClick(e, row, virtualRow.index)}
              >
                {row.getVisibleCells().map((cell) => {
                  const span = cell.column.columnDef.meta?.span;
                  return (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        'truncate py-1',
                        cell.column.id !== 'select' && 'px-1',
                        cell.column.id === 'select' &&
                          'flex justify-center items-center',
                      )}
                      title={cell.getValue<any>()}
                      style={{
                        gridColumn:
                          isGrid && span
                            ? `span ${span} / span ${span}`
                            : undefined,
                        width: isResizeable ? cell.column.getSize() : undefined,
                      }}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            );

            if (onRowContextMenu) {
              return (
                <ContextMenu key={row.id}>
                  <ContextMenuTrigger asChild>{tableRow}</ContextMenuTrigger>
                  <ContextMenuContent>
                    {onRowContextMenu(row, table)}
                  </ContextMenuContent>
                </ContextMenu>
              );
            }

            return tableRow;
          })
        ) : (
          <TableRow className="h-full">
            <TableCell className="h-full flex justify-center items-center">
              {emptyTip || t('No data')}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </div>
  );
}

export function TableRowSelectionHeader<T>(props: { table: TTable<T> }) {
  'use no memo';

  const { table } = props;

  return (
    <Checkbox
      className="block mx-auto my-0 py-1"
      checked={
        table.getIsAllRowsSelected() ||
        (table.getIsSomeRowsSelected() && 'indeterminate')
      }
      onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
      aria-label="Select all"
    />
  );
}

export function TableRowSelectionCell<T>(props: { row: Row<T> }) {
  'use no memo';

  const { row } = props;

  return (
    <Checkbox
      checked={row.getIsSelected()}
      onCheckedChange={(value) => row.toggleSelected(!!value)}
      aria-label="Select row"
      className="translate-y-[2px]"
    />
  );
}

export function createColumns<T>(columns: ColumnDef<T>[]): ColumnDef<T>[] {
  return [
    {
      id: 'select',
      meta: {
        span: 1,
      },
      size: 40,
      minSize: 40,
      header: ({ table }) => {
        return <TableRowSelectionHeader table={table} />;
      },
      cell: ({ row }) => {
        return <TableRowSelectionCell row={row} />;
      },
    },
    ...columns,
  ];
}

export function TableActions(props: { path: string }) {
  const { path } = props;
  const t = useT();

  return (
    <TooltipButton
      tooltip={t('Reveal in dir', {
        name: PLATFORM === 'darwin' ? t('Finder') : t('File Explorer'),
      })}
      onClick={() =>
        revealItemInDir(path).catch((err) =>
          toastError(t('Opreation failed'), err),
        )
      }
    >
      <FolderOpen />
    </TooltipButton>
  );
}

export function createActionsColumn<
  T extends { path: string },
>(): ColumnDef<T> {
  return {
    id: 'actions',
    size: 55,
    minSize: 55,
    cell: ({ cell }) => {
      return <TableActions path={cell.row.original.path} />;
    },
  };
}
