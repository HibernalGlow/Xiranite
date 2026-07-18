import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  Copy,
  FileQuestion,
  FileX,
  FolderX,
  HardDrive,
  Images,
  Link,
  LoaderCircle,
  Music,
  Tag,
  Trash2,
  Video,
} from 'lucide-react';
import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  currentToolAtom,
  progressAtom,
  sidebarWidthAtom,
} from '@/nodes/czkawka/upstream/atom/primitive';
import { restoreFilterAtom } from '@/nodes/czkawka/upstream/atom/tools';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Tools } from '@/nodes/czkawka/upstream/consts';
import type { ToolsValues } from '@/nodes/czkawka/upstream/types';
import { cn } from '@/nodes/czkawka/upstream/utils/cn';

const toolSet = new Set<string>(Object.values(Tools));

function isValidTool(s: string): s is ToolsValues {
  return toolSet.has(s);
}

// 工具图标映射
const toolIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  [Tools.DuplicateFiles]: Copy,
  [Tools.EmptyFolders]: FolderX,
  [Tools.BigFiles]: HardDrive,
  [Tools.EmptyFiles]: FileX,
  [Tools.TemporaryFiles]: Trash2,
  [Tools.SimilarImages]: Images,
  [Tools.SimilarVideos]: Video,
  [Tools.MusicDuplicates]: Music,
  [Tools.InvalidSymlinks]: Link,
  [Tools.BrokenFiles]: FileQuestion,
  [Tools.BadExtensions]: Tag,
};

export function AppSidebar() {
  const [currentTool, setCurrentTool] = useAtom(currentToolAtom);
  const [sidebarWidth, setSidebarWidth] = useAtom(sidebarWidthAtom);
  const progress = useAtomValue(progressAtom);
  const { t } = useTranslation();
  const restoreFilter = useSetAtom(restoreFilterAtom);
  const { state } = useSidebar();

  const isResizing = useRef(false);
  const hasMoved = useRef(false);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    hasMoved.current = false;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopResizing);
    document.body.style.cursor = 'col-resize';
  }, []);

  const stopResizing = useCallback(() => {
    isResizing.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', stopResizing);
    document.body.style.cursor = '';
    // Use a small timeout to ensure the click event has fired before resetting
    setTimeout(() => {
      hasMoved.current = false;
    }, 100);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing.current) return;
    hasMoved.current = true;
    const newWidth = Math.min(Math.max(160, e.clientX), 600);
    setSidebarWidth(newWidth);
  }, []);

  const handleRailClick = (e: React.MouseEvent) => {
    if (hasMoved.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handleClick = (name: string) => {
    if (!isValidTool(name)) {
      return;
    }
    setCurrentTool(name);
    restoreFilter();
  };

  return (
    <Sidebar
      collapsible="icon"
      className="border-r transition-all duration-300 top-10 h-[calc(100vh-2.5rem)]"
    >
      <SidebarContent className="hide-scrollbar">
        <SidebarGroup className="py-2">
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {Object.values(Tools).map((name) => {
                const IconComponent = toolIcons[name] || FileQuestion;
                const isActive = currentTool === name;
                const isLoading = progress.tool === name;

                return (
                  <SidebarMenuItem key={name}>
                    <SidebarMenuButton
                      onClick={() => handleClick(name)}
                      isActive={isActive}
                      tooltip={t(name)}
                      className={cn(
                        'relative h-10 px-[14px] transition-all duration-300',
                        isActive
                          ? 'bg-primary/10 text-primary hover:bg-primary/15 font-semibold'
                          : 'hover:bg-accent/50 text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <div className="flex items-center justify-center w-5 h-5 shrink-0">
                        <div className="relative">
                          <IconComponent
                            className={cn(
                              'w-4 h-4 transition-colors duration-200',
                              isActive
                                ? 'text-primary'
                                : 'text-muted-foreground',
                            )}
                          />
                          {isLoading && (
                            <LoaderCircle className="absolute inset-0 h-4 w-4 animate-spin text-primary opacity-70" />
                          )}
                        </div>
                      </div>
                      <span className="truncate ml-2 transition-opacity duration-300">
                        {t(name)}
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail
        onMouseDown={startResizing}
        onClickCapture={handleRailClick}
      />
    </Sidebar>
  );
}
