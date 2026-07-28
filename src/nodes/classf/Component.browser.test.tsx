import { useEffect, useReducer } from "react"
import { expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"
import type { NodeComponentProps } from "@xiranite/contract"
import { Component } from "./Component"
import type { ClassfCardState } from "./types"

const surface = vi.hoisted(() => ({ height: 800, mode: "regular", width: 1200 }))

vi.mock("@/nodes/shared/useNodeSurface", () => ({
  useNodeSurface: () => ({ ref: { current: null }, ...surface }),
}))

test("edits the blacklist dialog, splits SameA labels, and saves its TOML default", async () => {
  const host = createHost()
  await render(<Harness compId="classf-blacklist-browser" host={host} />)

  await expect.element(page.getByRole("button", { name: "黑名单作者" })).toBeVisible()
  await expect.element(page.getByRole("textbox", { name: "classf blacklist keywords" })).not.toBeInTheDocument()

  await page.getByRole("button", { name: "黑名单作者" }).click()
  const keywords = page.getByRole("textbox", { name: "classf blacklist keywords" })
  await expect.element(keywords).toBeVisible()
  await keywords.fill("[きゅうりのふかづめ (しぐれに)]")
  await expect.poll(() => host.state.blacklistKeywords).toEqual(["[きゅうりのふかづめ (しぐれに)]"])

  await page.getByRole("button", { name: "拆分社团与作者" }).click()
  await expect.poll(() => host.state.blacklistKeywords).toEqual(["[きゅうりのふかづめ]", "[しぐれに]"])

  await page.getByRole("button", { name: "完成" }).click()
  await page.getByRole("button", { name: "配置管理" }).click()
  await page.getByRole("button", { name: "保存为默认" }).click()
  await expect.poll(() => host.savedConfig?.blacklistKeywords).toEqual(["[きゅうりのふかづめ]", "[しぐれに]"])
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
