import type {
  ColumnDef,
  SortingState,
  Table as TTable,
} from '@tanstack/react-table';
import { invoke } from '@/nodes/czkawka/upstream/adapters/tauri-core';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { ExternalLink } from 'lucide-react';
import { useMemo, useState } from 'react';
import { sidebarVideoPreviewAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { settingsAtom } from '@/nodes/czkawka/upstream/atom/settings';
import {
  currentToolFilterAtom,
  currentToolFilteredDataAtom,
  currentToolRowSelectionAtom,
} from '@/nodes/czkawka/upstream/atom/tools';
import {
  DataTable,
  FilterStateUpdater,
  TableActions,
  TableRowSelectionCell,
  TableRowSelectionHeader,
} from '@/nodes/czkawka/upstream/components/data-table';
import { DynamicPreviewCell } from '@/nodes/czkawka/upstream/components/dynamic-preview-cell';
import { GroupedRightClickMenu } from '@/nodes/czkawka/upstream/components/right-click-menu';
import { toastError } from '@/nodes/czkawka/upstream/components/toast';
import { TooltipButton } from '@/nodes/czkawka/upstream/components/tooltip-button';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import type { VideosEntry } from '@/nodes/czkawka/upstream/types';
import { formatPathDisplay } from '@/nodes/czkawka/upstream/utils/path-utils';
import { processDataWithGroups, sortGroupedData } from '@/nodes/czkawka/upstream/utils/table-helper';
import { ClickableVideoPreview } from './clickable-video-preview';

export function SimilarVideos() {
  const filteredData = useAtomValue(
    currentToolFilteredDataAtom,
  ) as VideosEntry[];
  const [rowSelection, setRowSelection] = useAtom(currentToolRowSelectionAtom);
  const [filter, setFilter] = useAtom(currentToolFilterAtom);
  const settings = useAtomValue(settingsAtom);
  const setSidebarVideoPreview = useSetAtom(sidebarVideoPreviewAtom);
  const t = useT();

  const [thumbnailColumnWidth, setThumbnailColumnWidth] = useState(80);
  const [sorting, setSorting] = useState<SortingState>([]);

  // Calculate dynamic row height based on thumbnail size
  const dynamicRowHeight = useMemo(() => {
    if (!(settings.similarVideosEnableThumbnails ?? true)) {
      return 36;
    }
    const thumbnailSize = Math.max(20, Math.min(thumbnailColumnWidth - 8, 200));
    return Math.max(36, thumbnailSize + 16);
  }, [settings.similarVideosEnableThumbnails, thumbnailColumnWidth]);

  // Handle opening video in floating preview panel
  const handleVideoClick = (path: string) => {
    setSidebarVideoPreview((prev) => ({
      ...prev,
      isOpen: true,
      videoPath: path,
    }));
  };

  // Handle opening video in system player
  const handleOpenInSystemPlayer = (path: string) => {
    invoke('open_system_path', { path }).catch((e) => {
      console.error('Failed to open video in system player', path, e);
      toastError(t('Opreation failed'), e);
    });
  };

  // Debug: Check if thumbnail column should be rendered
  console.log(
    '[SimilarVideos] similarVideosEnableThumbnails:',
    settings.similarVideosEnableThumbnails,
  );

  // Process groups then apply group-safe sort
  const processedData = useMemo(
    () => processDataWithGroups(filteredData),
    [filteredData],
  );
  const sortedData = useMemo(
    () => sortGroupedData(processedData, sorting),
    [processedData, sorting],
  );

  const columns: ColumnDef<VideosEntry>[] = [
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
        if (row.original.isRef) {
          return null;
        }
        return <TableRowSelectionCell row={row} />;
      },
    },
    ...((settings.similarVideosEnableThumbnails ?? true)
      ? [
          {
            id: 'thumbnail',
            header: t('Thumbnail'),
            size: 80,
            minSize: 60,
            maxSize: 120,
            cell: ({ row }: { row: any }) => {
              if (row.original.hidden) {
                return null;
              }
              return (
                <DynamicPreviewCell
                  path={row.original.path}
                  enableLazyLoad={false}
                  onSizeChange={setThumbnailColumnWidth}
                  onVideoClick={() => handleVideoClick(row.original.path)}
                />
              );
            },
          },
        ]
      : []),
    {
      accessorKey: 'size',
      header: t('Size'),
      size: 110,
      minSize: 50,
    },
    {
      accessorKey: 'groupSize',
      header: t('Group Size'),
      size: 60,
      minSize: 40,
      cell: ({ row }) => {
        return (row.original as any).groupSize;
      },
    },
    {
      accessorKey: 'fileName',
      header: t('File name'),
      size: 180,
      minSize: 100,
      cell: ({ row }) => {
        if (row.original.hidden) return null;
        const { path, fileName } = row.original;
        return (
          <div
            className="truncate cursor-pointer hover:bg-accent/20 rounded px-1 py-0.5 transition-colors"
            onClick={() => handleVideoClick(path)}
          >
            {fileName}
          </div>
        );
      },
    },
    {
      accessorKey: 'path',
      header: t('Path'),
      size: 320,
      minSize: 100,
      cell: ({ row }) => {
        if (row.original.hidden) {
          return null;
        }
        const displayPath = formatPathDisplay(
          row.original.path,
          settings.reversePathDisplay,
        );
        return (
          <div
            className="truncate cursor-pointer hover:bg-accent/20 rounded px-1 py-0.5 transition-colors"
            onClick={() => handleVideoClick(row.original.path)}
          >
            {displayPath}
          </div>
        );
      },
    },
    {
      accessorKey: 'modifiedDate',
      header: t('Modified date'),
      size: 160,
      minSize: 120,
    },
    {
      id: 'actions',
      size: 90,
      minSize: 90,
      cell: ({ cell }) => {
        if (cell.row.original.isRef) {
          return null;
        }
        return (
          <div className="flex items-center gap-1">
            <TooltipButton
              tooltip={t('Open in system player')}
              onClick={() => handleOpenInSystemPlayer(cell.row.original.path)}
            >
              <ExternalLink className="w-4 h-4" />
            </TooltipButton>
            <TableActions path={cell.row.original.path} />
          </div>
        );
      },
    },
  ];

  return (
    <DataTable
      className="flex-1 rounded-none border-none grow"
      data={sortedData}
      columns={columns}
      rowSelection={rowSelection}
      onRowSelectionChange={setRowSelection}
      rowHeight={dynamicRowHeight}
      enableSorting={true}
      sorting={sorting}
      onSortingChange={setSorting}
      globalFilter={filter}
      onGlobalFilterChange={(updater: FilterStateUpdater) => {
        const newValue =
          typeof updater === 'function' ? updater(filter) : updater;
        setFilter(newValue);
      }}
      onRowContextMenu={(row, table) => (
        <GroupedRightClickMenu row={row} table={table as TTable<any>} />
      )}
    />
  );
}
