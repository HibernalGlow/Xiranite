// 瀑布流剩余空间的补位格子（自写件，非 reactbits 端口）。
// 六款动画类与 mosaicFiller 的 MOSAIC_ANIM_CLASSES 一一对应：共边格子必不同类，
// 所以相邻两块永远不是同一个动画。
import type { CSSProperties } from "react"
import { useId } from "react"

/** 六款动画类的序号，与 mosaicFiller 的 anim 字段同源。 */
export const MOSAIC_TILE_ANIM_COUNT = 6

/**
 * 关键帧一次注入即可（放在容器里，不是每块一份）。全部只动 transform / opacity，
 * 因为 WKWebView 上几十块常驻动画若动 background/box-shadow 会掉进主线程绘制。
 */
export const MOSAIC_TILE_KEYFRAMES = `
@keyframes xrn-mosaic-sheen{0%{transform:translate3d(-140%,-140%,0) rotate(8deg)}100%{transform:translate3d(140%,140%,0) rotate(8deg)}}
@keyframes xrn-mosaic-breathe{0%,100%{opacity:.28;transform:scale(.9)}50%{opacity:.72;transform:scale(1)}}
@keyframes xrn-mosaic-ring{to{transform:rotate(360deg)}}
@keyframes xrn-mosaic-bars{0%,100%{transform:translate3d(0,34%,0)}50%{transform:translate3d(0,-34%,0)}}
@keyframes xrn-mosaic-drift{0%{transform:translate3d(-16%,-12%,0)}33%{transform:translate3d(14%,8%,0)}66%{transform:translate3d(-6%,16%,0)}100%{transform:translate3d(-16%,-12%,0)}}
@keyframes xrn-mosaic-scan{0%{transform:translate3d(0,-60%,0)}100%{transform:translate3d(0,160%,0)}}
`

interface Pattern {
  /** 内层的背景（只用 var()/color-mix，皮肤重定义 token 即免费接管） */
  backgroundImage: string
  backgroundSize?: string
  animation: string
  blur?: number
  opacity?: number
}

const PATTERNS: readonly Pattern[] = [
  {
    // 0 · 斜向扫光
    backgroundImage:
      "linear-gradient(115deg, transparent 38%, color-mix(in oklch, var(--primary) 55%, transparent) 50%, transparent 62%)",
    animation: "xrn-mosaic-sheen 5.2s linear infinite",
  },
  {
    // 1 · 点阵呼吸
    backgroundImage:
      "radial-gradient(color-mix(in oklch, var(--muted-foreground) 60%, transparent) 1.2px, transparent 1.3px)",
    backgroundSize: "14px 14px",
    animation: "xrn-mosaic-breathe 6.4s ease-in-out infinite",
  },
  {
    // 2 · 锥形环旋转
    backgroundImage:
      "conic-gradient(from 0deg, transparent 0 55%, color-mix(in oklch, var(--chart-1) 70%, transparent) 78%, transparent 100%)",
    animation: "xrn-mosaic-ring 7.5s linear infinite",
    opacity: 0.75,
  },
  {
    // 3 · 竖条起伏
    backgroundImage:
      "repeating-linear-gradient(90deg, color-mix(in oklch, var(--chart-2) 45%, transparent) 0 3px, transparent 3px 12px)",
    animation: "xrn-mosaic-bars 5.8s ease-in-out infinite",
  },
  {
    // 4 · 双光斑漂移
    backgroundImage:
      "radial-gradient(closest-side, color-mix(in oklch, var(--chart-4) 60%, transparent), transparent), radial-gradient(closest-side at 70% 65%, color-mix(in oklch, var(--chart-5) 55%, transparent), transparent)",
    blur: 10,
    animation: "xrn-mosaic-drift 11s ease-in-out infinite",
  },
  {
    // 5 · 横向扫描线
    backgroundImage:
      "linear-gradient(180deg, transparent 44%, color-mix(in oklch, var(--primary) 45%, transparent) 50%, transparent 56%)",
    animation: "xrn-mosaic-scan 4.6s ease-in-out infinite",
  },
]

export interface MosaicFillerTileProps {
  anim: number
  style?: CSSProperties
  className?: string
  /** 由容器传入，避免每块格子各自订阅 reduced-motion */
  reducedMotion?: boolean
}

/** 一块装饰性格子。它不可交互、不进无障碍树（真正的空槽语义由容器说明）。 */
export function MosaicFillerTile({ anim, style, className = "", reducedMotion = false }: MosaicFillerTileProps) {
  const pattern = PATTERNS[((anim % MOSAIC_TILE_ANIM_COUNT) + MOSAIC_TILE_ANIM_COUNT) % MOSAIC_TILE_ANIM_COUNT]
  const gradientId = useId()

  return (
    <div
      aria-hidden
      className={`pointer-events-none relative overflow-hidden rounded-md border border-border/45 bg-muted/25 ${className}`}
      style={style}
    >
      <span
        key={gradientId}
        data-mosaic-anim={anim}
        className="absolute inset-[-18%]"
        style={{
          backgroundImage: pattern.backgroundImage,
          backgroundSize: pattern.backgroundSize,
          filter: pattern.blur ? `blur(${pattern.blur}px)` : undefined,
          opacity: pattern.opacity,
          animation: reducedMotion ? undefined : pattern.animation,
        }}
      />
      <span className="absolute inset-x-2 bottom-1.5 h-px bg-border/60" />
    </div>
  )
}
