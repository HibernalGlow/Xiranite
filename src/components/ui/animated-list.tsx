/**
 * AnimatedList — 列表逐项入场动画
 *
 * 包裹一组子元素，让每个子元素按 delay 间隔依次滑入。
 * 使用 AnimatePresence 支持新增/移除动画。
 *
 * 用法：
 *   <AnimatedList delay={0.1}>
 *     {items.map((item) => (
 *       <AnimatedList.Item key={item.id}>...</AnimatedList.Item>
 *     ))}
 *   </AnimatedList>
 *
 * Props：
 * - className / delay: 每项之间额外延迟（秒，默认 0.05）
 *
 * AnimatedList.Item Props：
 * - children / className
 * - delay: 覆盖父级的单项延迟
 *
 * 参考：magicui.design/docs/components/animated-list
 */
import { AnimatePresence, motion } from "motion/react"
import { cn } from "@/lib/utils"

export interface AnimatedListProps {
  children: React.ReactNode
  className?: string
  delay?: number
}

export function AnimatedList({ children, className, delay = 0.05 }: AnimatedListProps) {
  return (
    <div className={cn("flex flex-col", className)}>
      <AnimatePresence initial={false}>
        {Array.isArray(children) ? children.map((child, index) => {
          if (!child) return null
          return (
            <motion.div
              key={(child as { key?: React.Key })?.key ?? index}
              initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
              animate={{
                opacity: 1,
                y: 0,
                filter: "blur(0px)",
                transition: { delay: index * delay, duration: 0.3, ease: "easeOut" },
              }}
              exit={{ opacity: 0, y: -8, filter: "blur(4px)", transition: { duration: 0.2 } }}
              layout
            >
              {child}
            </motion.div>
          )
        }) : (
          <motion.div
            initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.3 } }}
            exit={{ opacity: 0, y: -8, filter: "blur(4px)", transition: { duration: 0.2 } }}
            layout
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
