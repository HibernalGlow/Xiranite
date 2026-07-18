import { useAtomValue, useSetAtom } from 'jotai';
import { SquareMousePointer } from 'lucide-react';
import { useState } from 'react';
import { currentToolAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import {
  currentToolFilteredDataAtom,
  currentToolRowSelectionAtom,
} from '@/nodes/czkawka/upstream/atom/tools';
import { Button, OperationButton, Textarea } from '@/nodes/czkawka/upstream/components';
import type { RowSelection } from '@/nodes/czkawka/upstream/components/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tools } from '@/nodes/czkawka/upstream/consts';
import { useBoolean, useT } from '@/nodes/czkawka/upstream/hooks';
import type { BaseEntry, RefEntry } from '@/nodes/czkawka/upstream/types';
import { getPathsFromEntries, getRowSelectionKeys } from '@/nodes/czkawka/upstream/utils/common';

const toolsWithSizeAndDateSelect = new Set<string>([
  Tools.DuplicateFiles,
  Tools.SimilarImages,
  Tools.SimilarVideos,
  Tools.MusicDuplicates,
]);

export function RowSelectionMenu(props: { disabled: boolean }) {
  const { disabled } = props;

  const currentTool = useAtomValue(currentToolAtom);
  const currentToolData = useAtomValue(currentToolFilteredDataAtom);
  const setCurrentToolRowSelection = useSetAtom(currentToolRowSelectionAtom);
  const t = useT();
  const customSelectDialogOpen = useBoolean();
  const customUnselectDialogOpen = useBoolean();
  const [customPattern, setCustomPattern] = useState('');
  const [isRegex, setIsRegex] = useState(false);

  const handleInvertSelection = () => {
    invertSelection(
      currentToolData as (BaseEntry & Partial<RefEntry>)[],
      setCurrentToolRowSelection,
    );
  };

  const handleSelectAll = () => {
    const paths = getPathsFromEntries(
      currentToolData as (BaseEntry & Partial<RefEntry>)[],
    );
    setCurrentToolRowSelection(pathsToRowSelection(paths));
  };

  const handleSelectXXX = (
    type: 'size' | 'date' | 'resolution' | 'path' | 'name',
    dir: 'asc' | 'desc',
    inverse = false,
  ) => {
    if (
      type !== 'path' &&
      type !== 'name' &&
      !toolsWithSizeAndDateSelect.has(currentTool)
    ) {
      return;
    }
    setCurrentToolRowSelection(
      selectItem(
        currentToolData as (BaseEntry & RefEntry & WithRaw)[],
        type,
        dir,
        inverse,
      ),
    );
  };

  const handleSelectByFolder = () => {
    setCurrentToolRowSelection(
      selectByFolder(currentToolData as (BaseEntry & RefEntry)[]),
    );
  };

  const handleCustomSelect = (unselect = false) => {
    if (!customPattern.trim()) return;

    try {
      const pattern = isRegex ? new RegExp(customPattern) : customPattern;
      const paths = getPathsFromEntries(
        currentToolData as (BaseEntry & Partial<RefEntry>)[],
      );

      const matchedPaths = paths.filter((path) => {
        if (isRegex) {
          return (pattern as RegExp).test(path);
        }
        return path.includes(pattern as string);
      });

      if (unselect) {
        setCurrentToolRowSelection((old) => {
          const oldSelected = new Set(getRowSelectionKeys(old));
          const newSelected = [...oldSelected].filter(
            (path) => !matchedPaths.includes(path),
          );
          return pathsToRowSelection(newSelected);
        });
      } else {
        setCurrentToolRowSelection((old) => {
          const oldSelected = new Set(getRowSelectionKeys(old));
          const newSelected = Array.from(
            new Set([...oldSelected, ...matchedPaths]),
          );
          return pathsToRowSelection(newSelected);
        });
      }
    } catch (e) {
      console.error('Invalid regex pattern:', e);
    }

    if (unselect) {
      customUnselectDialogOpen.off();
    } else {
      customSelectDialogOpen.off();
    }
    setCustomPattern('');
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <OperationButton disabled={disabled}>
            <SquareMousePointer />
            {t('Select')}
          </OperationButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top">
          <DropdownMenuItem onClick={handleSelectAll}>
            {t('Select all')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleInvertSelection}>
            {t('Invert selection')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => customSelectDialogOpen.on()}>
            {t('Select custom')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => customUnselectDialogOpen.on()}>
            {t('Unselect custom')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          {/* 路径长度选择 */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{t('Path based')}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => handleSelectXXX('path', 'asc')}>
                {t('Select the longest path')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSelectXXX('path', 'desc')}>
                {t('Select the shortest path')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleSelectXXX('path', 'asc', true)}
              >
                {t('Select all except longest path')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleSelectXXX('path', 'desc', true)}
              >
                {t('Select all except shortest path')}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {/* 文件名选择 */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{t('Name based')}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => handleSelectXXX('name', 'asc')}>
                {t('Select the first name')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSelectXXX('name', 'desc')}>
                {t('Select the last name')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleSelectXXX('name', 'asc', true)}
              >
                {t('Select all except first name')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleSelectXXX('name', 'desc', true)}
              >
                {t('Select all except last name')}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {/* 文件夹保留选择 */}
          <DropdownMenuItem onClick={handleSelectByFolder}>
            {t('Keep one per folder')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          {currentTool === Tools.SimilarImages && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                {t('Resolution based')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  onClick={() => handleSelectXXX('resolution', 'asc')}
                >
                  {t('Select the highest resolution')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleSelectXXX('resolution', 'desc')}
                >
                  {t('Select the lowest resolution')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handleSelectXXX('resolution', 'asc', true)}
                >
                  {t('Select all except highest resolution')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleSelectXXX('resolution', 'desc', true)}
                >
                  {t('Select all except lowest resolution')}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          {toolsWithSizeAndDateSelect.has(currentTool) && (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {t('Size based')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem
                    onClick={() => handleSelectXXX('size', 'asc')}
                  >
                    {t('Select the biggest size')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleSelectXXX('size', 'desc')}
                  >
                    {t('Select the smallest size')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => handleSelectXXX('size', 'asc', true)}
                  >
                    {t('Select all except biggest')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleSelectXXX('size', 'desc', true)}
                  >
                    {t('Select all except smallest')}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {t('Date based')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem
                    onClick={() => handleSelectXXX('date', 'asc')}
                  >
                    {t('Select the newest')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleSelectXXX('date', 'desc')}
                  >
                    {t('Select the oldest')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => handleSelectXXX('date', 'asc', true)}
                  >
                    {t('Select all except newest')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleSelectXXX('date', 'desc', true)}
                  >
                    {t('Select all except oldest')}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={customSelectDialogOpen.value}
        onOpenChange={customSelectDialogOpen.set}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Select custom')}</DialogTitle>
            <DialogDescription>
              {t('Enter a pattern to select files by path')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <label className="text-sm font-medium">
              <input
                type="checkbox"
                checked={isRegex}
                onChange={(e) => setIsRegex(e.target.checked)}
                className="mr-2"
              />
              {t('Use regex')}
            </label>
          </div>
          <Textarea
            value={customPattern}
            onChange={(e) => setCustomPattern(e.target.value)}
            placeholder={
              isRegex
                ? t('Regular expression pattern')
                : t('Text to match in path')
            }
            className="min-h-[100px]"
          />
          <DialogFooter>
            <Button variant="secondary" onClick={customSelectDialogOpen.off}>
              {t('Cancel')}
            </Button>
            <Button onClick={() => handleCustomSelect(false)}>
              {t('Select')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={customUnselectDialogOpen.value}
        onOpenChange={customUnselectDialogOpen.set}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Unselect custom')}</DialogTitle>
            <DialogDescription>
              {t('Enter a pattern to unselect files by path')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <label className="text-sm font-medium">
              <input
                type="checkbox"
                checked={isRegex}
                onChange={(e) => setIsRegex(e.target.checked)}
                className="mr-2"
              />
              {t('Use regex')}
            </label>
          </div>
          <Textarea
            value={customPattern}
            onChange={(e) => setCustomPattern(e.target.value)}
            placeholder={
              isRegex
                ? t('Regular expression pattern')
                : t('Text to match in path')
            }
            className="min-h-[100px]"
          />
          <DialogFooter>
            <Button variant="secondary" onClick={customUnselectDialogOpen.off}>
              {t('Cancel')}
            </Button>
            <Button onClick={() => handleCustomSelect(true)}>
              {t('Unselect')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function invertSelection<T extends BaseEntry & Partial<RefEntry>>(
  data: T[],
  setFn: (updater: (v: RowSelection) => RowSelection) => void,
) {
  const paths = getPathsFromEntries(data);
  setFn((old) => convertRowSelection(old, paths));
}

function convertRowSelection(old: RowSelection, paths: string[]): RowSelection {
  const selected = new Set(getRowSelectionKeys(old));
  const unselected = paths.filter((v) => !selected.has(v));
  const result = pathsToRowSelection(unselected);
  return result;
}

function pathsToRowSelection(paths: string[]): RowSelection {
  const obj = Object.fromEntries(
    paths.map((v) => {
      return [v, true];
    }),
  );
  return obj;
}

function groupBy<T extends RefEntry>(list: T[]): T[][] {
  const map: Map<number, T[]> = new Map();

  for (const item of list) {
    if (!item.groupId) {
      continue;
    }
    const v = map.get(item.groupId);
    if (v) {
      v.push(item);
    } else {
      map.set(item.groupId, [item]);
    }
  }

  return Array.from(map.values());
}

interface WithRaw {
  raw: Record<string, any>;
}

function selectItem<T extends BaseEntry & RefEntry & WithRaw>(
  data: T[],
  type: 'size' | 'date' | 'resolution' | 'path' | 'name',
  dir: 'asc' | 'desc',
  inverse = false,
): RowSelection {
  const paths: string[] = [];
  let compareFn: ((a: T, b: T) => T) | null = null;
  if (type === 'size' && dir === 'asc') {
    compareFn = pickBiggest;
  } else if (type === 'size' && dir === 'desc') {
    compareFn = pickSmallest;
  } else if (type === 'date' && dir === 'asc') {
    compareFn = pickNewst;
  } else if (type === 'date' && dir === 'desc') {
    compareFn = pickOldest;
  } else if (type === 'resolution' && dir === 'asc') {
    compareFn = pickHighestResolution;
  } else if (type === 'resolution' && dir === 'desc') {
    compareFn = pickLowestResolution;
  } else if (type === 'path' && dir === 'asc') {
    compareFn = (a: T, b: T) => (a.path.length >= b.path.length ? a : b);
  } else if (type === 'path' && dir === 'desc') {
    compareFn = (a: T, b: T) => (a.path.length <= b.path.length ? a : b);
  } else if (type === 'name' && dir === 'asc') {
    // 选择文件名字典序靠前的（A-Z）
    compareFn = (a: T, b: T) => {
      const nameA = a.path.split(/[/\\]/).pop()?.toLowerCase() || '';
      const nameB = b.path.split(/[/\\]/).pop()?.toLowerCase() || '';
      return nameA <= nameB ? a : b;
    };
  } else if (type === 'name' && dir === 'desc') {
    // 选择文件名字典序靠后的（Z-A）
    compareFn = (a: T, b: T) => {
      const nameA = a.path.split(/[/\\]/).pop()?.toLowerCase() || '';
      const nameB = b.path.split(/[/\\]/).pop()?.toLowerCase() || '';
      return nameA >= nameB ? a : b;
    };
  }
  if (!compareFn) {
    return {};
  }

  const groups = groupBy(data);
  for (const group of groups) {
    if (!group.length) {
      continue;
    }

    if (inverse) {
      // Select all except the one that matches the compare function
      const selectedItem = group.reduce(compareFn);
      const otherItems = group.filter(
        (item) => item.path !== selectedItem.path,
      );
      paths.push(...otherItems.map((item) => item.path));
    } else {
      // Select only the one that matches the compare function
      const path = group.reduce(compareFn).path;
      paths.push(path);
    }
  }

  return pathsToRowSelection(paths);
}

function pickBiggest<T extends WithRaw>(a: T, b: T): T {
  return a.raw.size >= b.raw.size ? a : b;
}

function pickSmallest<T extends WithRaw>(a: T, b: T): T {
  return a.raw.size <= b.raw.size ? a : b;
}

function pickNewst<T extends WithRaw>(a: T, b: T): T {
  return a.raw.modified_date >= b.raw.modified_date ? a : b;
}

function pickOldest<T extends WithRaw>(a: T, b: T): T {
  return a.raw.modified_date <= b.raw.modified_date ? a : b;
}

function pickHighestResolution<T extends WithRaw>(a: T, b: T): T {
  return a.raw.width * a.raw.height >= b.raw.width * b.raw.height ? a : b;
}

function pickLowestResolution<T extends WithRaw>(a: T, b: T): T {
  return a.raw.width * a.raw.height <= b.raw.width * b.raw.height ? a : b;
}

// 按文件夹选择：每个组内的每个文件夹保留一个文件
function selectByFolder<T extends BaseEntry & RefEntry>(
  data: T[],
): RowSelection {
  // 先按 groupId 分组
  const groups = groupBy(data);
  const paths: string[] = [];

  for (const group of groups) {
    // 检查当前组的所有文件是否都在同一个文件夹
    const folders = new Set<string>();
    for (const item of group) {
      const folder = item.path.substring(
        0,
        item.path.lastIndexOf('\\') !== -1
          ? item.path.lastIndexOf('\\')
          : item.path.lastIndexOf('/'),
      );
      folders.add(folder);
    }

    if (folders.size === 1) {
      // 如果整个组都在同一个文件夹，选择整个组（但优先选择非参考文件）
      const nonRefItems = group.filter((item) => !item.isRef);
      if (nonRefItems.length > 0) {
        paths.push(...nonRefItems.map((item) => item.path));
      } else {
        paths.push(...group.map((item) => item.path));
      }
    } else {
      // 如果组内有多个文件夹，每个文件夹保留一个
      const folderMap = new Map<string, T[]>();
      for (const item of group) {
        const folder = item.path.substring(
          0,
          item.path.lastIndexOf('\\') !== -1
            ? item.path.lastIndexOf('\\')
            : item.path.lastIndexOf('/'),
        );
        if (!folderMap.has(folder)) {
          folderMap.set(folder, []);
        }
        folderMap.get(folder)?.push(item);
      }

      for (const folderItems of folderMap.values()) {
        if (folderItems.length === 0) continue;
        const nonRefItem = folderItems.find((item) => !item.isRef);
        const selectedItem = nonRefItem || folderItems[0];
        paths.push(selectedItem.path);
      }
    }
  }

  return pathsToRowSelection(paths);
}
