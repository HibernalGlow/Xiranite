// Jellyfin + PotPlayer userscript — Vitest Browser Mode 验证。
// 在真实浏览器中模拟 Jellyfin 详情页/卡片 DOM，注入 userscript，
// 验证：捕获阶段按钮绑定、localStorage 凭据读取、fetch URL 与令牌、
// potplayer:// URI 编码、文件夹递归回退、未登录错误。
import { expect, test, vi } from "vitest"
// @ts-ignore — vite ?raw 将 userscript 源码内联为字符串
import userscriptSrc from "../assets/jellyfin-potplayer.user.js?raw"

// 注入前对用户脚本做测试插桩：window.open（主路径）与 location.href
// （弹窗被拦截的兜底）都改为记录 URI，避免测试页真的跳转到 potplayer://。
const US = userscriptSrc.replace(
  "window.location.href = uri;",
  "window.__potplayerUri = uri;",
)

function stubWindowOpen(): void {
  window.open = ((url: string) => {
    ;(window as unknown as { __potplayerUri?: string }).__potplayerUri = url
    return {} as Window // truthy：不触发 location.href 兜底
  }) as typeof window.open
}

const MOVIE_PATH = "F:\\1MOV\\av1\\#整理完成\\白桃はな\\[EKDV-662] 希望を胸に….mp4"

function injectUserscript(): void {
  const script = document.createElement("script")
  script.textContent = US
  document.head.appendChild(script)
}

function buildDetailPage(): void {
  document.body.innerHTML = `
    <div id="itemDetailPage" data-role="page">
      <div class="detailPagePrimaryContainer">
        <div class="mainDetailButtons">
          <button is="emby-button" class="button-flat btnPlay detailButton" data-action="resume">
            <div class="detailButton-content"><span class="material-icons detailButton-icon play_arrow"></span></div>
          </button>
          <button is="emby-button" class="button-flat btnReplay detailButton" data-action="play">
            <div class="detailButton-content"><span class="material-icons detailButton-icon replay"></span></div>
          </button>
        </div>
      </div>
    </div>`
}

function seedCredentials(): void {
  localStorage.setItem(
    "jellyfin_credentials",
    JSON.stringify({
      Servers: [{ Id: "srv-1", AccessToken: "tok-abc", UserId: "user-1", Name: "PTEROSAUR" }],
    }),
  )
}

interface FetchCall {
  url: string
  headers: Record<string, string>
}

function stubFetch(handler: (url: string) => { ok: boolean; json: () => Promise<unknown> }): FetchCall[] {
  const calls: FetchCall[] = []
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, headers: (init?.headers as Record<string, string>) ?? {} })
    return handler(url) as Response
  }) as typeof fetch
  return calls
}

function launchedUri(): string {
  return (window as unknown as { __potplayerUri?: string }).__potplayerUri ?? ""
}

// 浏览器测试共享同一页面：上一个测试注入的 userscript 及其定时器仍存活，
// 会继续绑定新 DOM。每个测试开始时重置 hash / 残留 URI / DOM，
// 让残留脚本的 hash 型绑定与新测试的目标一致（卡片测试用无 id 的 hash，
// 使残留脚本的详情页绑定退化为 no-op）。
function resetPageState(hash: string): void {
  document.body.innerHTML = ""
  ;(window as unknown as { __potplayerUri?: string }).__potplayerUri = undefined
  history.replaceState(null, "", hash)
  stubWindowOpen()
}

test("详情页 resume 按钮：fetch 带 Fields=Path 与 X-Emby-Token，生成编码后的 potplayer:// URI", async () => {
  resetPageState("#/details?id=item-123&serverId=srv-1")
  buildDetailPage()
  seedCredentials()
  const calls = stubFetch(() => ({ ok: true, json: async () => ({ Id: "item-123", Path: MOVIE_PATH }) }))
  injectUserscript()
  window.dispatchEvent(new Event("viewshow"))

  ;(document.querySelector('button[data-action="resume"]') as HTMLButtonElement).click()

  await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0))
  expect(calls[0]!.url).toBe(`${location.origin}/Users/user-1/Items/item-123?Fields=Path`)
  expect(calls[0]!.headers["X-Emby-Token"]).toBe("tok-abc")

  await vi.waitFor(() => expect(launchedUri()).toBeTruthy())
  expect(launchedUri()).toMatch(/^potplayer:\/\/F:\/1MOV\/av1\//)
  expect(launchedUri()).toContain("%23") // '#' 已百分号编码
  expect(launchedUri()).not.toContain("#")
  expect(launchedUri()).not.toMatch(/\s/)
})

