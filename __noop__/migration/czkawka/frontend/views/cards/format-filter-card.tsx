/**
 * FormatFilterCard - 格式筛选卡片
 * 通过 Badge 展示所有文件格式，支持点击筛选
 */
import { useAtom, useSetAtom } from 'jotai';
import {
  Archive,
  CheckSquare,
  File,
  FileText,
  Folder,
  Image,
  Music,
  Square,
  Video,
} from 'lucide-react';
import { useMemo } from 'react';
import {
  type FormatCategory,
  formatFilterAtom,
  selectAllFormatsAtom,
  toggleCategoryAtom,
  toggleFormatAtom,
} from '@/nodes/czkawka/upstream/atom/format-filter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import { useFormatStats } from '@/nodes/czkawka/upstream/hooks/useFormatStats';
import { EXTENSION_PRESETS } from '@/nodes/czkawka/upstream/lib/filter-panel/utils';
import { cn } from '@/nodes/czkawka/upstream/utils/cn';

// 分类配置
const CATEGORY_CONFIG: Record<
  FormatCategory,
  {
    labelKey: string;
    icon: React.ComponentType<{ className?: string }>;
    extensions: readonly string[];
  }
> = {
  images: {
    labelKey: 'Images',
    icon: Image,
    extensions: EXTENSION_PRESETS.images,
  },
  videos: {
    labelKey: 'Videos',
    icon: Video,
    extensions: EXTENSION_PRESETS.videos,
  },
  audio: {
    labelKey: 'Audio',
    icon: Music,
    extensions: EXTENSION_PRESETS.audio,
  },
  documents: {
    labelKey: 'Documents',
    icon: FileText,
    extensions: EXTENSION_PRESETS.documents,
  },
  archives: {
    labelKey: 'Archives',
    icon: Archive,
    extensions: EXTENSION_PRESETS.archives,
  },
  folders: {
    labelKey: 'Folder',
    icon: Folder,
    extensions: [],
  },
  other: {
    labelKey: 'Other',
    icon: File,
    extensions: [],
  },
};

// 获取格式的分类
function getFormatCategory(format: string): FormatCategory {
  if (format === 'folder' || format === '文件夹') return 'folders';
  for (const [category, config] of Object.entries(CATEGORY_CONFIG)) {
    if (config.extensions.includes(format.toLowerCase())) {
      return category as FormatCategory;
    }
  }
  return 'other';
}

export function FormatFilterCard() {
  const t = useT();
  const stats = useFormatStats();
  const [filterState, setFilterState] = useAtom(formatFilterAtom);
  const toggleFormat = useSetAtom(toggleFormatAtom);
  const toggleCategory = useSetAtom(toggleCategoryAtom);
  const selectAll = useSetAtom(selectAllFormatsAtom);

  // 按分类分组格式
  const categorizedFormats = useMemo(() => {
    if (!stats || stats.length === 0)
      return new Map<FormatCategory, typeof stats>();

    const grouped = new Map<FormatCategory, typeof stats>();

    for (const stat of stats) {
      const category = getFormatCategory(stat.format);
      if (!grouped.has(category)) {
        grouped.set(category, []);
      }
      grouped.get(category)!.push(stat);
    }

    return grouped;
  }, [stats]);

  // 获取所有格式用于全选/全不选
  const allFormats = useMemo(() => stats?.map((s) => s.format) || [], [stats]);

  // 检查格式是否被排除
  const isFormatExcluded = (format: string) =>
    filterState.excludedFormats.includes(format);

  // 检查分类是否被排除
  const isCategoryExcluded = (category: FormatCategory) =>
    filterState.excludedCategories.includes(category);

  // 检查是否全选
  const isAllSelected =
    filterState.excludedFormats.length === 0 &&
    filterState.excludedCategories.length === 0;

  // 处理全选
  const handleSelectAll = () => {
    selectAll();
  };

  // 处理全不选
  const handleExcludeAll = () => {
    setFilterState({
      excludedFormats: [...allFormats],
      excludedCategories: Object.keys(CATEGORY_CONFIG) as FormatCategory[],
    });
  };

  if (!stats || stats.length === 0) {
    return (
      <div className="p-2 text-center text-muted-foreground text-xs">
        {t('No data available')}
      </div>
    );
  }

  // 按分类顺序渲染
  const categoryOrder: FormatCategory[] = [
    'images',
    'videos',
    'audio',
    'documents',
    'archives',
    'folders',
    'other',
  ];

  return (
    <div className="flex flex-col h-full gap-1">
      {/* 操作按钮 */}
      <div className="flex items-center gap-1 px-1 flex-shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs gap-1"
          onClick={handleSelectAll}
          disabled={isAllSelected}
        >
          <CheckSquare className="h-3 w-3" />
          {t('Select all')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs gap-1"
          onClick={handleExcludeAll}
        >
          <Square className="h-3 w-3" />
          {t('Clear')}
        </Button>
      </div>

      {/* 格式列表 */}
      <ScrollArea className="flex-1">
        <div className="space-y-2 px-1 pb-1">
          {categoryOrder.map((category) => {
            const formats = categorizedFormats.get(category);
            if (!formats || formats.length === 0) return null;

            const config = CATEGORY_CONFIG[category];
            const Icon = config.icon;
            const categoryExcluded = isCategoryExcluded(category);

            return (
              <div key={category} className="space-y-1">
                {/* 分类标题 */}
                <div
                  className={cn(
                    'flex items-center gap-1 text-xs cursor-pointer hover:bg-accent/50 rounded px-1 py-0.5 transition-colors',
                    categoryExcluded && 'opacity-50',
                  )}
                  onClick={() => toggleCategory(category)}
                >
                  <Icon className="h-3 w-3" />
                  <span className="font-medium">
                    {t(config.labelKey as any)}
                  </span>
                  <span className="text-muted-foreground">
                    ({formats.length})
                  </span>
                </div>

                {/* 格式 Badge 列表 */}
                {!categoryExcluded && (
                  <div className="flex flex-wrap gap-1 pl-4">
                    {formats.map((stat) => {
                      const excluded = isFormatExcluded(stat.format);
                      return (
                        <Badge
                          key={stat.format}
                          variant={excluded ? 'outline' : 'secondary'}
                          className={cn(
                            'cursor-pointer text-[10px] px-1.5 py-0 h-5 transition-all',
                            excluded && 'line-through opacity-50',
                            !excluded && 'hover:bg-primary/20',
                          )}
                          onClick={() => toggleFormat(stat.format)}
                        >
                          .{stat.format}
                          <span className="ml-1 text-muted-foreground">
                            {stat.count}
                          </span>
                        </Badge>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
