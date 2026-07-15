/**
 * IncludedDirsCard - 包含目录卡片
 * 显示和管理包含的扫描目录
 */
import { open as openFileDialog } from '@/nodes/czkawka/upstream/adapters/tauri-dialog';
import { useAtom, useSetAtom } from 'jotai';
import {
  Folder,
  FolderMinus,
  FolderPen,
  FolderPlus,
  LoaderCircle,
  Star,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { includedDirsRowSelectionAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { settingsAtom } from '@/nodes/czkawka/upstream/atom/settings';
import { Button, Checkbox, Textarea, TooltipButton } from '@/nodes/czkawka/upstream/components';
import {
  createColumns,
  DataTable,
  type RowSelection,
} from '@/nodes/czkawka/upstream/components/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useBoolean, useT } from '@/nodes/czkawka/upstream/hooks';
import type { DirsType } from '@/nodes/czkawka/upstream/types';
import { cn } from '@/nodes/czkawka/upstream/utils/cn';
import { getRowSelectionKeys, splitStr } from '@/nodes/czkawka/upstream/utils/common';

interface TableData {
  path: string;
  field: DirsType;
  isReference?: boolean;
}

export function IncludedDirsCard() {
  const t = useT();
  const [settings, setSettings] = useAtom(settingsAtom);
  const [rowSelection, setRowSelection] = useAtom(includedDirsRowSelectionAtom);

  const data: TableData[] = useMemo(() => {
    return settings.includedDirectories.map((path) => ({
      path,
      field: 'includedDirectories',
      isReference: settings.includedDirectoriesReferenced.includes(path),
    }));
  }, [settings]);

  const allReferenceSelected =
    data.length > 0 && data.every((d) => d.isReference);

  const handleReferenceSelectAll = (checked: boolean) => {
    setSettings((old) => ({
      ...old,
      includedDirectoriesReferenced: checked ? data.map((d) => d.path) : [],
    }));
  };

  const handleReferenceToggle = (path: string) => {
    setSettings((old) => {
      const isCurrentlyReference =
        old.includedDirectoriesReferenced.includes(path);
      const newReferences = isCurrentlyReference
        ? old.includedDirectoriesReferenced.filter((p) => p !== path)
        : [...old.includedDirectoriesReferenced, path];
      return { ...old, includedDirectoriesReferenced: newReferences };
    });
  };

  const columns = createColumns<TableData>([
    {
      accessorKey: 'path',
      header: t('Path'),
      meta: { span: 9 },
    },
    {
      id: 'reference',
      header: () => (
        <div className="flex items-center justify-center gap-2">
          <Checkbox
            checked={allReferenceSelected}
            onCheckedChange={handleReferenceSelectAll}
            title="全选/取消全选参考路径"
            className="translate-y-[2px]"
          />
          <span className="text-xs text-muted-foreground font-normal whitespace-nowrap">
            {t('Reference')}
          </span>
        </div>
      ),
      meta: { span: 1 },
      cell: ({ row }) => (
        <div className="flex justify-center">
          <Button
            variant={row.original.isReference ? 'default' : 'ghost'}
            size="icon"
            className="h-6 w-6"
            onClick={() => handleReferenceToggle(row.original.path)}
            title={t('Use as reference')}
          >
            <Star
              className={cn(
                'h-4 w-4',
                row.original.isReference
                  ? 'text-yellow-500 fill-yellow-500'
                  : 'text-muted-foreground',
              )}
            />
          </Button>
        </div>
      ),
    },
    {
      id: 'actions',
      meta: { span: 1 },
      cell: ({ row, table }) => (
        <DirsRemoveButton {...row.original} table={table} />
      ),
    },
  ]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex justify-between items-center p-2 border-b border-border/50">
        <span className="text-xs text-muted-foreground">
          {data.length} directories
        </span>
        <DirsActions
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
          field="includedDirectories"
        />
      </div>
      <div className="flex-1 overflow-hidden">
        <DataTable
          className="h-full"
          data={data}
          columns={columns}
          emptyTip={t('Please add path')}
          layout="grid"
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
        />
      </div>
    </div>
  );
}

function DirsRemoveButton({ path, field, table }: TableData & { table: any }) {
  const setSettings = useSetAtom(settingsAtom);

  const handleRemovePath = () => {
    setSettings((settings) => ({
      ...settings,
      [field]: settings[field].filter((v: string) => v !== path),
    }));
    table.setRowSelection((old: RowSelection) =>
      Object.fromEntries(Object.entries(old).filter((obj) => obj[0] !== path)),
    );
  };

  return (
    <Button
      className="translate-x-[-8px]"
      variant="ghost"
      size="icon"
      onClick={handleRemovePath}
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

function DirsActions({
  field,
  rowSelection,
  onRowSelectionChange,
}: {
  field: DirsType;
  rowSelection: RowSelection;
  onRowSelectionChange: (v: RowSelection) => void;
}) {
  const t = useT();
  const setSettings = useSetAtom(settingsAtom);
  const manualAddDialogOpen = useBoolean();
  const [manualAddPaths, setManualAddPaths] = useState('');
  const openFileDialogLoading = useBoolean();

  const checkPathForReferenceKeywords = (
    path: string,
    keywords: string,
  ): boolean => {
    if (field !== 'includedDirectories') return false;
    const keywordList = splitStr(keywords);
    return keywordList.some((keyword) => keyword && path.includes(keyword));
  };

  const handleAddPath = async () => {
    openFileDialogLoading.on();
    const dirs = await openFileDialog({ multiple: true, directory: true });
    openFileDialogLoading.off();
    if (!dirs || dirs.length === 0) return;

    setSettings((settings) => {
      const currentDirs = settings[field];
      const newDirs = Array.isArray(dirs) ? dirs : [dirs];
      const uniqueDirs = newDirs.filter((dir) => !currentDirs.includes(dir));
      if (uniqueDirs.length === 0) return settings;

      if (field === 'includedDirectories') {
        const newReferenceDirs = [...settings.includedDirectoriesReferenced];
        for (const dir of uniqueDirs) {
          if (
            checkPathForReferenceKeywords(dir, settings.referencePathKeywords)
          ) {
            if (!newReferenceDirs.includes(dir)) newReferenceDirs.push(dir);
          }
        }
        return {
          ...settings,
          [field]: [...uniqueDirs, ...currentDirs],
          includedDirectoriesReferenced: newReferenceDirs,
        };
      }
      return { ...settings, [field]: [...uniqueDirs, ...currentDirs] };
    });
  };

  const handleRemovePaths = () => {
    const selected = new Set(getRowSelectionKeys(rowSelection));
    if (!selected.size) return;
    setSettings((settings) => ({
      ...settings,
      [field]: settings[field].filter((path: string) => !selected.has(path)),
    }));
    onRowSelectionChange({});
  };

  const handleClearAllPaths = () => {
    setSettings((settings) => {
      if (field === 'includedDirectories') {
        return { ...settings, [field]: [], includedDirectoriesReferenced: [] };
      }
      return { ...settings, [field]: [] };
    });
    onRowSelectionChange({});
  };

  const handleManualAddOk = () => {
    const paths = splitStr(manualAddPaths);
    setSettings((settings) => {
      if (field === 'includedDirectories') {
        const newReferenceDirs = [...settings.includedDirectoriesReferenced];
        for (const path of paths) {
          if (
            checkPathForReferenceKeywords(path, settings.referencePathKeywords)
          ) {
            if (!newReferenceDirs.includes(path)) newReferenceDirs.push(path);
          }
        }
        return {
          ...settings,
          [field]: Array.from(new Set([...paths, ...settings[field]])),
          includedDirectoriesReferenced: newReferenceDirs,
        };
      }
      return {
        ...settings,
        [field]: Array.from(new Set([...paths, ...settings[field]])),
      };
    });
    manualAddDialogOpen.off();
  };

  return (
    <div className="flex gap-1">
      <TooltipButton tooltip={t('Add')} onClick={handleAddPath} size="sm">
        {openFileDialogLoading.value ? (
          <LoaderCircle className="animate-spin h-4 w-4" />
        ) : (
          <FolderPlus className="h-4 w-4" />
        )}
      </TooltipButton>
      <Dialog
        open={manualAddDialogOpen.value}
        onOpenChange={(v) => {
          setManualAddPaths('');
          manualAddDialogOpen.set(v);
        }}
      >
        <DialogTrigger asChild>
          <TooltipButton tooltip={t('Manual add')} size="sm">
            <FolderPen className="h-4 w-4" />
          </TooltipButton>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Manual add')}</DialogTitle>
            <DialogDescription>
              {t('Manually add paths desc')}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={10}
            value={manualAddPaths}
            onChange={(e) => setManualAddPaths(e.target.value)}
            className="resize-none"
          />
          <DialogFooter>
            <Button variant="secondary" onClick={manualAddDialogOpen.off}>
              {t('Cancel')}
            </Button>
            <Button onClick={handleManualAddOk}>{t('Ok')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <TooltipButton
        tooltip={t('Remove selected')}
        onClick={handleRemovePaths}
        size="sm"
      >
        <Trash2 className="h-4 w-4" />
      </TooltipButton>
      <TooltipButton
        tooltip={t('Clear all')}
        onClick={handleClearAllPaths}
        size="sm"
      >
        <FolderMinus className="h-4 w-4" />
      </TooltipButton>
    </div>
  );
}