test("详情页 play 按钮同样拦截并唤起 PotPlayer", async () => {
  resetPageState("#/details?id=item-456&serverId=srv-1")
  buildDetailPage()
  seedCredentials()
  const calls = stubFetch(() => ({ ok: true, json: async () => ({ Id: "item-456", Path: "F:\\1MOV\\av1\\second.mp4" }) }))
  injectUserscript()
  window.dispatchEvent(new Event("viewshow"))

  ;(document.querySelector('button[data-action="play"]') as HTMLButtonElement).click()

  await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0))
  expect(calls[0]!.url).toContain("/Items/item-456?Fields=Path")
  await vi.waitFor(() => expect(launchedUri()).toBeTruthy())
  expect(launchedUri()).toBe("potplayer://F:/1MOV/av1/second.mp4")
})

test("列表卡片悬浮播放按钮：data-id 在卡片元素上，向上查找得到", async () => {
  resetPageState("#/home") // 无 id 的 hash：残留脚本的详情页绑定退化为 no-op
  document.body.innerHTML = `
    <div class="card" data-id="card-9">
      <div class="cardBox">
        <button is="paper-icon-button-light" class="cardOverlayButton" data-action="play">
          <span class="material-icons cardOverlayButtonIcon play_arrow"></span>
        </button>
      </div>
    </div>`
  seedCredentials()
  const calls = stubFetch(() => ({ ok: true, json: async () => ({ Id: "card-9", Path: "F:\\1MOV\\av1\\x.mp4" }) }))
  injectUserscript()
  window.dispatchEvent(new Event("viewshow"))

  ;(document.querySelector('.card button[data-action="play"]') as HTMLButtonElement).click()

  await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0))
  expect(calls[0]!.url).toContain("/Items/card-9?Fields=Path")
  await vi.waitFor(() => expect(launchedUri()).toBeTruthy())
  expect(launchedUri()).toBe("potplayer://F:/1MOV/av1/x.mp4")
})

test("文件夹/合集：自身无 Path 时递归取第一个带路径的子项", async () => {
  resetPageState("#/details?id=folder-1&serverId=srv-1")
  buildDetailPage()
  seedCredentials()
  const calls = stubFetch((url) => {
    if (url.includes("/Items/folder-1")) {
      return { ok: true, json: async () => ({ Id: "folder-1" }) }
    }
    return { ok: true, json: async () => ({ Items: [{ Id: "child-1", Path: "F:\\1MOV\\av1\\child.mp4" }] }) }
  })
  injectUserscript()
  window.dispatchEvent(new Event("viewshow"))

  ;(document.querySelector('button[data-action="resume"]') as HTMLButtonElement).click()

  await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2))
  expect(calls[1]!.url).toContain("ParentId=folder-1")
  expect(calls[1]!.url).toContain("Recursive=true")
  await vi.waitFor(() => expect(launchedUri()).toBeTruthy())
  expect(launchedUri()).toMatch(/child\.mp4$/)
})

test("未登录（无 jellyfin_credentials）时给出明确错误提示", async () => {
  resetPageState("#/details?id=item-1&serverId=srv-1")
  buildDetailPage()
  localStorage.removeItem("jellyfin_credentials")
  stubFetch(() => ({ ok: true, json: async () => ({}) }))
  const errSpy = vi.spyOn(console, "error")
  injectUserscript()
  window.dispatchEvent(new Event("viewshow"))

  ;(document.querySelector('button[data-action="resume"]') as HTMLButtonElement).click()

  await vi.waitFor(() => expect(errSpy).toHaveBeenCalled())
  expect(errSpy.mock.calls.some((c) => c.join(" ").includes("Not logged in"))).toBe(true)
  errSpy.mockRestore()
})

test("图片救援：视口内的 .lazy[data-src] 占位被填充并标记为已加载", async () => {
  resetPageState("#/home")
  document.body.innerHTML = `
    <div class="card" data-id="card-img-1">
      <div class="cardScalable">
        <div class="cardPadder cardPadder-square"></div>
        <div class="cardImageContainer lazy" data-src="http://x/img/1.jpg"></div>
      </div>
    </div>
    <div class="card" data-id="card-img-2">
      <div class="cardScalable">
        <div class="cardPadder cardPadder-square"></div>
        <img class="lazy" data-src="http://x/img/2.jpg" alt="">
      </div>
    </div>`
  injectUserscript()
  window.dispatchEvent(new Event("viewshow")) // bindAll 内会执行 rescueLazyImages

  await vi.waitFor(() => {
    expect(document.querySelector('[data-id="card-img-1"] .lazy')).toBeNull() // 已加载：lazy 标记移除
  })
  const div = document.querySelector('[data-id="card-img-1"] .cardImageContainer') as HTMLElement
  expect(div.style.backgroundImage).toContain("http://x/img/1.jpg")
  expect(div.hasAttribute("data-src")).toBe(false)

  const img = document.querySelector('[data-id="card-img-2"] img') as HTMLImageElement
  expect(img.getAttribute("src")).toBe("http://x/img/2.jpg")
  expect(img.hasAttribute("data-src")).toBe(false)
  expect(img.classList.contains("lazy")).toBe(false)
})
