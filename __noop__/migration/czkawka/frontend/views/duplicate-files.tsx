import type { ColumnDef, Row, SortingState } from '@tanstack/react-table';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useMemo, useState } from 'react';
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
import { DuplicateFilesRightClickMenu } from '@/nodes/czkawka/upstream/components/right-click-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import { useFormatFilteredData } from '@/nodes/czkawka/upstream/hooks/useFormatFilteredData';
import type { DuplicateEntry } from '@/nodes/czkawka/upstream/types';
import { isPreviewableFile } from '@/nodes/czkawka/upstream/utils/file-type-utils';
import { formatPathDisplay } from '@/nodes/czkawka/upstream/utils/path-utils';
import {
  filterItems,
  processDataWithGroups,
  sortGroupedData,
} from '@/nodes/czkawka/upstream/utils/table-helper';
import { ThumbnailPreloader } from '@/nodes/czkawka/upstream/utils/thumbnail-preloader';
import { ClickablePreview } from './clickable-preview';

export function DuplicateFiles() {
  const [thumbnailColumnWidth, setThumbnailColumnWidth] = useState(80);
  const data = useAtomValue(currentToolFilteredDataAtom) as DuplicateEntry[];
  const [rowSelection, setRowSelection] = useAtom(currentToolRowSelectionAtom);
  const [filter, setFilter] = useAtom(currentToolFilterAtom);
  const [sorting, setSorting] = useState<SortingState>([]);
  const settings = useAtomValue(settingsAtom);
  const setSidebarVideoPreview = useSetAtom(sidebarVideoPreviewAtom);
  const t = useT();

  // 根据缩略图列宽动态计算行高
  const dynamicRowHeight = useMemo(() => {
    if (!settings.similarImagesEnableThumbnails) {
      return 36; // 没有缩略图时的默认行高
    }
    // 缩略图大小计算：Math.max(20, Math.min(thumbnailColumnWidth - 8, 200))
    const thumbnailSize = Math.max(20, Math.min(thumbnailColumnWidth - 8, 200));
    // 行高 = 缩略图高度 + 上下padding (16px)
    return Math.max(36, thumbnailSize + 16);
  }, [settings.similarImagesEnableThumbnails, thumbnailColumnWidth]);

  // 启动缩略图预加载
  useEffect(() => {
    if (settings.similarImagesEnableThumbnails && data.length > 0) {
      const allImagePaths = data
        .filter((entry) => entry.isImage)
        .map((entry) => entry.path);
      const preloader = ThumbnailPreloader.getInstance();

      // 延迟启动预加载，避免影响初始渲染
      const timer = setTimeout(() => {
        preloader.startPreloading(allImagePaths);
      }, 1000);

      return () => {
        clearTimeout(timer);
        preloader.stop();
      };
    }
  }, [data, settings.similarImagesEnableThumbnails]);

  // 处理视频点击
  const handleVideoClick = (path: string) => {
    setSidebarVideoPreview((prev) => ({
      ...prev,
      isOpen: true,
      videoPath: path,
    }));
  };

  // 处理分组分隔和隐藏行
  const processedData = useMemo(() => {
    // data 已经是由 currentToolFilteredDataAtom 过滤后的
    const currentData = data;

    // 1. 清理掉空的组（即只有分隔符的组，这种情况在过滤后可能发生）
    const cleaned: typeof currentData = [];
    let tempGroup: typeof currentData = [];
    for (const item of currentData) {
      if (item.hidden) {
        if (tempGroup.length > 0) {
          cleaned.push(...tempGroup, item);
        }
        tempGroup = [];
      } else {
        tempGroup.push(item);
      }
    }
    if (tempGroup.length > 0) cleaned.push(...tempGroup);

    // 2. 应用组大小阈值
    const threshold = settings.duplicateGroupSizeThreshold || 1;
    let finalRawData = cleaned;

    if (threshold > 1) {
      const filteredByThreshold: typeof data = [];
      let currentGroup: typeof data = [];
      for (const item of cleaned) {
        if (item.hidden) {
          if (currentGroup.length >= threshold) {
            filteredByThreshold.push(...currentGroup, item);
          }
          currentGroup = [];
        } else {
          currentGroup.push(item);
        }
      }
      if (currentGroup.length >= threshold) {
        filteredByThreshold.push(...currentGroup);
      }
      finalRawData = filteredByThreshold;
    }

    let result = processDataWithGroups(finalRawData);

    // 应用组级排序
    result = sortGroupedData(result, sorting);

    return result;
  }, [data, filter, settings.duplicateGroupSizeThreshold, sorting]);

  const columns: ColumnDef<
    DuplicateEntry & {
      _isGroupEnd?: boolean;
      groupSize?: number;
      groupId?: number;
    }
  >[] = [
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
        if (row.original.hidden) return null;
        if (row.original.isRef) {
          return null;
        }
        return <TableRowSelectionCell row={row} />;
      },
    },
    ...(settings.similarImagesEnableThumbnails
      ? [
          {
            id: 'thumbnail',
            header: t('Thumbnail'),
            size: 80,
            minSize: 60,
            maxSize: 120,
            cell: ({ row }: { row: any }) => {
              if (row.original.hidden) return null;
              if (row.original.isRef) {
                return null;
              }
              const isPreviewable = isPreviewableFile(row.original.path);
              if (!isPreviewable) return null;

              return (
                <DynamicPreviewCell
                  path={row.original.path}
                  enableLazyLoad={true}
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
      cell: ({ row }) => {
        if (row.original.hidden) return null;
        const isGroupEnd = (row.original as any)._isGroupEnd;
        return (
          <div
            style={
              isGroupEnd ? { borderBottom: '2px solid #e5e7eb' } : undefined
            }
          >
            <ClickableCell row={row} value={row.original.size} />
          </div>
        );
      },
    },
    {
      accessorKey: 'groupSize',
      header: t('Group Size'),
      size: 60,
      minSize: 40,
      cell: ({ row }) => {
        if (row.original.hidden) return null;
        const isGroupEnd = (row.original as any)._isGroupEnd;
        return (
          <div
            style={
              isGroupEnd ? { borderBottom: '2px solid #e5e7eb' } : undefined
            }
          >
            {row.original.groupSize}
          </div>
        );
      },
    },
    {
      accessorKey: 'fileName',
      header: t('File name'),
      size: 180,
      minSize: 100,
      cell: ({ row }) => {
        if (row.original.hidden) return null;
        const isGroupEnd = (row.original as any)._isGroupEnd;
        return (
          <div
            style={
              isGroupEnd ? { borderBottom: '2px solid #e5e7eb' } : undefined
            }
          >
            <FileName row={row} />
          </div>
        );
      },
    },
    {
      id: 'groupSelect',
      header: t('Group Select'),
      size: 60,
      minSize: 40,
      cell: ({ row, table }) => {
        if (row.original.hidden || !row.original._isGroupEnd) return null;
        const groupId = row.original.groupId;
        const allRows = table.getRowModel().rows;
        const groupRows = allRows.filter(
          (r) =>
            r.original.groupId === groupId &&
            !r.original.isRef &&
            !r.original.hidden,
        );
        const isAllSelected = groupRows.every((r) => r.getIsSelected());
        const isSomeSelected = groupRows.some((r) => r.getIsSelected());
        return (
          <div className="flex justify-center items-center">
            <Checkbox
              checked={isAllSelected || (isSomeSelected && 'indeterminate')}
              onCheckedChange={(value) => {
                const newSelection = { ...table.getState().rowSelection };
                groupRows.forEach((r) => {
                  if (value) {
                    newSelection[r.id] = true;
                  } else {
                    delete newSelection[r.id];
                  }
                });
                table.setRowSelection(newSelection);
              }}
              aria-label="Select group"
              className="translate-y-[2px]"
            />
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
        if (row.original.hidden) return null;
        const isGroupEnd = (row.original as any)._isGroupEnd;
        return (
          <div
            style={
              isGroupEnd ? { borderBottom: '2px solid #e5e7eb' } : undefined
            }
          >
            <ClickablePath row={row} />
          </div>
        );
      },
    },
    {
      accessorKey: 'modifiedDate',
      header: t('Modified date'),
      size: 160,
      minSize: 120,
      cell: ({ row }) => {
        if (row.original.hidden) return null;
        return row.original.modifiedDate;
      },
    },
    {
      id: 'actions',
      size: 55,
      minSize: 55,
      cell: ({ cell }) => {
        if (cell.row.original.hidden) return null;
        if (cell.row.original.isRef) {
          return null;
        }
        return <TableActions path={cell.row.original.path} />;
      },
    },
  ];

  return (
    <DataTable
      className="flex-1 rounded-none border-none grow"
      data={processedData}
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
        <DuplicateFilesRightClickMenu row={row} table={table} />
      )}
    />
  );
}

function FileName(props: { row: Row<DuplicateEntry> }) {
  const { row } = props;
  const { hidden, path, fileName } = row.original;

  const settings = useAtomValue(settingsAtom);

  if (hidden) {
    return null;
  }

  const isPreviewable = isPreviewableFile(path);

  if (settings.duplicateImagePreview && isPreviewable) {
    return (
      <ClickablePreview path={path}>
        <div className="truncate cursor-pointer hover:bg-accent/20 rounded px-1 py-0.5 transition-colors">
          {fileName}
        </div>
      </ClickablePreview>
    );
  }

  return fileName;
}

function ClickablePath(props: { row: Row<DuplicateEntry> }) {
  const { row } = props;
  const { path } = row.original;
  const settings = useAtomValue(settingsAtom);

  // 根据设置格式化路径显示
  const displayPath = formatPathDisplay(path, settings.reversePathDisplay);
  const isPreviewable = isPreviewableFile(path);

  if (settings.duplicateImagePreview && isPreviewable) {
    return (
      <ClickablePreview path={path}>
        <div className="truncate cursor-pointer hover:bg-accent/20 rounded px-1 py-0.5 transition-colors">
          {displayPath}
        </div>
      </ClickablePreview>
    );
  }

  return <div className="truncate">{displayPath}</div>;
}

// 通用的可点击单元格组件
function ClickableCell(props: { row: Row<DuplicateEntry>; value: string }) {
  const { row, value } = props;
  const { path } = row.original;
  const settings = useAtomValue(settingsAtom);
  const isPreviewable = isPreviewableFile(path);

  if (settings.duplicateImagePreview && isPreviewable) {
    return (
      <ClickablePreview path={path}>
        <div className="cursor-pointer hover:bg-accent/20 rounded px-1 py-0.5 transition-colors">
          {value}
        </div>
      </ClickablePreview>
    );
  }

  return <div>{value}</div>;
}
