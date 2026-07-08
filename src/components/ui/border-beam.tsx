/**
 * BorderBeam — 边框流光动画
 *
 * 在元素的边框上绘制一道沿四边循环流动的光带，
 * 适合用作「正在执行 / 加载中 / 高亮卡片」的视觉提示。
 *
 * 用法：
 *   <div className="relative">
 *     ...内容...
 *     <BorderBeam />
 *   </div>
 *
 * 必须放在 position: relative 的父容器中，组件本身 absolute 贴满父容器边框。
 *
 * Props：
 * - size: 光带长度（px，默认 200）
 * - duration: 一圈耗时（秒，默认 15）
 * - delay: 延迟开始（秒，默认 0）
 * - colorFrom / colorTo: 光带渐变两端的颜色（默认 primary / chart-2）
 * - borderWidth: 边框宽度（px，默认 1.5）
 * - reverse: 反向流动
 * - initialOffset: 起始偏移（0~100，默认 0）
 * - transition / className / style: 透传 motion 与 DOM
 *
 * 参考：magicui.design/docs/components/border-beam
 */
import { motion, type Transition } from "motion/react"
import { cn } from "@/lib/utils"

export interface BorderBeamProps {
  size?: number
  duration?: number
  delay?: number
  colorFrom?: string
  colorTo?: string
  transition?: Transition
  reverse?: boolean
  initialOffset?: number
  borderWidth?: number | string
  className?: string
  style?: React.CSSProperties
}

export function BorderBeam({
  className,
  size = 200,
  duration = 15,
  delay = 0,
  colorFrom = "var(--primary)",
  colorTo = "var(--chart-2)",
  transition,
  reverse = false,
  initialOffset = 0,
  borderWidth = 1.5,
  style,
}: BorderBeamProps) {
  return (
    <div
      role="presentation"
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 rounded-[inherit] border",
        className,
      )}
      style={{
        padding: borderWidth,
        mask: "linear-gradient(transparent, transparent) content-box, linear-gradient(white, white)",
        WebkitMaskComposite: "xor",
        maskComposite: "exclude",
        ...style,
      }}
    >
      <motion.div
        className="size-full"
        style={{
          background: `conic-gradient(from ${initialOffset}deg, transparent 0deg, ${colorFrom} ${size}deg, ${colorTo} ${size * 1.5}deg, transparent ${size * 2}deg)`,
        }}
        initial={{ rotate: reverse ? -360 : 0 }}
        animate={{ rotate: reverse ? 0 : 360 }}
        transition={
          transition ?? {
            duration,
            delay,
            repeat: Infinity,
            ease: "linear",
          }
        }
      />
    </div>
  )
}
