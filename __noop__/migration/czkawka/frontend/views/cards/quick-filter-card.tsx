/**
 * QuickFilterCard - 快速过滤器卡片
 * 提供常用的快速筛选选项
 */
import { useAtom, useAtomValue } from 'jotai';
import { Zap } from 'lucide-react';
import { currentToolAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { settingsAtom } from '@/nodes/czkawka/upstream/atom/settings';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tools } from '@/nodes/czkawka/upstream/consts';
import { useT } from '@/nodes/czkawka/upstream/hooks';

export function QuickFilterCard() {
  const t = useT();
  const [settings, setSettings] = useAtom(settingsAtom);
  const currentTool = useAtomValue(currentToolAtom);

  // 快速设置预设
  const presets = [
    { label: t('Strict' as any) || 'Strict', similarity: 5 },
    { label: t('Normal' as any) || 'Normal', similarity: 15 },
    { label: t('Loose' as any) || 'Loose', similarity: 30 },
  ];

  const handlePresetClick = (similarity: number) => {
    if (currentTool === Tools.SimilarImages) {
      setSettings((prev) => ({
        ...prev,
        similarImagesSubSimilarity: similarity,
      }));
    } else if (currentTool === Tools.SimilarVideos) {
      const videoSimilarity = Math.min(similarity, 20);
      setSettings((prev) => ({
        ...prev,
        similarVideosSubSimilarity: videoSimilarity,
      }));
    }
  };

  const handleIgnoreSameSizeChange = (checked: boolean) => {
    if (currentTool === Tools.SimilarImages) {
      setSettings((prev) => ({
        ...prev,
        similarImagesSubIgnoreSameSize: checked,
      }));
    } else if (currentTool === Tools.SimilarVideos) {
      setSettings((prev) => ({
        ...prev,
        similarVideosSubIgnoreSameSize: checked,
      }));
    }
  };

  const getIgnoreSameSize = () => {
    if (currentTool === Tools.SimilarImages) {
      return settings.similarImagesSubIgnoreSameSize;
    }
    if (currentTool === Tools.SimilarVideos) {
      return settings.similarVideosSubIgnoreSameSize;
    }
    return false;
  };

  // 只在相似图片/视频工具中显示
  if (
    currentTool !== Tools.SimilarImages &&
    currentTool !== Tools.SimilarVideos
  ) {
    return (
      <div className="p-2 text-sm text-muted-foreground text-center">
        Not available for this tool
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      {/* 预设按钮 */}
      <div className="space-y-1.5">
        <Label className="text-xs flex items-center gap-1">
          <Zap className="h-3 w-3" />
          Quick presets
        </Label>
        <div className="flex gap-2">
          {presets.map((preset) => (
            <Button
              key={preset.label}
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => handlePresetClick(preset.similarity)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </div>

      {/* 忽略相同大小 */}
      <div className="flex items-center justify-between">
        <Label className="text-xs">{t('Ignore same size')}</Label>
        <Switch
          checked={getIgnoreSameSize()}
          onCheckedChange={handleIgnoreSameSizeChange}
        />
      </div>
    </div>
  );
}
