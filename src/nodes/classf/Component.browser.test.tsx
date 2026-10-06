import { useEffect, useReducer } from "react"
import { afterEach, expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { cleanup, render } from "vitest-browser-react"
import type { NodeComponentProps } from "@xiranite/contract"
import { DEFAULT_CLASSF_BLACKLIST_KEYWORDS } from "@xiranite/node-classf/core"
import { Component } from "./Component"
import type { ClassfCardState } from "./types"

const surface = vi.hoisted(() => ({ height: 800, mode: "regular", width: 1200 }))

vi.mock("@/nodes/shared/useNodeSurface", () => ({
  useNodeSurface: () => ({ ref: { current: null }, ...surface }),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test("edits multiline blacklist drafts, splits SameA labels, and saves only after confirmation", async () => {
  const host = createHost()
  await render(<Harness compId="classf-blacklist-browser" host={host} />)

  await expect.element(page.getByRole("button", { name: "黑名单作者" })).toBeVisible()
  await expect.element(page.getByRole("textbox", { name: "classf blacklist keywords" })).not.toBeInTheDocument()

  await page.getByRole("button", { name: "黑名单作者" }).click()
  const keywords = page.getByRole("textbox", { name: "classf blacklist keywords" })
  await expect.element(keywords).toBeVisible()
  await keywords.fill("[きゅうりのふかづめ (しぐれに)]\n[another artist]")
  await expect.element(keywords).toHaveValue("[きゅうりのふかづめ (しぐれに)]\n[another artist]")
  expect(host.state.blacklistKeywords).toBeUndefined()

  await page.getByRole("button", { name: "拆分社团与作者" }).click()
  await expect.element(keywords).toHaveValue("[きゅうりのふかづめ]\n[しぐれに]\n[another artist]")

  await page.getByRole("button", { name: "完成" }).click()
  await expect.poll(() => host.state.blacklistKeywords).toEqual(["[きゅうりのふかづめ]", "[しぐれに]", "[another artist]"])
  await page.getByRole("button", { name: "配置管理" }).click()
  await page.getByRole("button", { name: "保存为默认" }).click()
  await expect.poll(() => host.savedConfig?.blacklistKeywords).toEqual(["[きゅうりのふかづめ]", "[しぐれに]", "[another artist]"])
})

test("imports deletion history, applies a custom threshold, and adds all sorted candidates to the blacklist draft", async () => {
  const host = createHost()
  host.localFiles = {
    getUrl: (path) => `local://${path}`,
    pickFiles: async () => ["D:/exports/xiranite-file-deletions.csv"],
  }
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => [
      "id,sourcePath,state",
      "1,\"D:/library/[Alpha] 1.zip\",trashed",
      "2,\"D:/library/[Alpha] 2.zip\",trashed",
      "3,\"D:/library/[Alpha] 3.zip\",trashed",
      "4,\"D:/library/[Alpha] 4.zip\",permanent",
      "5,\"D:/library/[Beta] 1.zip\",trashed",
      "6,\"D:/library/[Beta] 2.zip\",trashed",
      "7,\"D:/library/[Beta] 3.zip\",trashed",
      "8,\"D:/library/[Gamma] 1.zip\",trashed",
      "9,\"D:/library/[Gamma] 2.zip\",trashed",
    ].join("\n"),
  })))
  await render(<Harness compId="classf-history-browser" host={host} />)

  await page.getByRole("button", { name: "黑名单作者" }).click()
  await page.getByRole("button", { name: "导入删除历史" }).click()
  await page.getByRole("dialog", { name: "删除历史分析" }).getByRole("button", { name: "导入删除历史" }).click()
  await expect.element(page.getByText("[Alpha]", { exact: true })).toBeVisible()
  await expect.element(page.getByText("[Beta]", { exact: true })).toBeVisible()
  await expect.element(page.getByText("[Gamma]", { exact: true })).not.toBeInTheDocument()

  await page.getByRole("spinbutton", { name: "classf deletion history minimum" }).fill("2")
  await expect.element(page.getByText("[Gamma]", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "加入 3 个候选" }).click()

  const keywords = page.getByRole("textbox", { name: "classf blacklist keywords" })
  const expectedKeywords = [...DEFAULT_CLASSF_BLACKLIST_KEYWORDS, "[Alpha]", "[Beta]", "[Gamma]"]
  await expect.element(keywords).toHaveValue(expectedKeywords.join("\n"))
  expect(host.state.blacklistKeywords).toBeUndefined()
  expect(host.state.blacklistHistoryMinDeletions).toBe(2)

  await page.getByRole("button", { name: "完成" }).click()
  await expect.poll(() => host.state.blacklistKeywords).toEqual(expectedKeywords)
})

