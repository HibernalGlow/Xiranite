import { getCurrentWindow } from '@/nodes/czkawka/upstream/adapters/tauri-window';
import { openUrl } from '@/nodes/czkawka/upstream/adapters/tauri-opener';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  FolderTree,
  ImageIcon,
  Images,
  Languages,
  Minus,
  Search,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDebouncedCallback } from 'use-debounce';
import {
  backgroundBlurAtom,
  backgroundEnabledAtom,
  backgroundImageAtom,
  backgroundOpacityAtom,
  currentToolAtom,
  maskOpacityAtom,
  searchInputValueAtom,
} from '@/nodes/czkawka/upstream/atom/primitive';
import {
  setBackgroundBlurAtom,
  setBackgroundEnabledAtom,
  setBackgroundImageAtom,
  setBackgroundOpacityAtom,
  setMaskOpacityAtom,
} from '@/nodes/czkawka/upstream/atom/theme';
import { currentToolFilterAtom, similarImagesViewModeAtom } from '@/nodes/czkawka/upstream/atom/tools';
import { Select, Slider, TooltipButton, toastError } from '@/nodes/czkawka/upstream/components';
import { GitHub } from '@/nodes/czkawka/upstream/components/icons';
import { SelectIconTrigger } from '@/nodes/czkawka/upstream/components/one-select';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Switch } from '@/components/ui/switch';
import { Tools } from '@/nodes/czkawka/upstream/consts';
import { useT, useTableSelectionStats } from '@/nodes/czkawka/upstream/hooks';
import { storage } from '@/nodes/czkawka/upstream/utils/storage';
import { SettingsButton } from './settings';
import { ThemeToggle } from './theme-toggle';

