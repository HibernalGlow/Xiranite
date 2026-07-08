/**
 * NumberTicker — 数字 count-up 动画
 *
 * 基于 motion 的 useMotionValue + useSpring + useTransform，
 * 让数字从 startValue（默认 0）平滑增长到 value。
 *
 * 用法：
 *   <NumberTicker value={1234} />
 *   <NumberTicker value={66.67} decimalPlaces={2} />
 *   <NumberTicker value={100} direction="down" />
 *
 * Props：
 * - value: 目标数值
 * - direction: "up"（默认，从 startValue 增长到 value）| "down"（从 startValue 下降到 value）
 * - delay: 延迟开始（秒）
 * - decimalPlaces: 保留小数位（默认 0）
 * - startValue: 起始值（默认 0；direction="down" 时默认为 value*2）
 * - className / style: 透传
 *
 * 参考：magicui.design/docs/components/number-ticker
 */
import { useEffect, useRef } from "react"
import {
  useMotionValue,
  useSpring,
  useTransform,
  animate,
  type MotionValue,
} from "motion/react"
import { cn } from "@/lib/utils"

export interface NumberTickerProps {
  value: number
  direction?: "up" | "down"
  delay?: number
  decimalPlaces?: number
  startValue?: number
  className?: string
  style?: React.CSSProperties
}

export function NumberTicker({
  value,
  direction = "up",
  delay = 0,
  decimalPlaces = 0,
  startValue,
  className,
  style,
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const initial = startValue ?? (direction === "down" ? value * 2 : 0)
  const motionValue = useMotionValue(initial)
  const springValue = useSpring(motionValue, {
    damping: 60,
    stiffness: 100,
  })

  useEffect(() => {
    const timeout = setTimeout(() => {
      animate(motionValue, value, {
        type: "spring",
        stiffness: 100,
        damping: 60,
        duration: 2,
      })
    }, delay * 1000)
    return () => clearTimeout(timeout)
  }, [motionValue, value, delay])

  useEffect(() => {
    const unsub = springValue.on("change", (latest) => {
      if (ref.current) {
        ref.current.textContent = Intl.NumberFormat("en-US", {
          minimumFractionDigits: decimalPlaces,
          maximumFractionDigits: decimalPlaces,
        }).format(Number(latest.toFixed(decimalPlaces)))
      }
    })
    return () => unsub()
  }, [springValue, decimalPlaces])

  return (
    <span ref={ref} className={cn("inline-block tabular-nums", className)} style={style}>
      {Intl.NumberFormat("en-US", {
        minimumFractionDigits: decimalPlaces,
        maximumFractionDigits: decimalPlaces,
      }).format(initial)}
    </span>
  )
}

// 暴露 MotionValue 以便高级用法（如绑定到其他动画）
export { useMotionValue, useSpring, useTransform, type MotionValue }
