import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { FolderTree } from 'lucide-react';
import { useMemo, useState } from 'react';
import { currentToolAtom, logsAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { currentToolDataAtom, currentToolRowSelectionAtom } from '@/nodes/czkawka/upstream/atom/tools';
import { Input, Label, OperationButton, Switch } from '@/nodes/czkawka/upstream/components';
import { OneAlertDialog } from '@/nodes/czkawka/upstream/components/one-alert-dialog';
import { Tools } from '@/nodes/czkawka/upstream/consts';
import { useBoolean, useListenEffect, useT } from '@/nodes/czkawka/upstream/hooks';
import { ipc } from '@/nodes/czkawka/upstream/ipc';
import type { ImagesEntry } from '@/nodes/czkawka/upstream/types';
import { getRowSelectionKeys } from '@/nodes/czkawka/upstream/utils/common';
import {
  type GroupedFields,
  processDataWithGroups,
} from '@/nodes/czkawka/upstream/utils/table-helper';

interface OrganizeSimilarGroupsProps {
  disabled: boolean;
}

interface SimilarRow extends ImagesEntry, GroupedFields {}

interface MoveItem {
  path: string;
  destination: string;
}

interface Options {
  copyMode: boolean;
  overrideMode: boolean;
  subfolderTemplate: string;
  skipSingleFileFolders: boolean;
}

interface MoveFilesResult {
  successPaths: string[];
  errors: string[];
}

const PREVIEW_LIMIT = 12;

const DEFAULT_OPTIONS: Options = {
  copyMode: false,
  overrideMode: false,
  subfolderTemplate: 'variants_{groupId}',
  skipSingleFileFolders: true,
};

function getParentDirectory(path: string): string | null {
  const normalized = path.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  if (index <= 0) {
    return null;
  }
  const parent = normalized.slice(0, index);
  return path.includes('\\') ? parent.replace(/\//g, '\\') : parent;
}

function joinPath(parent: string, child: string): string {
  const separator = parent.includes('\\') ? '\\' : '/';
  if (parent.endsWith('\\') || parent.endsWith('/')) {
    return `${parent}${child}`;
  }
  return `${parent}${separator}${child}`;
}

function sanitizeFolderName(name: string): string {
  const sanitized = name.replace(/[<>:"/\\|?*]/g, '_').trim();
  return sanitized || 'variants_{groupId}';
}

function resolveSubfolderName(template: string, groupId: number): string {
  const safeTemplate = sanitizeFolderName(template);
  return safeTemplate.replaceAll('{groupId}', String(groupId).padStart(4, '0'));
}

function shortenPath(path: string, limit = 78): string {
  if (path.length <= limit) {
    return path;
  }
  const keep = Math.max(8, limit - 3);
  return `${path.slice(0, keep)}...`;
}

function buildMovePlan(
  rows: SimilarRow[],
  selectedPathSet: Set<string>,
  options: Options,
): MoveItem[] {
  if (!rows.length || !selectedPathSet.size) {
    return [];
  }

  const selectedGroupIds = new Set<number>();
  for (const row of rows) {
    if (row.hidden || row.isRef || row.groupId === undefined) {
      continue;
    }
    if (selectedPathSet.has(row.path)) {
      selectedGroupIds.add(row.groupId);
    }
  }
  if (!selectedGroupIds.size) {
    return [];
  }

  const groupedByFolder = new Map<string, string[]>();
  for (const row of rows) {
    if (row.hidden || row.isRef || row.groupId === undefined) {
      continue;
    }
    if (!selectedGroupIds.has(row.groupId)) {
      continue;
    }

    const parent = getParentDirectory(row.path);
    if (!parent) {
      continue;
    }

    const key = `${row.groupId}::${parent}`;
    if (!groupedByFolder.has(key)) {
      groupedByFolder.set(key, []);
    }
    groupedByFolder.get(key)!.push(row.path);
  }

  const plan: MoveItem[] = [];
  for (const [key, paths] of groupedByFolder.entries()) {
    const uniquePaths = Array.from(new Set(paths));
    if (options.skipSingleFileFolders && uniquePaths.length < 2) {
      continue;
    }

    const separatorIndex = key.indexOf('::');
    if (separatorIndex < 0) {
      continue;
    }
    const groupIdText = key.slice(0, separatorIndex);
    const parent = key.slice(separatorIndex + 2);
    const groupId = Number.parseInt(groupIdText, 10);
    if (Number.isNaN(groupId)) {
      continue;
    }

    const destination = joinPath(
      parent,
      resolveSubfolderName(options.subfolderTemplate, groupId),
    );

    for (const path of uniquePaths) {
      plan.push({ path, destination });
    }
  }

  return plan;
}

function countSelectedGroups(
  rows: SimilarRow[],
  selectedPathSet: Set<string>,
): number {
  const selectedGroupIds = new Set<number>();
  for (const row of rows) {
    if (row.hidden || row.isRef || row.groupId === undefined) {
      continue;
    }
    if (selectedPathSet.has(row.path)) {
      selectedGroupIds.add(row.groupId);
    }
  }
  return selectedGroupIds.size;
}

export function OrganizeSimilarGroups(props: OrganizeSimilarGroupsProps) {
  const { disabled } = props;

  const t = useT();
  const currentTool = useAtomValue(currentToolAtom);
  const [currentToolData, setCurrentToolData] = useAtom(currentToolDataAtom);
  const [rowSelection, setRowSelection] = useAtom(currentToolRowSelectionAtom);
  const setLogs = useSetAtom(logsAtom);

  const open = useBoolean();
  const loading = useBoolean();
  const [options, setOptions] = useState<Options>(DEFAULT_OPTIONS);

  const rows = useMemo(() => {
    const rawData = Array.isArray(currentToolData)
      ? (currentToolData as SimilarRow[])
      : [];
    return processDataWithGroups(rawData) as SimilarRow[];
  }, [currentToolData]);

  const selectedPathSet = useMemo(
    () => new Set(getRowSelectionKeys(rowSelection)),
    [rowSelection],
  );

  const selectedGroupCount = useMemo(
    () => countSelectedGroups(rows, selectedPathSet),
    [rows, selectedPathSet],
  );

  const moveItems = useMemo(
    () => buildMovePlan(rows, selectedPathSet, options),
    [rows, selectedPathSet, options],
  );

  const targetFolderCount = useMemo(
    () => new Set(moveItems.map((item) => item.destination)).size,
    [moveItems],
  );

  const previewItems = useMemo(
    () => moveItems.slice(0, PREVIEW_LIMIT),
    [moveItems],
  );

  const canUse =
    currentTool === Tools.SimilarImages &&
    selectedGroupCount > 0 &&
    moveItems.length > 0;

  useListenEffect(
    'move-files-to-destinations-result',
    (result: MoveFilesResult) => {
      loading.off();
      open.off();

      const { successPaths, errors } = result;
      setLogs(
        [
          `Processed ${successPaths.length} files into grouped subfolders`,
          ...errors,
        ].join('\n'),
      );

      if (!options.copyMode) {
        const moved = new Set(successPaths);
        const rawData = Array.isArray(currentToolData)
          ? (currentToolData as SimilarRow[])
          : [];
        const newData = rawData.filter((item) => !moved.has(item.path));
        setCurrentToolData(newData);
      }

      setRowSelection({});
    },
  );

  const handleOpen = () => {
    if (!canUse || loading.value) {
      return;
    }
    open.on();
  };

  const handleOpenChange = (value: boolean) => {
    if (loading.value) {
      return;
    }
    open.set(value);
  };

  const handleSubmit = () => {
    if (!moveItems.length || loading.value) {
      return;
    }

    loading.on();
    ipc.moveFilesToDestinations({
      items: moveItems,
      copyMode: options.copyMode,
      overrideMode: options.overrideMode,
    });
  };

  return (
    <>
      <OperationButton disabled={disabled || !canUse} onClick={handleOpen}>
        <FolderTree />
        {t('Organize groups')}
      </OperationButton>

      <OneAlertDialog
        open={open.value}
        onOpenChange={handleOpenChange}
        title={t('Organizing groups')}
        okLoading={loading.value}
        description={t('Group organize confirm', {
          files: moveItems.length,
          groups: selectedGroupCount,
          folders: targetFolderCount,
        })}
        onOk={handleSubmit}
      >
        <div className="space-y-3 py-2">
          <p className="text-xs text-muted-foreground">
            {t('Organize selected groups hint')}
          </p>

          <div className="rounded border border-border p-2 text-xs space-y-1">
            <div>
              {t('Groups')}: {selectedGroupCount}
            </div>
            <div>
              {t('Items')}: {moveItems.length}
            </div>
            <div>
              {t('folders')}: {targetFolderCount}
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="organize-subfolder-template">
              {t('Subfolder template')}
            </Label>
            <Input
              id="organize-subfolder-template"
              value={options.subfolderTemplate}
              onChange={(event) =>
                setOptions((prev) => ({
                  ...prev,
                  subfolderTemplate: event.currentTarget.value,
                }))
              }
              placeholder="variants_{groupId}"
            />
            <p className="text-xs text-muted-foreground">
              {t('Use {groupId} placeholder')}
            </p>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="organize-copy-mode">
              {t('Copy files instead of moving')}
            </Label>
            <Switch
              id="organize-copy-mode"
              checked={options.copyMode}
              onCheckedChange={(value) =>
                setOptions((prev) => ({ ...prev, copyMode: value }))
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="organize-override-mode">
              {t('Override files')}
            </Label>
            <Switch
              id="organize-override-mode"
              checked={options.overrideMode}
              onCheckedChange={(value) =>
                setOptions((prev) => ({ ...prev, overrideMode: value }))
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="organize-skip-single">
              {t('Skip folders with one file')}
            </Label>
            <Switch
              id="organize-skip-single"
              checked={options.skipSingleFileFolders}
              onCheckedChange={(value) =>
                setOptions((prev) => ({
                  ...prev,
                  skipSingleFileFolders: value,
                }))
              }
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label>{t('Preview list')}</Label>
              <span className="text-xs text-muted-foreground">
                {t('Showing first {{count}} of {{total}}', {
                  count: previewItems.length,
                  total: moveItems.length,
                })}
              </span>
            </div>
            <div className="max-h-48 overflow-y-auto rounded border border-border p-2 space-y-2">
              {previewItems.map((item, index) => (
                <div
                  key={`${item.path}-${item.destination}-${index}`}
                  className="text-xs space-y-0.5"
                >
                  <div className="font-medium text-foreground break-all">
                    {index + 1}. {shortenPath(item.path)}
                  </div>
                  <div className="text-muted-foreground break-all">
                    -&gt; {shortenPath(item.destination)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </OneAlertDialog>
    </>
  );
}
