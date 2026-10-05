import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { cleanup, render } from "vitest-browser-react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { INITIAL_STATE } from "@/store/workspace/constants"
import { useWorkspaceStore } from "@/store/workspaceStore"
import type { ComponentInstance } from "@/types/workspace"

import { CardView } from "./CardView"

// 卡片本体要读宿主能力（React Query + Tauri 探测）。这两样与「瀑布流补位/调高」无关，
// 按仓里既有做法 mock 掉，保留真实 workspace store——写入必须真的落到 store 才算验过。
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}))

vi.mock("@/hooks/useWindowControls", () => ({
  useWindowControls: () => ({
    capabilities: {
      supported: true,
      nativeWindowControls: false,
      frameless: false,
      componentWindows: "browser-popup",
      captionOwner: "system",
    },
    controlMain: vi.fn(),
    controlMainPending: false,
    controlComponent: vi.fn(),
    controlComponentPending: false,
    closeComponent: vi.fn(),
  }),
}))

const WS = "masonry-cards-test"

function card(id: string, height: number): ComponentInstance {
  return {
    id,
    moduleId: `mod-${id}`,
    state: "docked",
    placement: "workspace",
    workspaceId: WS,
    collapsed: false,
    laneSize: { height },
  } as unknown as ComponentInstance
}

beforeEach(() => {
  useWorkspaceStore.setState({
    ...INITIAL_STATE,
    activeWorkspaceId: WS,
    viewMode: "cards",
    cardLayout: "stack",
    workspaces: [{ id: WS, label: "Masonry" }],
    components: [card("a", 420), card("b", 420)],
  })
})

afterEach(() => {
  cleanup()
  useWorkspaceStore.setState({ ...INITIAL_STATE })
})

async function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  await render(
    <QueryClientProvider client={queryClient}>
      <div style={{ width: 1200, height: 800, display: "flex" }}>
        <CardView />
      </div>
    </QueryClientProvider>,
  )
}

function pointer(type: string, target: EventTarget, init: PointerEventInit) {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, isPrimary: true, pointerId: 1, button: 0, ...init }))
}

/** 键盘/指针事件用 dispatchEvent 同步打进 DOM，React 的重排要到下一帧才落画；
 *  不等就等于在量「上一帧的高度」，测出来的 staleness 是测试假象不是产品缺陷。 */
function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
}

async function key(handle: HTMLElement, init: KeyboardEventInit) {
  handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true, ...init }))
  await nextFrame()
}

test("剩余空间被补成变尺寸格子，而不是留白或清一色方块", async () => {
  await mount()
  const tiles = document.querySelectorAll('[data-testid="masonry-filler"]')
  expect(tiles.length).toBeGreaterThan(1)
  const sizes = new Set(
    Array.from(tiles).map((el) => {
      const box = (el as HTMLElement).style
      return `${box.width}x${box.height}`
    }),
  )
  expect(sizes.size).toBeGreaterThan(1)
})

test("拖卡片下沿改高度：松手才落一次持久化写入，卡片盒实测跟着变高", async () => {
  await mount()
  const handle = document.querySelector<HTMLElement>('[data-testid="masonry-resize-handle"][data-card-id="a"]')
  expect(handle).toBeTruthy()
  const box = handle!.parentElement!
  const before = box.getBoundingClientRect().height

  pointer("pointerdown", handle!, { clientX: 300, clientY: 400 })
  pointer("pointermove", window, { clientX: 300, clientY: 460 })
  await nextFrame()
  // 拖动过程中只改本地状态，不许每次 pointermove 都写 store
  expect(useWorkspaceStore.getState().components.find((c) => c.id === "a")?.laneSize?.height).toBe(420)
  expect(box.getBoundingClientRect().height).toBeGreaterThan(before)

  pointer("pointerup", window, { clientX: 300, clientY: 460 })
  expect(useWorkspaceStore.getState().components.find((c) => c.id === "a")?.laneSize?.height).toBe(480)
  await nextFrame()
  // 写回 store 之后布局仍按 480 排（不是靠本地覆盖撑着的假高）
  const after = document.querySelector<HTMLElement>('[data-testid="masonry-resize-handle"][data-card-id="a"]')!
    .parentElement!.getBoundingClientRect().height
  expect(Math.round(after)).toBe(480)
})

test("键盘也能调高，并且高度被夹在上下限内", async () => {
  await mount()
  const handle = document.querySelector<HTMLElement>('[data-testid="masonry-resize-handle"][data-card-id="a"]')!
  handle.focus()
  await key(handle, {})
  expect(useWorkspaceStore.getState().components.find((c) => c.id === "a")?.laneSize?.height).toBe(436)

  for (let i = 0; i < 12; i++) await key(handle, { shiftKey: true })
  expect(useWorkspaceStore.getState().components.find((c) => c.id === "a")?.laneSize?.height).toBe(860)

  for (let i = 0; i < 20; i++) await key(handle, { key: "ArrowUp", shiftKey: true })
  expect(useWorkspaceStore.getState().components.find((c) => c.id === "a")?.laneSize?.height).toBe(240)
})
