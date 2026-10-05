// @vitest-environment happy-dom
import { describe, expect, test } from "vitest"

import { useWorkspaceStore } from "@/store/workspaceStore"

import { selectWorkspaceActions, selectWorkspaceUiPreferences as selectPersistedPrefs } from "@/store/workspaceStore"
import { selectWorkspaceUiPreferences as selectHostUiPrefs } from "@/components/workspace/AppConfigSync"
import { INITIAL_STATE } from "@/store/workspace/constants"
import { DEFAULT_DESIGN_THEME } from "@/lib/design-theme/contract"
import type { WSStore, WorkspaceUiPreferences } from "@/store/workspace/types"

/**
 * 工作区 UI 偏好有**两份**挑选清单：一份喂 zustand persist（localStorage），
 * 一份喂宿主持久化（`[app.ui.workspace]`）。两份都是手写的字段枚举，
 * 加一个偏好只改一处就会静默半边失效。
 *
 * 这条测试不假装两份清单已经等价——`KNOWN_LOCAL_ONLY` 是 2026-10-05 实测出来的
 * 既存漂移记账（见下面的注释），不是设计意图。它的价值在于：
 *  - 新加的偏好若只进了一份清单，当场红；
 *  - 想让某个字段成为「有意只留本地」，必须显式写进这份名单并说明理由；
 *  - 反过来，把本地-only 字段补齐到宿主清单时，这条测试会逼着把它从名单里删掉。
 */
const KNOWN_LOCAL_ONLY: Record<string, string> = {
  hazardMode: "既存漂移，不是设计：字段在 WorkspaceUiPreferences 里、在 store 清单里，但 AppConfigSync 的清单没有它（全仓无注释说明刻意）。"
    + "副作用待核：mergeMissingWorkspacePreferences 会用默认值回填缺失键，因此本机 hazardMode 可能在每次启动被 false 覆盖。不在本任务范围内修。",
  laneWorkspacePreferences: "既存漂移，同上；按 workspaceId 键控的泳道偏好，业务数据本应走宿主/SQLite，落点待定。不在本任务范围内修。",
}

function keySet(value: Record<string, unknown>): string[] {
  return Object.keys(value).sort()
}

function difference(left: string[], right: string[]): string[] {
  const other = new Set(right)
  return left.filter((key) => !other.has(key))
}

describe("workspace UI preference persistence lists stay accounted", () => {
  const state = INITIAL_STATE as unknown as WSStore
  const persisted = selectPersistedPrefs(state) as unknown as Record<string, unknown>
  const host = selectHostUiPrefs(persisted as unknown as WorkspaceUiPreferences) as unknown as Record<string, unknown>

  test("the two lists differ only by explicitly accounted keys", () => {
    const localOnly = difference(keySet(persisted), keySet(host))
    const hostOnly = difference(keySet(host), keySet(persisted))
    expect(hostOnly, "宿主清单里有 store 清单没有的字段（反向漂移同样是坏）").toEqual([])
    expect(localOnly.sort()).toEqual(Object.keys(KNOWN_LOCAL_ONLY).sort())
    expect(keySet(persisted).length, "清单空着的话上面的等式是假绿").toBeGreaterThan(30)
  })

  test("the advanced theme is persisted on both sides and survives byte-identical", () => {
    expect(persisted.designTheme).toEqual(DEFAULT_DESIGN_THEME)
    expect(host.designTheme).toEqual(DEFAULT_DESIGN_THEME)
    expect(JSON.stringify(host.designTheme)).toBe(JSON.stringify(persisted.designTheme))
  })

  test("the comparison sees a one-sided field (falsification control)", () => {
    // 尺必须能看见「只加了一处」这种坏：这里模拟有人只改了宿主那份清单。
    const oneSided = { ...host, brandNewPreference: true }
    expect(difference(keySet(oneSided), keySet(persisted)).concat(difference(keySet(host), keySet(oneSided)))
      .sort()).toEqual(["brandNewPreference"])
    // 反向对照：真正的等长清单不该报出任何东西。
    expect(difference(keySet(host), keySet(persisted))).toEqual([])
  })

  test("every action implemented on the store is forwarded by the actions selector", () => {
    // 第四份手写清单：`selectWorkspaceActions` 逐个转发 action。少转发一条，界面拿到的
    // 就是 undefined 并在点击时崩——本轮 `setDesignTheme` 就是这么被撞出来的（浏览器测试抓到）。
    const store = useWorkspaceStore.getState() as unknown as Record<string, unknown>
    const implemented = Object.keys(store).filter((key) => typeof store[key] === "function").sort()
    const forwarded = Object.keys(selectWorkspaceActions(store as never)).sort()
    expect(implemented.length, "store 上一个 action 都没有的话这条断言是假绿").toBeGreaterThan(20)
    expect(difference(implemented, forwarded), `实现了但没转发的 action: ${difference(implemented, forwarded).join(", ")}`).toEqual([])
    expect(difference(forwarded, implemented), `转发清单里有 store 没有的名字`).toEqual([])
  })

  test("every accounted local-only key still carries its reason", () => {
    for (const [key, reason] of Object.entries(KNOWN_LOCAL_ONLY)) {
      expect(reason.length, `${key} 的记账理由不能是空的`).toBeGreaterThan(40)
      expect(persisted, `${key} 已经不在 store 清单里了，名单该删`).toHaveProperty(key)
    }
  })
})
