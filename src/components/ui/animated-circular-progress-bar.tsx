/**
 * AnimatedCircularProgressBar — 环形进度条
 *
 * SVG 圆环 + motion 动画 strokeDashoffset，
 * 用于替代手写 ProgressRing，提供标准化的进度可视化。
 *
 * 用法：
 *   <AnimatedCircularProgressBar value={66} max={100} min={0} />
 *
 * Props：
 * - value: 当前值
 * - max: 最大值（默认 100）
 * - min: 最小值（默认 0）
 * - gaugePrimaryColor: 进度色（默认 var(--primary)）
 * - gaugeSecondaryColor: 轨道色（默认 var(--muted)）
 * - className: 透传（用于控制尺寸，如 "size-24"）
 *
 * 参考：magicui.design/docs/components/animated-circular-progress-bar
 */
import { motion } from "motion/react"
import { cn } from "@/lib/utils"

export interface AnimatedCircularProgressBarProps {
  value: number
  max?: number
  min?: number
  gaugePrimaryColor?: string
  gaugeSecondaryColor?: string
  className?: string
}

export function AnimatedCircularProgressBar({
  value = 0,
  max = 100,
  min = 0,
  gaugePrimaryColor = "var(--primary)",
  gaugeSecondaryColor = "var(--muted)",
  className,
}: AnimatedCircularProgressBarProps) {
  const circumference = 2 * Math.PI * 45
  const clamped = Math.min(Math.max(value, min), max)
  const percent = max === min ? 0 : (clamped - min) / (max - min)
  const offset = circumference - percent * circumference

  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={min}
      aria-valuemax={max}
      className={cn("relative grid place-items-center", className)}
    >
      <svg
        viewBox="0 0 100 100"
        className="size-full -rotate-90"
        aria-hidden="true"
      >
        <title>progress</title>
        <circle
          cx="50"
          cy="50"
          r="45"
          stroke={gaugeSecondaryColor}
          strokeWidth="8"
          fill="none"
        />
        <motion.circle
          cx="50"
          cy="50"
          r="45"
          stroke={gaugePrimaryColor}
          strokeWidth="8"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ type: "spring", stiffness: 60, damping: 18 }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-sm font-semibold tabular-nums">
        {Math.round(percent * 100)}%
      </div>
    </div>
  )
}
