/**
 * SimilarityFilterCard - 相似度过滤器卡片
 * 提供相似度快速筛选功能
 */
import { useAtom, useAtomValue } from 'jotai';
import { Percent } from 'lucide-react';
import { currentToolAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { settingsAtom } from '@/nodes/czkawka/upstream/atom/settings';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Tools } from '@/nodes/czkawka/upstream/consts';
import { useT } from '@/nodes/czkawka/upstream/hooks';

export function SimilarityFilterCard() {
  const t = useT();
  const [settings, setSettings] = useAtom(settingsAtom);
  const currentTool = useAtomValue(currentToolAtom);

  // 根据工具类型获取相似度设置
  const getSimilarityValue = () => {
    if (currentTool === Tools.SimilarImages) {
      return settings.similarImagesSubSimilarity;
    }
    if (currentTool === Tools.SimilarVideos) {
      return settings.similarVideosSubSimilarity;
    }
    return 0;
  };

  const getMaxValue = () => {
    if (currentTool === Tools.SimilarImages) return 40;
    if (currentTool === Tools.SimilarVideos) return 20;
    return 100;
  };

  const handleChange = (value: number[]) => {
    if (currentTool === Tools.SimilarImages) {
      setSettings((prev) => ({
        ...prev,
        similarImagesSubSimilarity: value[0],
      }));
    } else if (currentTool === Tools.SimilarVideos) {
      setSettings((prev) => ({
        ...prev,
        similarVideosSubSimilarity: value[0],
      }));
    }
  };

  const similarityValue = getSimilarityValue();
  const maxValue = getMaxValue();

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
      <div className="flex items-center justify-between">
        <Label className="text-xs flex items-center gap-1">
          <Percent className="h-3 w-3" />
          {t('Max difference')}
        </Label>
        <span className="text-xs text-muted-foreground">
          {similarityValue}/{maxValue}
        </span>
      </div>
      <Slider
        value={[similarityValue]}
        onValueChange={handleChange}
        min={0}
        max={maxValue}
        step={1}
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>More similar</span>
        <span>Less similar</span>
      </div>
    </div>
  );
}
