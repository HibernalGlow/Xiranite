import { useAtomValue } from 'jotai';
import { useEffect, useRef, useState } from 'react';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import {
  backgroundBlurAtom,
  backgroundEnabledAtom,
  backgroundImageAtom,
  backgroundOpacityAtom,
  sidebarWidthAtom,
} from '@/nodes/czkawka/upstream/atom/primitive';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppBody } from '@/nodes/czkawka/upstream/views/app-body';
import { AppHeader } from '@/nodes/czkawka/upstream/views/app-header';
import { AppSidebar } from '@/nodes/czkawka/upstream/views/app-sidebar';
import { BottomBar } from '@/nodes/czkawka/upstream/views/bottom-bar';
import { FloatingAnalysisPanel } from '@/nodes/czkawka/upstream/views/floating-analysis-panel';
import { FloatingFilterPanel } from '@/nodes/czkawka/upstream/views/floating-filter-panel';
import { SidebarImagePreview } from '@/nodes/czkawka/upstream/views/sidebar-image-preview';
import { SidebarVideoPreview } from '@/nodes/czkawka/upstream/views/sidebar-video-preview';

export default function App() {
  const sidebarWidth = useAtomValue(sidebarWidthAtom);
  const backgroundImage = useAtomValue(backgroundImageAtom);
  const backgroundEnabled = useAtomValue(backgroundEnabledAtom);
  const backgroundOpacity = useAtomValue(backgroundOpacityAtom);
  const backgroundBlur = useAtomValue(backgroundBlurAtom);

  const showBackground = backgroundImage && backgroundEnabled;
  const PANEL_SIZE = 30;
  const STORAGE_KEY = 'app-bottom-panel-size';
  const [bottomPanelMinSize, setBottomPanelMinSize] = useState(8);
  const [defaultBottomSize, setDefaultBottomSize] = useState<number>(() => {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(v) && v > 0) return Math.min(50, Math.max(6, v));
    return PANEL_SIZE;
  });
  const headerRef = useRef<HTMLDivElement>(null);
  const bottomPanelRef = useRef<ImperativePanelHandle>(null);

  const handleResetPanelSize = () => {
    if (bottomPanelRef.current) {
      bottomPanelRef.current.resize(PANEL_SIZE);
      localStorage.setItem(STORAGE_KEY, String(PANEL_SIZE));
    }
  };

  // 根据底栏头部高度动态限制底部面板最小高度，确保始终可容纳工具条
  useEffect(() => {
    const calc = () => {
      if (!headerRef.current) return;
      const headerHeight = headerRef.current.offsetHeight;
      const paddingY = 0.25 * 16 * 2; // py-1 上下各 0.25rem
      const total = headerHeight + paddingY;
      const screen =
        window.innerHeight || document.documentElement.clientHeight;
      const pct = Math.min(20, Math.max(6, (total / screen) * 100));
      setBottomPanelMinSize(pct);
    };

    const ro = new ResizeObserver(calc);
    if (headerRef.current) ro.observe(headerRef.current);
    ro.observe(document.body);
    window.addEventListener('resize', calc);
    calc();
    return () => {
      window.removeEventListener('resize', calc);
      ro.disconnect();
    };
  }, []);

  return (
    <div
      className="h-screen w-screen flex flex-col relative overflow-hidden"
      data-custom-bg={showBackground ? 'true' : undefined}
    >
      {/* 自定义背景图片层 */}
      {showBackground && (
        <div
          className="fixed inset-0 pointer-events-none z-0"
          style={{
            backgroundImage: `url(${backgroundImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            opacity: backgroundOpacity / 100,
            filter: backgroundBlur > 0 ? `blur(${backgroundBlur}px)` : 'none',
            transform: backgroundBlur > 0 ? 'scale(1.05)' : 'none',
          }}
        />
      )}
      <SidebarProvider
        style={
          { '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties
        }
      >
        <div className="flex flex-col h-full w-full overflow-hidden">
          <AppHeader />
          <div className="flex flex-1 overflow-hidden">
            <AppSidebar />
            <SidebarInset className="flex flex-col overflow-hidden bg-transparent">
              <TooltipProvider delayDuration={100} skipDelayDuration={90}>
                <ResizablePanelGroup
                  className="flex-1"
                  direction="vertical"
                  autoSaveId="app-layout"
                  onLayout={(sizes) => {
                    const bottom = sizes[sizes.length - 1] ?? PANEL_SIZE;
                    localStorage.setItem(STORAGE_KEY, String(bottom));
                    setDefaultBottomSize(bottom);
                  }}
                >
                  <ResizablePanel>
                    <AppBody />
                  </ResizablePanel>
                  <ResizableHandle onDoubleClick={handleResetPanelSize} />
                  <ResizablePanel
                    ref={bottomPanelRef}
                    defaultSize={defaultBottomSize}
                    minSize={bottomPanelMinSize}
                    maxSize={80}
                  >
                    <BottomBar headerRef={headerRef} />
                  </ResizablePanel>
                </ResizablePanelGroup>
              </TooltipProvider>
            </SidebarInset>
          </div>
        </div>
      </SidebarProvider>
      <Toaster />
      <SidebarImagePreview />
      <SidebarVideoPreview />
      <FloatingFilterPanel />
      <FloatingAnalysisPanel />
    </div>
  );
}
