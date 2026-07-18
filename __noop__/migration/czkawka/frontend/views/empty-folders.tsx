import { useAtom, useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { settingsAtom } from '@/nodes/czkawka/upstream/atom/settings';
import {
  currentToolFilterAtom,
  currentToolFilteredDataAtom,
  currentToolRowSelectionAtom,
} from '@/nodes/czkawka/upstream/atom/tools';
import {
  createActionsColumn,
  createColumns,
  DataTable,
  FilterStateUpdater,
} from '@/nodes/czkawka/upstream/components/data-table';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import type { FolderEntry } from '@/nodes/czkawka/upstream/types';
import { formatPathDisplay } from '@/nodes/czkawka/upstream/utils/path-utils';

export function EmptyFolders() {
  const filteredData = useAtomValue(
    currentToolFilteredDataAtom,
  ) as FolderEntry[];
  const [rowSelection, setRowSelection] = useAtom(currentToolRowSelectionAtom);
  const [filter, setFilter] = useAtom(currentToolFilterAtom);
  const settings = useAtomValue(settingsAtom);
  const t = useT();

  const columns = createColumns<FolderEntry>([
    {
      accessorKey: 'folderName',
      header: t('Folder name'),
      size: 180,
      minSize: 100,
    },
    {
      accessorKey: 'path',
      header: t('Path'),
      size: 430,
      minSize: 100,
      cell: ({ row }) => {
        const displayPath = formatPathDisplay(
          row.original.path,
          settings.reversePathDisplay,
        );
        return <div className="truncate">{displayPath}</div>;
      },
    },
    {
      accessorKey: 'modifiedDate',
      header: t('Modified date'),
      size: 160,
      minSize: 120,
    },
    createActionsColumn(),
  ]);

  return (
    <DataTable
      className="flex-1 rounded-none border-none grow"
      data={filteredData}
      columns={columns}
      rowSelection={rowSelection}
      onRowSelectionChange={setRowSelection}
      globalFilter={filter}
      onGlobalFilterChange={(updater: FilterStateUpdater) => {
        const newValue =
          typeof updater === 'function' ? updater(filter) : updater;
        setFilter(newValue);
      }}
    />
  );
}
