import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { currentToolAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { settingsAtom } from '@/nodes/czkawka/upstream/atom/settings';
import { currentToolDataAtom } from '@/nodes/czkawka/upstream/atom/tools';
import { Tools } from '@/nodes/czkawka/upstream/consts';
import { getSimilarityLevel, SimilarityLevel } from '@/nodes/czkawka/upstream/utils/similarity-utils';

export interface SimilarityStat {
  level: SimilarityLevel;
  count: number;
  percent: number;
}

export function useSimilarityStats() {
  const data = useAtomValue(currentToolDataAtom);
  const settings = useAtomValue(settingsAtom);
  const currentTool = useAtomValue(currentToolAtom);

  return useMemo(() => {
    // 只有相似图片和相似视频工具才有相似度数据
    if (
      currentTool !== Tools.SimilarImages &&
      currentTool !== Tools.SimilarVideos
    ) {
      return null;
    }

    if (!data || !Array.isArray(data) || data.length === 0) {
      return null;
    }

    const statsMap = new Map<SimilarityLevel, number>();
    let total = 0;
    let hasSimilarity = false;

    const hashSize =
      currentTool === Tools.SimilarImages
        ? Number.parseInt(settings.similarImagesSubHashSize || '16', 10)
        : 16;

    for (const item of data as any[]) {
      // 跳过隐藏行（分隔符）和参考行（原始图片）
      if (item.hidden || item.isRef) continue;

      // 尝试从多个可能的字段获取相似度值
      // 优先使用 item.similarity（转换后的值），然后是 raw.similarity
      let rawSimValue: any =
        item.similarity ?? item.raw?.similarity ?? item.Similarity;

      // 空字符串表示相似度为0（完全相同的图片）
      if (rawSimValue === undefined || rawSimValue === null) {
        continue;
      }

      let simValue: number;
      if (rawSimValue === '') {
        // 空字符串表示相似度为0
        simValue = 0;
      } else if (typeof rawSimValue === 'number') {
        simValue = rawSimValue;
      } else {
        // 解析字符串: "15 (Diff)" -> 15, "10" -> 10
        const match = rawSimValue.toString().match(/\d+/);
        simValue = match ? Number.parseInt(match[0], 10) : Number.NaN;
      }

      if (Number.isNaN(simValue)) {
        continue;
      }

      // Count the item
      hasSimilarity = true;
      const level = getSimilarityLevel(simValue, hashSize);
      statsMap.set(level, (statsMap.get(level) || 0) + 1);
      total++;
    }

    if (!hasSimilarity) {
      return null;
    }

    const levels = [
      SimilarityLevel.Original,
      SimilarityLevel.VeryHigh,
      SimilarityLevel.High,
      SimilarityLevel.Medium,
      SimilarityLevel.Small,
      SimilarityLevel.VerySmall,
      SimilarityLevel.Minimal,
    ];

    const result = levels
      .map((level) => ({
        level,
        count: statsMap.get(level) || 0,
        percent: total > 0 ? ((statsMap.get(level) || 0) / total) * 100 : 0,
      }))
      .filter((stat) => stat.count > 0);

    return result;
  }, [data, settings.similarImagesSubHashSize, currentTool]);
}