test("keeps scan sources compact and persists independent queue and grouping switches", async () => {
  const host = createHost()
  await render(<Harness compId="classf-del-mode-browser" host={host} />)

  const paths = page.getByRole("textbox", { name: "classf paths" })
  const crashuSources = page.getByRole("textbox", { name: "classf crashu sources" })
  expect(getComputedStyle(paths.element()).height).toBe("36px")
  expect(getComputedStyle(crashuSources.element()).height).toBe("36px")
  await expect.element(paths).toHaveAttribute("placeholder", "例如 D:/set/reviewed.zip")

  await page.getByRole("switch", { name: "启用 already" }).click()
  await expect.poll(() => host.state.alreadyEnabled).toBe(false)
  await page.getByRole("switch", { name: "wait 画师分组" }).click()
  await expect.poll(() => host.state.sameaGroupWaitEnabled).toBe(true)
  await page.getByRole("button", { name: "配置管理" }).click()
  await page.getByRole("button", { name: "保存为默认" }).click()
  await expect.poll(() => host.savedConfig).toMatchObject({ alreadyEnabled: false, sameaGroupWaitEnabled: true })
})

test("reveals the source before execution and the destination after execution from the plan tree", async () => {
  const revealPath = vi.fn(async () => undefined)
  const host = createHost()
  host.localFiles = { revealPath } as TestHost["localFiles"]
  host.state = {
    pathsText: "D:/set",
    result: planResult("ready"),
  }
  await render(<Harness compId="classf-plan-tree-browser" host={host} />)

  await openPlanTreeLeaf("[Artist] Demo.zip")
  await expect.poll(() => revealPath.mock.calls).toEqual([["D:/set/[Artist] Demo.zip"]])

  host.state = { ...host.state, result: planResult("moved") }
  host.notify()
  await expect.poll(() => [...document.querySelectorAll<HTMLButtonElement>("button")].some((button) => button.textContent?.includes("已移动"))).toBe(true)
  await openPlanTreeLeaf("[Artist] Demo.zip")
  await expect.poll(() => revealPath.mock.calls).toEqual([["D:/set/[Artist] Demo.zip"], ["D:/set/already/[Artist] Demo.zip"]])
})

type TestHost = NodeComponentProps<ClassfCardState>["host"] & {
  state: ClassfCardState
  savedConfig?: Partial<ClassfCardState>
  notify: () => void
}

function Harness(props: { compId: string; host: TestHost }) {
  const [, force] = useReducer((count: number) => count + 1, 0)
  useEffect(() => {
    props.host.notify = force
    return () => { props.host.notify = () => undefined }
  }, [props.host])
  return <div style={{ height: 800, width: 1200 }}><Component compId={props.compId} host={props.host} /></div>
}

function createHost(): TestHost {
  const host: TestHost = {
    state: { pathsText: "D:/set" } as ClassfCardState,
    notify: () => undefined,
    getData: <T,>() => host.state as T,
    patchData: (_compId: string, patch: Partial<ClassfCardState>) => {
      host.state = { ...host.state, ...patch }
      host.notify()
    },
    config: {
      get: async () => ({ config: undefined, path: "D:/config/xiranite.config.toml" }),
      save: async (config: Partial<ClassfCardState>) => { host.savedConfig = config },
      openFile: () => undefined,
    },
    clipboard: { readText: async () => "", writeText: async () => undefined },
    listComponents: () => [],
    updateComponent: () => undefined,
  } as unknown as TestHost
  return host
}

function planResult(status: "ready" | "moved") {
  return {
    action: "plan" as const,
    transferMode: "move" as const,
    classifyMode: "auto" as const,
    placementMode: "local" as const,
    baseDir: "D:/set",
    items: [{ sourcePath: "D:/set/[Artist] Demo.zip", targetPath: "D:/set/already/[Artist] Demo.zip", sourceName: "[Artist] Demo.zip", targetRelative: "already/[Artist] Demo.zip", kind: "file" as const, stage: "already" as const, status }],
    selectedCount: 1,
    readyCount: status === "ready" ? 1 : 0,
    movedCount: status === "moved" ? 1 : 0,
    copiedCount: 0,
    delCount: 0,
    waitCount: 0,
    conflictCount: 0,
    errorCount: 0,
    errors: [],
  }
}

async function openPlanTreeLeaf(name: string) {
  const leaf = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes(name))
  expect(leaf).toBeDefined()
  leaf!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
}
