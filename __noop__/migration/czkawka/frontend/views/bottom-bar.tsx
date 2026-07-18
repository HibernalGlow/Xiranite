import type { Table } from '@tanstack/react-table';
import { open as openFileDialog } from '@/nodes/czkawka/upstream/adapters/tauri-dialog';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  ArrowDownFromLine,
  BarChart3,
  Filter,
  Folder,
  FolderMinus,
  FolderPen,
  FolderPlus,
  ListFilter,
  LoaderCircle,
  ScrollText,
  Settings2,
  Sliders,
  Star,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  currentToolAtom,
  excludedDirsRowSelectionAtom,
  includedDirsRowSelectionAtom,
  logsAtom,
} from '@/nodes/czkawka/upstream/atom/primitive';
import { settingsAtom } from '@/nodes/czkawka/upstream/atom/settings';
import { currentToolDataAtom } from '@/nodes/czkawka/upstream/atom/tools';
import {
  Button,
  Checkbox,
  ScrollArea,
  Textarea,
  TooltipButton,
} from '@/nodes/czkawka/upstream/components';
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
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tools } from '@/nodes/czkawka/upstream/consts';
import { useBoolean, useT } from '@/nodes/czkawka/upstream/hooks';
import { useFormatStats } from '@/nodes/czkawka/upstream/hooks/useFormatStats';
import { useSimilarityStats } from '@/nodes/czkawka/upstream/hooks/useSimilarityStats';
import type { DirsType, FolderStat } from '@/nodes/czkawka/upstream/types';
import { cn } from '@/nodes/czkawka/upstream/utils/cn';
import { getRowSelectionKeys, splitStr } from '@/nodes/czkawka/upstream/utils/common';
import { FormatBarChartCard } from './cards/format-bar-chart-card';
import { FormatDonutChartCard } from './cards/format-donut-chart-card';
import { FormatFilterCard } from './cards/format-filter-card';
import { SimilarityDistributionCard } from './cards/similarity-distribution-card';
import { FileFilter } from './file-filter';
import { FilterPanel } from './filter-panel';
import { Operations } from './operations';
import { SelectionAssistantPanel } from './selection-assistant/selection-assistant-panel';
import { ToolSettings } from './tool-settings';

const DisplayType = {
  Dirs: 'dirs',
  Logs: 'logs',
  ToolSettings: 'toolSettings',
  Assistant: 'assistant',
} as const;

interface TableData {
  path: string;
  field: DirsType;
  isReference?: boolean;
}

type PropsWithTable<T> = T & {
  table: Table<TableData>;
};

type PropsWithRowSelection<T> = T & {
  rowSelection: RowSelection;
  onRowSelectionChange: (v: RowSelection) => void;
};

// function SimilarFoldersButton({ folders }: { folders: FolderStat[] }) {
//   const [open, setOpen] = useState(false);
//   // TODO: 可扩展选中状态和批量操作
//   return (
//     <>
//       <TooltipButton tooltip="相似文件夹批量操作" onClick={() => setOpen(true)}>
//         <FolderPlus />
//       </TooltipButton>
//       <Dialog open={open} onOpenChange={setOpen}>
//         <DialogContent>
//           <DialogHeader>
//             <DialogTitle>相似文件夹批量操作</DialogTitle>
//           </DialogHeader>
//           <div style={{ maxHeight: 400, overflow: 'auto' }}>
//             {folders.length === 0 ? (
//               <div>暂无符合条件的文件夹</div>
//             ) : (
//               <ul>
//                 {folders.map((f) => (
//                   <li key={f.path} style={{ marginBottom: 8 }}>
//                     <div className="flex items-center gap-2">
//                       <Checkbox />
//                       <span>
//                         {f.path}（{f.count} 张图片）
//                       </span>
//                     </div>
//                   </li>
//                 ))}
//               </ul>
//             )}
//             {/* 这里可以加批量移动/删除按钮，调用已有逻辑 */}
//           </div>
//         </DialogContent>
//       </Dialog>
//     </>
//   );
// }

