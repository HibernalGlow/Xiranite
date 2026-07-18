/**
 * FormatDonutChartCard - 格式分布环形图卡片
 * 显示文件格式分布的环形图
 */
import { filesize } from 'filesize';
import { motion } from 'motion/react';
import { useT } from '@/nodes/czkawka/upstream/hooks/use-t';
import { useFormatStats } from '@/nodes/czkawka/upstream/hooks/useFormatStats';

const COLORS = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#06b6d4', // cyan-500
  '#f97316', // orange-500
  '#14b8a6', // teal-500
  '#6366f1', // indigo-500
];

export function FormatDonutChartCard() {
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
    <div className="p-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 环形图 */}
        <div className="flex flex-col items-center justify-center">
          <div className="relative w-48 h-48">
            <svg
              viewBox="0 0 100 100"
              className="w-full h-full transform -rotate-90"
            >
              {stats.slice(0, 10).map((stat, i) => {
                const prevPercent = stats
                  .slice(0, i)
                  .reduce((sum, s) => sum + s.percent, 0);

                return (
                  <motion.circle
                    key={stat.format}
                    cx="50"
                    cy="50"
                    r="40"
                    fill="transparent"
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth="12"
                    strokeDasharray={`${stat.percent} ${100 - stat.percent}`}
                    strokeDashoffset={-prevPercent}
                    pathLength="100"
                    initial={{ opacity: 0, strokeDasharray: '0 100' }}
                    animate={{
                      opacity: 1,
                      strokeDasharray: `${stat.percent} ${100 - stat.percent}`,
                    }}
                    transition={{
                      duration: 1,
                      delay: i * 0.1,
                      ease: 'easeOut',
                    }}
                    strokeLinecap="butt"
                  />
                );
              })}
              {/* 内圆 */}
              <circle
                cx="50"
                cy="50"
                r="30"
                fill="currentColor"
                className="text-background"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold">{stats.length}</span>
              <span className="text-xs text-muted-foreground">
                {t('Formats')}
              </span>
            </div>
          </div>
        </div>

        {/* 图例 */}
        <div className="space-y-2">
          {stats.slice(0, 8).map((stat, i) => (
            <motion.div
              key={stat.format}
              className="flex items-center justify-between text-xs"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: COLORS[i % COLORS.length] }}
                />
                <span className="font-mono uppercase">{stat.format}</span>
              </div>
              <div className="flex gap-3 text-right">
                <span className="text-muted-foreground">{stat.count}</span>
                <span className="font-medium w-16">{filesize(stat.size)}</span>
              </div>
            </motion.div>
          ))}
          {stats.length > 8 && (
            <div className="text-center text-xs text-muted-foreground pt-1">
              +{stats.length - 8} more
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