// 新增 selectionStats props，便于顶栏显示统计信息
export function AppHeader() {
  const selectionStats = useTableSelectionStats();
  const setFilter = useSetAtom(currentToolFilterAtom);
  const [inputValue, setInputValue] = useAtom(searchInputValueAtom);
  const debouncedSetFilter = useDebouncedCallback(setFilter, 300);
  const t = useT();
  const [searchExpanded, setSearchExpanded] = useState(!!inputValue);

  // 相似图片视图切换
  const currentTool = useAtomValue(currentToolAtom);
  const [viewMode, setViewMode] = useAtom(similarImagesViewModeAtom);
  const isSimilarImages = currentTool === Tools.SimilarImages;

  const handleInputChange = (v: string) => {
    setInputValue(v);
    debouncedSetFilter(v.trim());
  };

  return (
    <header
      className="w-full h-10 flex justify-between items-center px-3 py-0 border-b border-border/40 dark:border-border/60 bg-background/95 z-50 select-none relative transition-all duration-300"
      data-tauri-drag-region
    >
      {/* 这里的子元素需要标记为 no-drag，否则由于 z-index 提升可能导致点击失效或拖拽失效 */}

      {/* 左侧区域：侧边栏切换与统计信息 */}
      <div className="flex items-center gap-2 no-drag min-w-0 flex-shrink-0">
        <SidebarTrigger
          className="h-8 w-8 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          title={t('Toggle Sidebar')}
        />

        {/* 相似图片视图切换按钮 */}
        {isSimilarImages && (
          <div className="flex items-center gap-0.5 bg-muted/40 p-0.5 rounded-full border border-border/40">
            <button
              onClick={() => setViewMode('images')}
              className={`flex items-center justify-center h-6 w-6 rounded-full transition-colors ${
                viewMode === 'images'
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-accent hover:text-accent-foreground text-muted-foreground'
              }`}
              title={t('Similar images list')}
            >
              <Images className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode('folders')}
              className={`flex items-center justify-center h-6 w-6 rounded-full transition-colors ${
                viewMode === 'folders'
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-accent hover:text-accent-foreground text-muted-foreground'
              }`}
              title={t('Folder statistics')}
            >
              <FolderTree className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="flex items-center pointer-events-none hidden sm:flex">
          {selectionStats && (
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground/80 bg-muted/20 border border-border/30 rounded-full px-3 py-0.5 pointer-events-auto">
              <span className="truncate">已选 {selectionStats.count}</span>
              <span className="opacity-30">|</span>
              <span className="truncate">
                {formatSize(selectionStats.totalSize)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 中间：核心控制区 (搜索, 背景, 明暗, 语言) - 绝对居中 */}
      <div className="absolute left-1/2 -translate-x-1/2 z-10 flex items-center gap-0.5 bg-muted/40 p-0.5 rounded-full border border-border/40 no-drag shadow-sm backdrop-blur-sm">
        <div
          className={`flex items-center transition-all duration-300 ease-out overflow-hidden ${searchExpanded ? 'w-48 px-1' : 'w-8'}`}
        >
          {searchExpanded ? (
            <div className="relative w-full">
              <input
                autoFocus
                type="text"
                placeholder={`${t('search')}...`}
                value={inputValue}
                onChange={(e) => handleInputChange(e.target.value)}
                onBlur={() => !inputValue && setSearchExpanded(false)}
                className="w-full h-8 pl-8 pr-2 text-xs bg-transparent outline-none border-none placeholder:text-muted-foreground/50"
              />
              <Search className="absolute left-2 top-[9px] h-3.5 w-3.5 text-muted-foreground/60" />
            </div>
          ) : (
            <button
              onClick={() => setSearchExpanded(true)}
              className="flex items-center justify-center h-8 w-8 rounded-md transition-colors hover:bg-accent hover:text-accent-foreground text-muted-foreground"
              title={t('search')}
            >
              <Search className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="w-[1px] h-4 bg-border/40 mx-0.5" />

        <BackgroundButton />
        <ThemeToggle size="sm" className="text-muted-foreground" />
        <ChangeLanguageButton />
        <SettingsButton size="sm" className="text-muted-foreground" />
      </div>

      {/* 右侧：窗口控制 */}
      <div className="flex justify-end items-center pl-4 relative z-10 no-drag">
        <WindowControls />
      </div>
    </header>
  );
}

function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);
  const appWindow = getCurrentWindow();

  return (
    <div className="flex items-center h-full -mr-2 relative z-50 no-drag">
      <button
        onClick={() => appWindow.minimize()}
        className="w-11 h-10 flex items-center justify-center hover:bg-muted/80 transition-colors pointer-events-auto"
        title="Minimize"
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        onClick={async () => {
          await appWindow.toggleMaximize();
          setIsMaximized(await appWindow.isMaximized());
        }}
        className="w-11 h-10 flex items-center justify-center hover:bg-muted/80 transition-colors pointer-events-auto"
        title={isMaximized ? 'Restore' : 'Maximize'}
      >
        <Square className="h-3 w-3" />
      </button>
      <button
        onClick={() => appWindow.close()}
        className="w-11 h-10 flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors pointer-events-auto"
        title="Close"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// 文件大小格式化
function formatSize(size: number): string {
  if (size >= 1024 * 1024 * 1024)
    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(2)} KB`;
  return `${size} B`;
}

function BackgroundButton() {
  const t = useT();
  const backgroundImage = useAtomValue(backgroundImageAtom);
  const backgroundOpacity = useAtomValue(backgroundOpacityAtom);
  const backgroundBlur = useAtomValue(backgroundBlurAtom);
  const maskOpacity = useAtomValue(maskOpacityAtom);
  const backgroundEnabled = useAtomValue(backgroundEnabledAtom);
  const setBackgroundImage = useSetAtom(setBackgroundImageAtom);
  const setBackgroundEnabled = useSetAtom(setBackgroundEnabledAtom);
  const setBackgroundOpacity = useSetAtom(setBackgroundOpacityAtom);
  const setBackgroundBlur = useSetAtom(setBackgroundBlurAtom);
  const setMaskOpacity = useSetAtom(setMaskOpacityAtom);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toastError(t('File too large'), t('Maximum file size is 5MB'));
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setBackgroundImage(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleRemove = () => {
    setBackgroundImage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex items-center justify-center h-8 w-8 rounded-md transition-colors hover:bg-accent hover:text-accent-foreground text-muted-foreground"
          title={t('Custom background')}
        >
          <ImageIcon className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-64 p-3"
        align="end"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuLabel className="px-0 py-0 mb-4 flex items-center justify-between">
          <span>{t('Custom background')}</span>
          <div
            className="flex items-center gap-2"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Switch
              id="bg-enable"
              checked={backgroundEnabled}
              onCheckedChange={setBackgroundEnabled}
            />
          </div>
        </DropdownMenuLabel>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          className="hidden"
        />

        <div
          className="flex gap-2 mb-3"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => fileInputRef.current?.click()}
          >
            {t('Upload image')}
          </Button>
          {backgroundImage && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={handleRemove}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>

        {backgroundImage && (
          <div
            className={`h-20 w-full overflow-hidden rounded border mb-3 transition-opacity ${backgroundEnabled ? 'opacity-100' : 'opacity-40 grayscale'}`}
          >
            <img
              src={backgroundImage}
              alt="Background"
              className="h-full w-full object-cover"
              style={{
                opacity: backgroundOpacity / 100,
                filter:
                  backgroundBlur > 0 ? `blur(${backgroundBlur / 4}px)` : 'none',
              }}
            />
          </div>
        )}

        <DropdownMenuSeparator />

        <div
          className="space-y-2 pt-2"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between text-xs">
            <span>{t('Background opacity')}</span>
            <span className="text-muted-foreground">{backgroundOpacity}%</span>
          </div>
          <Slider
            value={[backgroundOpacity]}
            onValueChange={(values) => setBackgroundOpacity(values[0])}
            min={0}
            max={100}
            step={5}
          />
        </div>

        <div
          className="space-y-2 pt-4"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between text-xs">
            <span>{t('Background blur')}</span>
            <span className="text-muted-foreground">{backgroundBlur}px</span>
          </div>
          <Slider
            value={[backgroundBlur]}
            onValueChange={(values) => setBackgroundBlur(values[0])}
            min={0}
            max={20}
            step={1}
          />
        </div>

        <div
          className="space-y-2 pt-4"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between text-xs">
            <span>{t('Mask opacity')}</span>
            <span className="text-muted-foreground">{maskOpacity}%</span>
          </div>
          <Slider
            value={[maskOpacity]}
            onValueChange={(values) => setMaskOpacity(values[0])}
            min={0}
            max={100}
            step={5}
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ChangeLanguageButton() {
  const { i18n } = useTranslation();
  const t = useT();
  const [value, setValue] = useState(i18n.language);

  const handleLanguageChange = (v: string) => {
    setValue(v);
    i18n.changeLanguage(v);
    storage.setLanguage(v);
    document.documentElement.lang = v;
  };

  const options = [
    { label: 'English', value: 'en' },
    { label: '简体中文', value: 'zh' },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex items-center justify-center h-8 w-8 rounded-md transition-colors hover:bg-accent hover:text-accent-foreground text-muted-foreground"
          title={t('Change language')}
        >
          <Languages className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-32">
        <DropdownMenuLabel>{t('Language')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={handleLanguageChange}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              className="text-xs"
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
