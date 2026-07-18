/**
 * SimilarityDistributionCard - 相似度分布卡片
 * 显示相似度分布的条形图
 */
import { motion } from 'motion/react';
import { useT } from '@/nodes/czkawka/upstream/hooks/use-t';
import { useSimilarityStats } from '@/nodes/czkawka/upstream/hooks/useSimilarityStats';
import { getSimilarityLevelText } from '@/nodes/czkawka/upstream/utils/similarity-utils';

const SIMILARITY_COLORS: Record<string, string> = {
  Original: '#9333ea', // purple-600
  VeryHigh: '#dc2626', // red-600
  High: '#ea580c', // orange-600
  Medium: '#ca8a04', // yellow-600
  Small: '#2563eb', // blue-600
  VerySmall: '#16a34a', // green-600
  Minimal: '#4b5563', // gray-600
};

export function SimilarityDistributionCard() {
  const similarityStats = useSimilarityStats();
  const t = useT();

  if (!similarityStats || similarityStats.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        {t('No similarity data available')}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-2">
        <div className="w-1 h-3 bg-primary rounded-full" />
        {t('Similarity distribution')}
      </h4>
      <div className="space-y-2">
        {similarityStats.map((stat, i) => (
          <div key={stat.level} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="font-medium">
                {t(getSimilarityLevelText(stat.level) as any)} ({stat.count})
              </span>
              <span className="text-muted-foreground">
                {stat.percent.toFixed(1)}%
              </span>
            </div>
            <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
              <motion.div
                className="h-full"
                style={{
                  backgroundColor: SIMILARITY_COLORS[stat.level] || '#6b7280',
                }}
                initial={{ width: 0 }}
                animate={{ width: `${stat.percent}%` }}
                transition={{ duration: 0.8, delay: 0.1 + i * 0.05 }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
