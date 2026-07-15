/**
 * FormatBarChartCard - 格式大小条形图卡片
 * 显示文件格式大小分布的条形图
 */
import { filesize } from 'filesize';
import { motion } from 'motion/react';
import { useT } from '@/nodes/czkawka/upstream/hooks/use-t';
import { useFormatStats } from '@/nodes/czkawka/upstream/hooks/useFormatStats';

export function FormatBarChartCard() {
  const stats = useFormatStats();
  const t = useT();

  if (!stats || stats.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        {t('No data available')}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-2">
        <div className="w-1 h-3 bg-primary rounded-full" />
        {t('Size distribution')}
      </h4>
      <div className="space-y-2">
        {stats.slice(0, 10).map((stat, i) => (
          <div key={stat.format} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="uppercase font-medium">{stat.format}</span>
              <span className="text-muted-foreground">
                {filesize(stat.size)} ({stat.percent.toFixed(1)}%)
              </span>
            </div>
            <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-primary"
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