interface BottomBarProps {
  headerRef?: React.RefObject<HTMLDivElement>;
}

export function BottomBar({ headerRef }: BottomBarProps) {
  const [displayType, setDisplayType] = useState<string>(DisplayType.Dirs);
  const minimizeBottomBar = useBoolean();
  const t = useT();
  const excludedDirsDialogOpen = useBoolean();
  const [_settings, _setSettings] = useAtom(settingsAtom);
  const [_rowSelection, _setRowSelection] = useAtom(
    excludedDirsRowSelectionAtom,
  );
  const currentToolData = useAtomValue(currentToolDataAtom);
  const currentTool = useAtomValue(currentToolAtom);
  const [_foldersFromScanResult, setFoldersFromScanResult] = useState<
    FolderStat[]
  >([]);
  useEffect(() => {
    // 只在相似图片工具下处理
    if (
      currentTool === Tools.SimilarImages &&
      currentToolData &&
      Array.isArray(currentToolData) &&
      currentToolData.length > 0
    ) {
      const maybeFolders = (currentToolData as any)[0]?.folders;
      if (maybeFolders && Array.isArray(maybeFolders)) {
        setFoldersFromScanResult(maybeFolders);
      } else {
        setFoldersFromScanResult([]);
      }
    } else {
      setFoldersFromScanResult([]);
    }
  }, [currentToolData, currentTool]);

  return (
    <div className="flex flex-col h-full px-2 py-1 gap-1 border-t">
      <div ref={headerRef} className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Operations />
          {/* 相似文件夹批量操作入口已移除，相关功能已集成到主表格切换 */}
          {/* <RowSelectionMenu disabled={false} /> */}
          <FileFilter />
        </div>
        <div className="flex items-center gap-1">
          <Tabs value={displayType} onValueChange={setDisplayType}>
            <TabsList>
              <TabsTrigger value={DisplayType.Dirs}>
                <Folder />
              </TabsTrigger>
              <TabsTrigger value={DisplayType.ToolSettings}>
                <Settings2 />
              </TabsTrigger>
              <TabsTrigger value={DisplayType.Logs}>
                <ScrollText />
              </TabsTrigger>
              <TabsTrigger value={DisplayType.Assistant}>
                <Wand2 />
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Dialog
            open={excludedDirsDialogOpen.value}
            onOpenChange={excludedDirsDialogOpen.set}
          >
            <DialogTrigger asChild>
              <TooltipButton
                tooltip={t('Exclude Directories')}
                variant="outline"
              >
                <FolderMinus />
              </TooltipButton>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>{t('Exclude Directories')}</DialogTitle>
                <DialogDescription>
                  {t('Manage directories to exclude from scanning')}
                </DialogDescription>
              </DialogHeader>
              <div className="h-[400px]">
                <ExcludedDirsTable />
              </div>
            </DialogContent>
          </Dialog>
          <TooltipButton
            tooltip={minimizeBottomBar.value ? t('Expand') : t('Collapse')}
            onClick={minimizeBottomBar.toggle}
            variant="outline"
          >
            <ArrowDownFromLine
              className={cn(
                'transition-transform duration-300',
                minimizeBottomBar.value && 'rotate-180',
              )}
            />
          </TooltipButton>
        </div>
      </div>
      {!minimizeBottomBar.value && (
        <ResizablePanelGroup direction="vertical" className="flex-1">
          <ResizablePanel defaultSize={100} minSize={20}>
            {displayType === DisplayType.Dirs ? (
              <ResizablePanelGroup direction="horizontal">
                <ResizablePanel defaultSize={20} minSize={12}>
                  <ToolControlsPanel />
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel defaultSize={20} minSize={12}>
                  <ToolAlgorithmPanel />
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel defaultSize={15} minSize={10}>
                  <FormatFilterPanel />
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel defaultSize={45} minSize={20}>
                  <IncludedDirsTable />
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : displayType === DisplayType.ToolSettings ? (
              <div className="h-full flex flex-col border rounded-md overflow-hidden">
                <div className="bg-muted/30 p-2 border-b">
                  <h3 className="text-sm font-medium flex items-center gap-1">
                    <Settings2 className="h-4 w-4" />
                    <span>{t('Tool settings')}</span>
                  </h3>
                </div>
                <div className="flex-1 overflow-auto p-2 hide-scrollbar">
                  <ToolSettings inPanel={true} />
                </div>
              </div>
            ) : displayType === DisplayType.Assistant ? (
              <AssistantPanel />
            ) : (
              <Logs />
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}

function ToolControlsPanel() {
  const t = useT();

  return (
    <div className="h-full flex flex-col border rounded-md overflow-hidden">
      <div className="bg-muted/30 p-2 border-b">
        <h3 className="text-sm font-medium flex items-center gap-1">
          <Sliders className="h-4 w-4" />
          <span>{t('Tool controls')}</span>
        </h3>
      </div>
      <div className="flex-1 overflow-auto p-2 hide-scrollbar">
        <ToolSettings
          inPanel={true}
          showControls={true}
          showAlgorithms={false}
        />
      </div>
    </div>
  );
}

function ToolAlgorithmPanel() {
  const t = useT();

  return (
    <div className="h-full flex flex-col border rounded-md overflow-hidden">
      <div className="bg-muted/30 p-2 border-b">
        <h3 className="text-sm font-medium flex items-center gap-1">
          <Settings2 className="h-4 w-4" />
          <span>{t('Algorithm settings')}</span>
        </h3>
      </div>
      <div className="flex-1 overflow-auto p-2 hide-scrollbar">
        <ToolSettings
          inPanel={true}
          showControls={false}
          showAlgorithms={true}
        />
      </div>
    </div>
  );
}

function FormatFilterPanel() {
  const t = useT();

  return (
    <div className="h-full flex flex-col border rounded-md overflow-hidden">
      <div className="bg-muted/30 p-2 border-b">
        <h3 className="text-sm font-medium flex items-center gap-1">
          <ListFilter className="h-4 w-4" />
          <span>{t('Format filter')}</span>
        </h3>
      </div>
      <div className="flex-1 overflow-hidden">
        <FormatFilterCard />
      </div>
    </div>
  );
}

function IncludedDirsTable() {
  const t = useT();
  const [settings, setSettings] = useAtom(settingsAtom);
  const [rowSelection, setRowSelection] = useAtom(includedDirsRowSelectionAtom);
  const data: TableData[] = useMemo(() => {
    return settings.includedDirectories.map((path) => {
      return {
        path,
        field: 'includedDirectories',
        isReference: settings.includedDirectoriesReferenced.includes(path),
      };
    });
  }, [settings]);

  // 判断是否全选参考路径
  const allReferenceSelected =
    data.length > 0 && data.every((d) => d.isReference);

  const handleReferenceSelectAll = (checked: boolean) => {
    setSettings((old) => {
      return {
        ...old,
        includedDirectoriesReferenced: checked ? data.map((d) => d.path) : [],
      };
    });
  };

  const columns = createColumns<TableData>([
    {
      accessorKey: 'path',
      header: t('Path'),
      meta: {
        span: 9,
      },
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
      meta: {
        span: 1,
      },
      cell: ({ row }) => {
        const isReference = row.original.isReference;
        return (
          <div className="flex justify-center">
            <Button
              variant={isReference ? 'default' : 'ghost'}
              size="icon"
              className="h-6 w-6"
              onClick={() => handleReferenceToggle(row.original.path)}
              title={t('Use as reference')}
            >
              <Star
                className={cn(
                  'h-4 w-4',
                  isReference
                    ? 'text-yellow-500 fill-yellow-500'
                    : 'text-muted-foreground',
                )}
              />
            </Button>
          </div>
        );
      },
    },
    {
      id: 'actions',
      meta: {
        span: 1,
      },
      cell: ({ row, table }) => {
        return <DirsRemoveButton {...row.original} table={table} />;
      },
    },
  ]);

  const handleReferenceToggle = (path: string) => {
    setSettings((old) => {
      const isCurrentlyReference =
        old.includedDirectoriesReferenced.includes(path);
      const newReferences = isCurrentlyReference
        ? old.includedDirectoriesReferenced.filter((p) => p !== path)
        : [...old.includedDirectoriesReferenced, path];

      return {
        ...old,
        includedDirectoriesReferenced: newReferences,
      };
    });
  };

  return (
    <div className="h-full flex flex-col border rounded-md overflow-hidden">
      <div className="flex justify-between items-center bg-muted/30 p-2 border-b">
        <h3 className="text-sm font-medium flex items-center gap-1">
          <Folder className="h-4 w-4" />
          <span>{t('Include Directories')}</span>
        </h3>
        <DirsActions
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
          field="includedDirectories"
        />
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        <DataTable
          className="flex-1"
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

function ExcludedDirsTable() {
  const t = useT();
  const [settings, _setSettings] = useAtom(settingsAtom);
  const [rowSelection, setRowSelection] = useAtom(excludedDirsRowSelectionAtom);
  const data: TableData[] = useMemo(() => {
    return settings.excludedDirectories.map((path) => {
      return {
        path,
        field: 'excludedDirectories',
      };
    });
  }, [settings]);

  const columns = createColumns<TableData>([
    {
      accessorKey: 'path',
      header: t('Path'),
      meta: {
        span: 10,
      },
    },
    {
      id: 'actions',
      meta: {
        span: 1,
      },
      cell: ({ row, table }) => {
        return <DirsRemoveButton {...row.original} table={table} />;
      },
    },
  ]);

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex justify-between items-center">
        <h3 className="text-center">{t('Exclude Directories')}</h3>
        <DirsActions
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
          field="excludedDirectories"
        />
      </div>
      <DataTable
        className="flex-1"
        data={data}
        columns={columns}
        emptyTip={t('Please add path')}
        layout="grid"
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
      />
    </div>
  );
}

function DirsRemoveButton(props: PropsWithTable<TableData>) {
  const { path, field, table } = props;
  const setSettings = useSetAtom(settingsAtom);

  const handleRemovePath = () => {
    setSettings((settings) => {
      return {
        ...settings,
        [field]: settings[field].filter((v) => v !== path),
      };
    });
    table.setRowSelection((old) => {
      return Object.fromEntries(
        Object.entries(old).filter((obj) => obj[0] !== path),
      );
    });
  };

  return (
    <Button
      className="translate-x-[-8px]"
      variant="ghost"
      size="icon"
      onClick={handleRemovePath}
    >
      <Trash2 />
    </Button>
  );
}

function DirsActions(props: PropsWithRowSelection<Pick<TableData, 'field'>>) {
  const t = useT();
  const { field, rowSelection, onRowSelectionChange } = props;
  const setSettings = useSetAtom(settingsAtom);
  const manualAddDialogOpen = useBoolean();
  const [manualAddPaths, setManualAddPaths] = useState('');
  const openFileDialogLoading = useBoolean();

  const handleRemovePaths = () => {
    const selected = new Set(getRowSelectionKeys(rowSelection));
    if (!selected.size) {
      return;
    }
    setSettings((settings) => {
      return {
        ...settings,
        [field]: settings[field].filter((path) => !selected.has(path)),
      };
    });
    onRowSelectionChange({});
  };

  const handleClearAllPaths = () => {
    setSettings((settings) => {
      // If clearing included directories, also clear referenced directories
      if (field === 'includedDirectories') {
        return {
          ...settings,
          [field]: [],
          includedDirectoriesReferenced: [],
        };
      }
      return {
        ...settings,
        [field]: [],
      };
    });
    onRowSelectionChange({});
  };

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
    if (!dirs || dirs.length === 0) {
      return;
    }

    setSettings((settings) => {
      const currentDirs = settings[field];
      const newDirs = Array.isArray(dirs) ? dirs : [dirs];
      const uniqueDirs = newDirs.filter((dir) => !currentDirs.includes(dir));

      if (uniqueDirs.length === 0) {
        return settings;
      }

      // Check for reference keywords if this is for includedDirectories
      if (field === 'includedDirectories') {
        const newReferenceDirs = [...settings.includedDirectoriesReferenced];

        for (const dir of uniqueDirs) {
          if (
            checkPathForReferenceKeywords(dir, settings.referencePathKeywords)
          ) {
            if (!newReferenceDirs.includes(dir)) {
              newReferenceDirs.push(dir);
            }
          }
        }

        return {
          ...settings,
          [field]: [...uniqueDirs, ...currentDirs],
          includedDirectoriesReferenced: newReferenceDirs,
        };
      }

      return {
        ...settings,
        [field]: [...uniqueDirs, ...currentDirs],
      };
    });
  };

  const handleManualAddOk = () => {
    const paths = splitStr(manualAddPaths);
    setSettings((settings) => {
      // Check for reference keywords if this is for includedDirectories
      if (field === 'includedDirectories') {
        const newReferenceDirs = [...settings.includedDirectoriesReferenced];

        for (const path of paths) {
          if (
            checkPathForReferenceKeywords(path, settings.referencePathKeywords)
          ) {
            if (!newReferenceDirs.includes(path)) {
              newReferenceDirs.push(path);
            }
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

function Logs() {
  const logs = useAtomValue(logsAtom);

  return (
    <ScrollArea className="h-full rounded-md border text-card-foreground px-2 py-1 dark:bg-muted/10 hide-scrollbar">
      <div className="whitespace-break-spaces">{logs}</div>
    </ScrollArea>
  );
}

/**
 * AssistantPanel - 助手面板
 * 包含选择助手、过滤器、格式分析三个独立卡片
 */
function AssistantPanel() {
  return (
    <ResizablePanelGroup direction="horizontal">
      <ResizablePanel defaultSize={40} minSize={20}>
        <SelectionAssistantCard />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={30} minSize={20}>
        <FilterCard />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={30} minSize={20}>
        <AnalysisCard />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

/**
 * 选择助手卡片
 */
function SelectionAssistantCard() {
  const t = useT();

  return (
    <div className="h-full flex flex-col border rounded-md overflow-hidden">
      <div className="bg-muted/30 p-2 border-b">
        <h3 className="text-sm font-medium flex items-center gap-1">
          <Wand2 className="h-4 w-4" />
          <span>{t('Selection Assistant')}</span>
        </h3>
      </div>
      <div className="flex-1 overflow-auto p-2 hide-scrollbar">
        <SelectionAssistantPanel />
      </div>
    </div>
  );
}

/**
 * 过滤器卡片
 */
function FilterCard() {
  const t = useT();

  return (
    <div className="h-full flex flex-col border rounded-md overflow-hidden">
      <div className="bg-muted/30 p-2 border-b">
        <h3 className="text-sm font-medium flex items-center gap-1">
          <Filter className="h-4 w-4" />
          <span>{t('Filter')}</span>
        </h3>
      </div>
      <div className="flex-1 overflow-hidden">
        <FilterPanel />
      </div>
    </div>
  );
}

/**
 * 格式分析卡片
 */
function AnalysisCard() {
  const t = useT();
  const stats = useFormatStats();
  const similarityStats = useSimilarityStats();
  const hasData =
    (stats && stats.length > 0) ||
    (similarityStats && similarityStats.length > 0);

  return (
    <div className="h-full flex flex-col border rounded-md overflow-hidden">
      <div className="bg-muted/30 p-2 border-b">
        <h3 className="text-sm font-medium flex items-center gap-1">
          <BarChart3 className="h-4 w-4" />
          <span>{t('Data analysis')}</span>
        </h3>
      </div>
      <div className="flex-1 overflow-auto p-2 hide-scrollbar">
        {hasData ? (
          <div className="space-y-3">
            <FormatDonutChartCard />
            <FormatBarChartCard />
            <SimilarityDistributionCard />
          </div>
        ) : (
          <div className="flex items-center justify-center text-muted-foreground h-full">
            <div className="text-center">
              <BarChart3 className="h-12 w-12 mx-auto mb-2 opacity-20" />
              <p className="text-sm">{t('No data available')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
