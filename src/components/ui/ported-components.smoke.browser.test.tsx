import { afterEach, describe, expect, test } from "vitest"
import { render } from "vitest-browser-react"
import { Trash2 } from "lucide-react"

import { HoldButton } from "@/components/ui/hold-button"
import { LatticeLoader } from "@/components/ui/lattice-loader"
import { OptionWheel } from "@/components/ui/option-wheel"
import { SloshGauge } from "@/components/ui/slosh-gauge"
import { BorderGlow } from "@/components/ui/border-glow"
import { ClickSpark } from "@/components/ui/click-spark"
import { ElectricBorder } from "@/components/ui/electric-border"
import { GlareHover } from "@/components/ui/glare-hover"
import { GradualBlur } from "@/components/ui/gradual-blur"
import { GlassSurface } from "@/components/ui/glass-surface"
import { MagnetLines } from "@/components/ui/magnet-lines"
import { Noise } from "@/components/ui/noise"
import { ScrollExpand } from "@/components/ui/scroll-expand"
import { SpotlightCard } from "@/components/ui/spotlight-card"
import { StarBorder } from "@/components/ui/star-border"

/**
 * 这 15 件还没有产品调用点（缺的是消费者，不是代码）。这里只验一件事：
 * 用默认 props 挂得起来、不抛、有尺寸 —— 免得接线时才发现某件是哑弹。
 */
afterEach(() => {
  document.body.replaceChildren()
})

const CHILD = <span>内容</span>

async function mount(node: React.ReactElement): Promise<HTMLElement> {
  // 取 render() 自己那个 container 的第一个子元素：body.firstElementChild 量到的是
  // 测试外壳，宽度永远不为 0，那样这 15 条断言就是空尺。
  const { container } = await render(node)
  const root = container.firstElementChild as HTMLElement | null
  expect(root, "组件没有渲染任何节点").toBeTruthy()
  return root!
}

describe("unwired reactbits ports mount cleanly with default props", () => {
  test.each([
    ["HoldButton", () => mount(<HoldButton icon={<Trash2 />}>按住删除</HoldButton>)] as const,
    ["LatticeLoader", () => mount(<LatticeLoader label="正在处理" />)] as const,
    ["OptionWheel", () => mount(<OptionWheel items={["甲", "乙", "丙"]} />)] as const,
    ["SloshGauge", () => mount(<SloshGauge value={42} />)] as const,
    ["BorderGlow", () => mount(<BorderGlow>{CHILD}</BorderGlow>)] as const,
    ["ClickSpark", () => mount(<ClickSpark>{CHILD}</ClickSpark>)] as const,
    ["ElectricBorder", () => mount(<ElectricBorder>{CHILD}</ElectricBorder>)] as const,
    ["GlareHover", () => mount(<GlareHover>{CHILD}</GlareHover>)] as const,
    ["GradualBlur", () => mount(<GradualBlur>{CHILD}</GradualBlur>)] as const,
    ["GlassSurface", () => mount(<GlassSurface>{CHILD}</GlassSurface>)] as const,
    ["MagnetLines", () => mount(<MagnetLines />)] as const,
    ["Noise", () => mount(<Noise />)] as const,
    ["ScrollExpand", () => mount(<ScrollExpand>{CHILD}</ScrollExpand>)] as const,
    ["SpotlightCard", () => mount(<SpotlightCard>{CHILD}</SpotlightCard>)] as const,
    ["StarBorder", () => mount(<StarBorder>主要动作</StarBorder>)] as const,
  ])("%s", async (_name, run) => {
    const root = await run()
    expect(root.getBoundingClientRect().width, `${_name} 宽度为 0`).toBeGreaterThan(0)
  })

  test("the width gauge really distinguishes a collapsed box (positive control)", async () => {
    const wide = await mount(<div style={{ width: 40, height: 8 }}>x</div>)
    const collapsed = await mount(<div hidden>y</div>)

    expect(wide.getBoundingClientRect().width).toBe(40)
    expect(collapsed.getBoundingClientRect().width).toBe(0)
  })
})
