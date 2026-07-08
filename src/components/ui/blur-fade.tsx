/**
 * BlurFade — 模糊淡入动画
 *
 * 元素从「偏移 + 模糊 + 透明」过渡到「原位 + 清晰 + 不透明」，
 * 适合页面/卡片/视图切换时的入场动画。
 *
 * 用法：
 *   <BlurFade>...</BlurFade>
 *   <BlurFade delay={0.2} direction="up">...</BlurFade>
 *   <BlurFade inView>...</BlurFade>  // 滚动进入视口才触发
 *
 * Props：
 * - children / className / style
 * - variant: "spring"（默认）| "smooth"（用 tween）
 * - duration / delay（秒）
 * - offset: 偏移距离（px，默认 24）
 * - direction: "up"|"down"|"left"|"right"（默认 "bottom" → 向上飘入）| "none"
 * - inView: 是否在进入视口时才触发（默认 false，立即播放）
 * - inViewMargin: 进入视口的判定边距（rootMargin，默认 "0px"）
 * - blur: 初始模糊（px，默认 6）
 *
 * 参考：magicui.design/docs/components/blur-fade
 */
import { motion, type Variants } from "motion/react"
import { cn } from "@/lib/utils"

export type BlurFadeDirection = "up" | "down" | "left" | "right" | "none" | "bottom" | "top"

export interface BlurFadeProps {
  children: React.ReactNode
  className?: string
  variant?: "spring" | "smooth"
  duration?: number
  delay?: number
  offset?: number
  direction?: BlurFadeDirection
  inView?: boolean
  inViewMargin?: string
  blur?: number
  style?: React.CSSProperties
}

function offsetFor(direction: BlurFadeDirection, offset: number) {
  switch (direction) {
    case "up":
    case "bottom":
      return { y: offset }
    case "down":
    case "top":
      return { y: -offset }
    case "left":
      return { x: offset }
    case "right":
      return { x: -offset }
    case "none":
    default:
      return {}
  }
}

export function BlurFade({
  children,
  className,
  variant = "spring",
  duration = 0.4,
  delay = 0,
  offset = 24,
  direction = "bottom",
  inView = false,
  inViewMargin = "0px",
  blur = 6,
  style,
}: BlurFadeProps) {
  const initial = { opacity: 0, filter: `blur(${blur}px)`, ...offsetFor(direction, offset) }
  const animateTarget = { opacity: 1, filter: "blur(0px)", x: 0, y: 0 }

  const variants: Variants = {
    hidden: initial,
    visible: {
      ...animateTarget,
      transition:
        variant === "spring"
          ? { duration, delay, type: "spring", stiffness: 200, damping: 20 }
          : { duration, delay, ease: "easeOut" },
    },
  }

  return (
    <motion.div
      className={cn(className)}
      style={style}
      initial="hidden"
      variants={variants}
      {...(inView
        ? {
            whileInView: "visible",
            viewport: { once: true, margin: inViewMargin as unknown as undefined },
          }
        : { animate: "visible" })}
    >
      {children}
    </motion.div>
  )
}
