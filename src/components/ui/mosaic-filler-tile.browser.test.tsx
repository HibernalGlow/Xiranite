import { afterEach, describe, expect, it } from "vitest"
import { render } from "vitest-browser-react"

import {
  MOSAIC_TILE_ANIM_COUNT,
  MOSAIC_TILE_KEYFRAMES,
  MosaicFillerTile,
} from "./mosaic-filler-tile"

// 只有浏览器能看见的那一类缺陷：animation-name 写了、@keyframes 没落地 ⇒ 一堆静止的哑方块，
// 纯逻辑单测完全无感（star-border 当初就是这么静默过关的）。
function layers(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-mosaic-anim]"))
}

function animationNames(): string[] {
  return layers().map((el) => getComputedStyle(el).animationName)
}

function keyframesInDocument(): Set<string> {
  const found = new Set<string>()
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null
    try {
      rules = sheet.cssRules
    } catch {
      continue // 跨源表读不到不等于「没有」，跳过它而不是判空
    }
    if (!rules) continue
    for (const rule of Array.from(rules)) {
      if (rule.type === CSSRule.KEYFRAMES_RULE) found.add((rule as CSSKeyframesRule).name)
    }
  }
  return found
}

async function mountTiles({ reducedMotion = false, anims }: { reducedMotion?: boolean; anims?: number[] }) {
  await render(
    <>
      <style>{MOSAIC_TILE_KEYFRAMES}</style>
      {(anims ?? Array.from({ length: MOSAIC_TILE_ANIM_COUNT }, (_, i) => i)).map((anim) => (
        <MosaicFillerTile key={anim} anim={anim} reducedMotion={reducedMotion} />
      ))}
    </>,
  )
}

afterEach(() => {
  document.body.replaceChildren()
})

describe("MosaicFillerTile", () => {
  it("六款动画类各自拿到互不相同的 animation-name", async () => {
    await mountTiles({})
    const names = animationNames()
    expect(names).toHaveLength(MOSAIC_TILE_ANIM_COUNT)
    expect(names.every((n) => n !== "" && n !== "none")).toBe(true)
    expect(new Set(names).size).toBe(MOSAIC_TILE_ANIM_COUNT)
  })

  it("每个被引用的动画名都真的有 @keyframes；同一条尺看不见虚构名字", async () => {
    await mountTiles({})
    const names = animationNames()
    const present = keyframesInDocument()
    for (const name of names) expect(present.has(name)).toBe(true)
    expect(present.has("xrn-mosaic-does-not-exist")).toBe(false)
  })

  it("reduced-motion 下不挂动画，但格子仍留在版面上（不是被藏起来）", async () => {
    await mountTiles({ reducedMotion: true })
    expect(animationNames().every((n) => n === "none" || n === "")).toBe(true)
    expect(layers()).toHaveLength(MOSAIC_TILE_ANIM_COUNT)
  })

  it("动画层颜色一律走 token，不出现写死的 hex", async () => {
    await mountTiles({})
    for (const el of layers()) {
      const bg = el.style.backgroundImage
      expect(bg).toContain("var(")
      expect(/#[0-9a-f]{3,8}/i.test(bg)).toBe(false)
    }
  })

  it("越界的 anim 序号回落到有效类（不渲染出无名动画）", async () => {
    await mountTiles({ anims: [-3, 99] })
    const names = animationNames()
    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(1)
    expect(keyframesInDocument().has(names[0])).toBe(true)
  })
})
