import { describe, expect, test } from "bun:test"
import type { WeiboSpiderHttpResponse, WeiboSpiderPathInfo, WeiboSpiderRuntime } from "./core.js"
import {
  buildPageUrl,
  buildProfileUrl,
  parseCookieInput,
  parseProfileHtml,
  parseWeiboPageHtml,
  runWeiboSpider,
  validateConfig,
  validateCookieFields,
} from "./core.js"

describe("weibospider core", () => {
  test("parses cookie JSON and validates required fields", () => {
    expect(parseCookieInput('{"SUB":"abc","MLOGIN":"1"}')).toBe("SUB=abc; MLOGIN=1")
    expect(parseCookieInput('{"cookie":"SUB=abc; ALF=1"}')).toBe("SUB=abc; ALF=1")
    expect(validateCookieFields("SUB=abc; ALF=1").valid).toBe(true)
    expect(validateCookieFields("ALF=1").valid).toBe(false)
  })

  test("validates config shape", () => {
    const valid = validateConfig({
      user_id_list: ["100"],
      filter: 1,
      since_date: "2024-01-01",
      end_date: "now",
      random_wait_pages: [1, 5],
      random_wait_seconds: [1, 2],
      global_wait: [[1000, 3600]],
      write_mode: ["json", "sqlite"],
      pic_download: 1,
      video_download: 0,
      file_download_timeout: [5, 5, 10],
      result_dir_name: 0,
      cookie: "SUB=abc",
    })
    expect(valid.errors).toEqual([])
    expect(valid.warnings[0]).toContain("sqlite")
  })

  test("parses profile and page HTML", () => {
    const profile = parseProfileHtml(profileHtml(), "demo")
    expect(profile.user.id).toBe("100")
    expect(profile.user.nickname).toBe("Demo")
    expect(profile.user.weibo_num).toBe(12)
    expect(profile.pageNum).toBe(2)

    const page = parseWeiboPageHtml(pageHtml(), { userId: "100", filterOriginal: true, now: new Date("2026-02-01T00:00:00Z") })
    expect(page.posts).toHaveLength(1)
    expect(page.posts[0]?.id).toBe("abc")
    expect(page.posts[0]?.original_pictures[0]).toContain("/large/")
    expect(page.posts[0]?.up_num).toBe(3)
  })

  test("saves, loads, validates, and crawls with injected runtime", async () => {
    const runtime = createMemoryRuntime()
    runtime.responses[buildProfileUrl("100")] = response(profileHtml())
    runtime.responses[buildPageUrl("100", 1, "2020-01-01", "now")] = response(pageHtml())

    const save = await runWeiboSpider({
      action: "save_config",
      userIds: "100",
      sinceDate: "2020-01-01",
      cookie: "SUB=abc; ALF=1",
      writeMode: "json,csv,txt",
      picDownload: false,
      videoDownload: false,
    }, runtime)
    expect(save.success).toBe(true)
    expect(runtime.files["/config.json"]).toContain("\"user_id_list\"")

    const load = await runWeiboSpider({ action: "load_config" }, runtime)
    expect(load.data?.configData.user_id_list).toEqual(["100"])

    const cookie = await runWeiboSpider({ action: "validate_cookie", cookie: "SUB=abc", online: false }, runtime)
    expect(cookie.data?.cookieValid).toBe(true)

    const crawl = await runWeiboSpider({ action: "crawl", maxPages: 1, downloadMedia: false }, runtime)
    expect(crawl.success).toBe(true)
    expect(crawl.data?.crawledUsers).toBe(1)
    expect(crawl.data?.crawledWeibos).toBe(1)
    expect(runtime.files["/weibo/Demo/100.json"]).toContain("\"abc\"")
    expect(runtime.files["/weibo/Demo/100.csv"]).toContain("weibo_id")
    expect(runtime.files["/weibo/Demo/100.txt"]).toContain("hello")
  })
})

function profileHtml(): string {
  return `
    <html>
      <head><title>Demo\u7684\u5fae\u535a</title></head>
      <body>
        <div class="u"><a href="/100/info">\u8d44\u6599</a></div>
        <div class="tip2">\u5fae\u535a[12]\u5173\u6ce8[3]\u7c89\u4e1d[4]</div>
        <input name="mp" value="2" />
        ${pageHtml()}
      </body>
    </html>
  `
}

function pageHtml(): string {
  return `
    <div class="c" id="M_abc">
      <div>
        <span class="ctt">hello <a href="https://weibo.com/ttarticle/p/show?id=1">\u5168\u6587</a></span>
        <a href="https://weibo.cn/mblog/pic/abc"><img src="https://wx1.sinaimg.cn/wap180/demo.jpg" /></a>
      </div>
      <div><span class="ct">2026-01-02 12:00 \u6765\u81ea iPhone</span> \u8d5e[3] \u8f6c\u53d1[2] \u8bc4\u8bba[1]</div>
    </div>
  `
}

function response(text: string, status = 200): WeiboSpiderHttpResponse {
  return { url: "mock", status, headers: {}, text }
}

function createMemoryRuntime() {
  const runtime: WeiboSpiderRuntime & {
    files: Record<string, string>
    responses: Record<string, WeiboSpiderHttpResponse>
    downloads: Record<string, string>
  } = {
    files: {},
    responses: {},
    downloads: {},
    async pathInfo(path): Promise<WeiboSpiderPathInfo> {
      const normalized = normalize(path)
      return {
        path: normalized,
        exists: Object.hasOwn(runtime.files, normalized),
        isFile: Object.hasOwn(runtime.files, normalized),
        isDirectory: false,
        size: runtime.files[normalized]?.length ?? 0,
      }
    },
    async readText(path) {
      const normalized = normalize(path)
      if (!Object.hasOwn(runtime.files, normalized)) throw new Error(`missing file: ${path}`)
      return runtime.files[normalized]!
    },
    async writeText(path, content) {
      runtime.files[normalize(path)] = content
    },
    async ensureDir() {},
    async fetchText(url) {
      const found = runtime.responses[url]
      if (!found) throw new Error(`missing response: ${url}`)
      return found
    },
    async downloadFile(url, targetPath) {
      runtime.downloads[normalize(targetPath)] = url
    },
    join: (...parts) => normalize(parts.join("/")),
    dirname,
    basename,
    resolve: normalize,
    defaultConfigPath: () => "/config.json",
    defaultOutputDir: () => "/weibo",
    now: () => new Date("2026-02-01T00:00:00Z"),
    random: () => 0.5,
    sleep: async () => {},
  }
  return runtime
}

function normalize(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "")
  return normalized || "/"
}

function dirname(path: string): string {
  const normalized = normalize(path)
  if (normalized === "/") return "/"
  const index = normalized.lastIndexOf("/")
  return index <= 0 ? "/" : normalized.slice(0, index)
}

function basename(path: string): string {
  const normalized = normalize(path)
  return normalized.slice(normalized.lastIndexOf("/") + 1)
}
