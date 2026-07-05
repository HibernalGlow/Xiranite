import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type WeiboSpiderAction =
  | "status"
  | "load_config"
  | "save_config"
  | "validate_cookie"
  | "get_browser_cookie"
  | "import_config"
  | "export_config"
  | "crawl"

export type WeiboSpiderBrowser = "edge" | "chrome" | "firefox"
export type WeiboSpiderWriteMode = "json" | "csv" | "txt"

export interface WeiboSpiderInput {
  action?: WeiboSpiderAction
  userIds?: Array<string | WeiboUserConfigInput> | string
  user_ids?: Array<string | WeiboUserConfigInput> | string
  filterOriginal?: boolean
  filter_original?: boolean
  sinceDate?: string | number
  since_date?: string | number
  endDate?: string
  end_date?: string
  picDownload?: boolean
  pic_download?: boolean
  videoDownload?: boolean
  video_download?: boolean
  writeMode?: string[] | string
  write_mode?: string[] | string
  outputDir?: string
  output_dir?: string
  cookie?: string
  browser?: WeiboSpiderBrowser | string
  randomWaitPages?: number[] | string
  random_wait_pages?: number[] | string
  randomWaitSeconds?: number[] | string
  random_wait_seconds?: number[] | string
  globalWait?: number[][] | string
  global_wait?: number[][] | string
  configPath?: string
  config_path?: string
  importPath?: string
  import_path?: string
  exportPath?: string
  export_path?: string
  maxPages?: number
  max_pages?: number
  timeoutMs?: number
  timeout_ms?: number
  online?: boolean
  dryRun?: boolean
  dry_run?: boolean
  downloadMedia?: boolean
  download_media?: boolean
}

export interface WeiboUserConfigInput {
  id?: string
  user_uri?: string
  since_date?: string
  sinceDate?: string
  end_date?: string
  endDate?: string
}

export interface WeiboUserConfig {
  user_uri: string
  since_date: string
  end_date: string
}

export interface WeiboSpiderConfig {
  user_id_list: Array<string | { id: string; since_date?: string; end_date?: string }> | string
  filter: 0 | 1
  since_date: string | number
  end_date: string
  random_wait_pages: [number, number]
  random_wait_seconds: [number, number]
  global_wait: Array<[number, number]>
  write_mode: string[]
  pic_download: 0 | 1
  video_download: 0 | 1
  file_download_timeout: [number, number, number]
  result_dir_name: 0 | 1
  cookie: string
  output_dir?: string
  mysql_config?: unknown
  kafka_config?: unknown
  sqlite_config?: unknown
  mongo_config?: unknown
  post_config?: unknown
}

export interface WeiboUser {
  id: string
  nickname: string
  gender: string
  location: string
  birthday: string
  description: string
  verified_reason: string
  talent: string
  education: string
  work: string
  weibo_num: number
  following: number
  followers: number
}

export interface WeiboPost {
  id: string
  user_id: string
  content: string
  article_url: string
  original_pictures: string[]
  retweet_pictures: string[]
  original: boolean
  video_url: string
  publish_place: string
  publish_time: string
  publish_tool: string
  up_num: number
  retweet_num: number
  comment_num: number
}

export interface WeiboSpiderHttpResponse {
  url: string
  status: number
  headers: Record<string, string>
  text: string
}

export interface WeiboSpiderPathInfo {
  path: string
  exists: boolean
  isFile: boolean
  isDirectory: boolean
  size: number
}

export interface BrowserCookieResult {
  success: boolean
  cookie: string
  message: string
}

export interface WeiboSpiderRuntime {
  pathInfo: (path: string) => Promise<WeiboSpiderPathInfo>
  readText: (path: string) => Promise<string>
  writeText: (path: string, content: string) => Promise<void>
  ensureDir: (path: string) => Promise<void>
  fetchText: (url: string, options: { cookie?: string; timeoutMs?: number; noRedirect?: boolean }) => Promise<WeiboSpiderHttpResponse>
  downloadFile?: (url: string, targetPath: string, options: { cookie?: string; timeoutMs?: number }) => Promise<void>
  getBrowserCookie?: (browser: WeiboSpiderBrowser, onEvent?: (event: NodeRunEvent) => void) => Promise<BrowserCookieResult>
  join: (...parts: string[]) => string
  dirname: (path: string) => string
  basename: (path: string) => string
  resolve: (path: string) => string
  defaultConfigPath: () => string
  defaultOutputDir: () => string
  now: () => Date
  random: () => number
  sleep: (ms: number) => Promise<void>
}

export interface WeiboSpiderData {
  action: WeiboSpiderAction
  configPath: string
  outputDir: string
  hasConfig: boolean
  configData: WeiboSpiderConfig
  cookieValid: boolean
  cookieMessage: string
  users: WeiboUser[]
  posts: WeiboPost[]
  crawledUsers: number
  crawledWeibos: number
  outputPaths: string[]
  downloadedFiles: string[]
  warnings: string[]
  errors: string[]
}

export type WeiboSpiderResult = NodeRunResult<WeiboSpiderData>

export interface NormalizedWeiboSpiderInput {
  action: WeiboSpiderAction
  userIds: Array<string | WeiboUserConfigInput> | string
  filterOriginal: boolean
  sinceDate: string | number
  endDate: string
  picDownload: boolean
  videoDownload: boolean
  writeMode: string[]
  outputDir: string
  cookie: string
  browser: WeiboSpiderBrowser
  randomWaitPages: [number, number]
  randomWaitSeconds: [number, number]
  globalWait: Array<[number, number]>
  configPath: string
  importPath: string
  exportPath: string
  maxPages: number
  timeoutMs: number
  online: boolean
  dryRun: boolean
  downloadMedia: boolean
  provided: {
    userIds: boolean
    filterOriginal: boolean
    sinceDate: boolean
    endDate: boolean
    picDownload: boolean
    videoDownload: boolean
    writeMode: boolean
    outputDir: boolean
    cookie: boolean
    randomWaitPages: boolean
    randomWaitSeconds: boolean
    globalWait: boolean
  }
}

const SUPPORTED_WRITE_MODES = new Set(["json", "csv", "txt"])

export function defaultWeiboSpiderConfig(): WeiboSpiderConfig {
  return {
    user_id_list: [],
    filter: 1,
    since_date: oneYearAgo(new Date()),
    end_date: "now",
    random_wait_pages: [1, 5],
    random_wait_seconds: [6, 10],
    global_wait: [[1000, 3600], [500, 2000]],
    write_mode: ["json"],
    pic_download: 1,
    video_download: 1,
    file_download_timeout: [5, 5, 10],
    result_dir_name: 0,
    cookie: "",
  }
}

export function normalizeWeiboSpiderInput(input: WeiboSpiderInput = {}): NormalizedWeiboSpiderInput {
  const action = input.action ?? "status"
  const provided = {
    userIds: input.userIds !== undefined || input.user_ids !== undefined,
    filterOriginal: input.filterOriginal !== undefined || input.filter_original !== undefined,
    sinceDate: input.sinceDate !== undefined || input.since_date !== undefined,
    endDate: input.endDate !== undefined || input.end_date !== undefined,
    picDownload: input.picDownload !== undefined || input.pic_download !== undefined,
    videoDownload: input.videoDownload !== undefined || input.video_download !== undefined,
    writeMode: input.writeMode !== undefined || input.write_mode !== undefined,
    outputDir: input.outputDir !== undefined || input.output_dir !== undefined,
    cookie: input.cookie !== undefined,
    randomWaitPages: input.randomWaitPages !== undefined || input.random_wait_pages !== undefined,
    randomWaitSeconds: input.randomWaitSeconds !== undefined || input.random_wait_seconds !== undefined,
    globalWait: input.globalWait !== undefined || input.global_wait !== undefined,
  }
  return {
    action,
    userIds: input.userIds ?? input.user_ids ?? [],
    filterOriginal: input.filterOriginal ?? input.filter_original ?? true,
    sinceDate: input.sinceDate ?? input.since_date ?? oneYearAgo(new Date()),
    endDate: input.endDate ?? input.end_date ?? "now",
    picDownload: input.picDownload ?? input.pic_download ?? true,
    videoDownload: input.videoDownload ?? input.video_download ?? true,
    writeMode: normalizeWriteMode(input.writeMode ?? input.write_mode ?? ["json"]),
    outputDir: clean(input.outputDir ?? input.output_dir),
    cookie: parseCookieInput(input.cookie ?? ""),
    browser: normalizeBrowser(input.browser),
    randomWaitPages: normalizeNumberPair(input.randomWaitPages ?? input.random_wait_pages, [1, 5]),
    randomWaitSeconds: normalizeNumberPair(input.randomWaitSeconds ?? input.random_wait_seconds, [6, 10]),
    globalWait: normalizeGlobalWait(input.globalWait ?? input.global_wait),
    configPath: clean(input.configPath ?? input.config_path),
    importPath: clean(input.importPath ?? input.import_path),
    exportPath: clean(input.exportPath ?? input.export_path),
    maxPages: Math.max(0, Math.floor(input.maxPages ?? input.max_pages ?? 0)),
    timeoutMs: Math.max(1000, Math.floor(input.timeoutMs ?? input.timeout_ms ?? 15000)),
    online: input.online ?? true,
    dryRun: input.dryRun ?? input.dry_run ?? false,
    downloadMedia: input.downloadMedia ?? input.download_media ?? true,
    provided,
  }
}

export async function runWeiboSpider(
  input: WeiboSpiderInput,
  runtime: WeiboSpiderRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<WeiboSpiderResult> {
  const normalized = normalizeWeiboSpiderInput(input)
  try {
    if (normalized.action === "status") return await runStatus(normalized, runtime)
    if (normalized.action === "load_config") return await runLoadConfig(normalized, runtime)
    if (normalized.action === "save_config") return await runSaveConfig(normalized, runtime, onEvent)
    if (normalized.action === "import_config") return await runImportConfig(normalized, runtime, onEvent)
    if (normalized.action === "export_config") return await runExportConfig(normalized, runtime, onEvent)
    if (normalized.action === "validate_cookie") return await runValidateCookie(normalized, runtime, onEvent)
    if (normalized.action === "get_browser_cookie") return await runGetBrowserCookie(normalized, runtime, onEvent)
    return await runCrawl(normalized, runtime, onEvent)
  } catch (error) {
    return failure(normalized.action, error instanceof Error ? error.message : String(error))
  }
}

export function mergeConfig(existing: unknown, input: NormalizedWeiboSpiderInput | WeiboSpiderInput): WeiboSpiderConfig {
  const normalized = "provided" in input ? input : normalizeWeiboSpiderInput(input)
  const base = normalizeConfig(existing)
  const userIds = normalizeUserIdInput(normalized.userIds)
  const next: WeiboSpiderConfig = {
    ...base,
    user_id_list: normalized.provided.userIds && userIds.length ? userIds : base.user_id_list,
    filter: normalized.provided.filterOriginal ? normalized.filterOriginal ? 1 : 0 : base.filter,
    since_date: normalized.provided.sinceDate ? normalized.sinceDate || base.since_date : base.since_date,
    end_date: normalized.provided.endDate ? normalized.endDate || base.end_date : base.end_date,
    random_wait_pages: normalized.provided.randomWaitPages ? normalized.randomWaitPages : base.random_wait_pages,
    random_wait_seconds: normalized.provided.randomWaitSeconds ? normalized.randomWaitSeconds : base.random_wait_seconds,
    global_wait: normalized.provided.globalWait && normalized.globalWait.length ? normalized.globalWait : base.global_wait,
    write_mode: normalized.provided.writeMode && normalized.writeMode.length ? normalized.writeMode : base.write_mode,
    pic_download: normalized.provided.picDownload ? normalized.picDownload ? 1 : 0 : base.pic_download,
    video_download: normalized.provided.videoDownload ? normalized.videoDownload ? 1 : 0 : base.video_download,
    cookie: normalized.provided.cookie ? normalized.cookie || base.cookie : base.cookie,
    output_dir: normalized.provided.outputDir ? normalized.outputDir || base.output_dir : base.output_dir,
  }
  return normalizeConfig(next)
}

export function normalizeConfig(value: unknown): WeiboSpiderConfig {
  const record = asRecord(value)
  const defaults = defaultWeiboSpiderConfig()
  return {
    ...defaults,
    ...record,
    user_id_list: normalizeUserIdInput(record.user_id_list ?? defaults.user_id_list),
    filter: toFlag(record.filter, defaults.filter),
    since_date: typeof record.since_date === "number" ? record.since_date : clean(String(record.since_date ?? defaults.since_date)),
    end_date: clean(String(record.end_date ?? defaults.end_date)) || "now",
    random_wait_pages: normalizeNumberPair(record.random_wait_pages, defaults.random_wait_pages),
    random_wait_seconds: normalizeNumberPair(record.random_wait_seconds, defaults.random_wait_seconds),
    global_wait: normalizeGlobalWait(record.global_wait),
    write_mode: normalizeWriteMode(record.write_mode ?? defaults.write_mode),
    pic_download: toFlag(record.pic_download, defaults.pic_download),
    video_download: toFlag(record.video_download, defaults.video_download),
    file_download_timeout: normalizeTriple(record.file_download_timeout, defaults.file_download_timeout),
    result_dir_name: toFlag(record.result_dir_name, defaults.result_dir_name),
    cookie: parseCookieInput(String(record.cookie ?? "")),
    output_dir: clean(String(record.output_dir ?? "")) || undefined,
  }
}

export function validateConfig(config: WeiboSpiderConfig): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  if (![0, 1].includes(config.filter)) errors.push("filter must be 0 or 1.")
  if (![0, 1].includes(config.pic_download)) errors.push("pic_download must be 0 or 1.")
  if (![0, 1].includes(config.video_download)) errors.push("video_download must be 0 or 1.")
  if (!isDateLike(config.since_date)) errors.push("since_date must be yyyy-mm-dd, yyyy-mm-dd HH:mm, or integer days.")
  if (config.end_date !== "now" && !isDateLike(config.end_date)) errors.push("end_date must be yyyy-mm-dd, yyyy-mm-dd HH:mm, or now.")
  if (!pairIsPositive(config.random_wait_pages)) errors.push("random_wait_pages must contain positive integers.")
  if (!pairIsPositive(config.random_wait_seconds)) errors.push("random_wait_seconds must contain positive integers.")
  if (!config.global_wait.length || config.global_wait.some((item) => !pairIsPositive(item))) errors.push("global_wait must contain [pages, seconds] pairs.")
  if (!normalizeUserIdInput(config.user_id_list).length && typeof config.user_id_list !== "string") errors.push("user_id_list must contain at least one user id.")
  for (const mode of config.write_mode) {
    if (!SUPPORTED_WRITE_MODES.has(mode)) warnings.push(`write_mode ${mode} is not written by the TypeScript package; supported modes are json, csv, txt.`)
  }
  return { errors, warnings }
}

export function parseCookieInput(value: string): string {
  const trimmed = clean(value)
  if (!trimmed) return ""
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      const record = asRecord(parsed)
      if (typeof record.cookie === "string") return clean(record.cookie)
      const pairs = Object.entries(record)
        .filter(([, item]) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
        .map(([key, item]) => `${key}=${String(item)}`)
      if (pairs.length) return pairs.join("; ")
    } catch {
      return trimmed
    }
  }
  return trimmed
}

export function parseCookieString(cookie: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const part of cookie.split(";")) {
    const index = part.indexOf("=")
    if (index <= 0) continue
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (key) result[key] = value
  }
  return result
}

export function validateCookieFields(cookie: string): { valid: boolean; message: string; fields: Record<string, boolean> } {
  const fields = parseCookieString(cookie)
  const hasSub = Boolean(fields.SUB)
  const hasMlogin = fields.MLOGIN === "1" || Boolean(fields.SUB)
  const hasAlf = Boolean(fields.ALF)
  if (!cookie) return { valid: false, message: "Cookie is empty.", fields: { SUB: false, MLOGIN: false, ALF: false } }
  if (!hasSub) return { valid: false, message: "Cookie is missing SUB.", fields: { SUB: false, MLOGIN: hasMlogin, ALF: hasAlf } }
  return { valid: true, message: hasAlf ? "Cookie fields look valid." : "Cookie has SUB; ALF is missing but not required.", fields: { SUB: true, MLOGIN: hasMlogin, ALF: hasAlf } }
}

export async function validateCookieOnline(cookie: string, runtime: WeiboSpiderRuntime, timeoutMs = 10000): Promise<{ valid: boolean; message: string }> {
  const local = validateCookieFields(cookie)
  if (!local.valid) return { valid: false, message: local.message }
  try {
    const response = await runtime.fetchText("https://weibo.cn/account/setting", { cookie, timeoutMs, noRedirect: true })
    const location = response.headers.location ?? response.headers.Location ?? ""
    if (response.status >= 300 && response.status < 400 && /login|passport/i.test(location)) {
      return { valid: false, message: "Cookie redirects to login." }
    }
    if (response.status === 200) {
      const text = response.text
      if (/(setting|account|\u8bbe\u7f6e|\u8d26\u53f7)/i.test(text)) return { valid: true, message: "Cookie is valid." }
      if (/(login|\u767b\u5f55)/i.test(text)) return { valid: false, message: "Cookie is not logged in." }
    }
    return { valid: true, message: "Cookie passed local checks; online state is uncertain." }
  } catch (error) {
    return { valid: true, message: `Cookie passed local checks; online check failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export function buildUserConfigList(config: WeiboSpiderConfig, userFileText = ""): WeiboUserConfig[] {
  const baseSince = normalizeDateValue(config.since_date, new Date())
  const endDate = config.end_date || "now"
  if (typeof config.user_id_list === "string") {
    return parseUserListText(userFileText, baseSince).map((item) => ({ ...item, end_date: item.end_date || endDate }))
  }
  const seen = new Set<string>()
  const users: WeiboUserConfig[] = []
  for (const item of config.user_id_list) {
    const record = typeof item === "string" ? { id: item } : item
    const userUri = clean(record.id)
    if (!userUri || seen.has(userUri)) continue
    seen.add(userUri)
    users.push({
      user_uri: userUri,
      since_date: clean(record.since_date) || baseSince,
      end_date: clean(record.end_date) || endDate,
    })
  }
  return users
}

export function parseUserListText(text: string, defaultSinceDate: string): WeiboUserConfig[] {
  const users: WeiboUserConfig[] = []
  const seen = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/).filter(Boolean)
    if (!parts[0] || !/^\d+$/.test(parts[0]) || seen.has(parts[0])) continue
    seen.add(parts[0])
    const since = parts[2] && isDateLike(parts[2]) ? parts[3] && isDateLike(`${parts[2]} ${parts[3]}`) ? `${parts[2]} ${parts[3]}` : parts[2] : defaultSinceDate
    users.push({ user_uri: parts[0], since_date: since, end_date: "now" })
  }
  return users
}

export function parseProfileHtml(html: string, userUri: string): { user: WeiboUser; pageNum: number } {
  const infoHref = firstMatch(html, /href=["']\/?(\d+)\/info["']/i)
  const title = stripHtml(firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i))
  const tip2Html = firstMatch(html, /<div[^>]*class=["']tip2["'][^>]*>([\s\S]*?)<\/div>/i)
  const tipText = stripHtml(tip2Html)
  const counts = [...tipText.matchAll(/\[(.*?)\]|(\d+(?:\.\d+)?[\u4e07\u4ebf]?)/g)].map((match) => stringToInt(match[1] ?? match[2] ?? "0"))
  const nickname = clean(title.replace(/\u7684\u5fae\u535a.*$/u, "").replace(/\u5fae\u535a.*$/u, "")) || userUri
  return {
    user: {
      id: infoHref || userUri,
      nickname,
      gender: "",
      location: "",
      birthday: "",
      description: "",
      verified_reason: "",
      talent: "",
      education: "",
      work: "",
      weibo_num: counts[0] ?? 0,
      following: counts[1] ?? 0,
      followers: counts[2] ?? 0,
    },
    pageNum: Math.max(1, Number(firstMatch(html, /<input[^>]*name=["']mp["'][^>]*value=["'](\d+)["']/i)) || 1),
  }
}

export function parseWeiboPageHtml(html: string, options: { userId: string; filterOriginal: boolean; now: Date }): { posts: WeiboPost[]; toContinue: boolean } {
  const blocks = extractWeiboBlocks(html)
  const posts: WeiboPost[] = []
  for (const block of blocks) {
    const post = parseWeiboBlock(block.html, block.id, options.userId, options.now)
    if (!post) continue
    if (options.filterOriginal && !post.original) continue
    posts.push(post)
  }
  return { posts, toContinue: blocks.length > 0 }
}

export function buildProfileUrl(userUri: string): string {
  return `https://weibo.cn/${encodeURIComponent(userUri)}/profile`
}

export function buildPageUrl(userUri: string, page: number, sinceDate: string, endDate: string): string {
  if (endDate && endDate !== "now") {
    const start = dateCompact(sinceDate)
    const end = dateCompact(endDate)
    return `https://weibo.cn/${encodeURIComponent(userUri)}/profile?starttime=${start}&endtime=${end}&advancedfilter=1&page=${page}`
  }
  return `https://weibo.cn/${encodeURIComponent(userUri)}/profile?page=${page}`
}

async function runStatus(normalized: NormalizedWeiboSpiderInput, runtime: WeiboSpiderRuntime): Promise<WeiboSpiderResult> {
  const configPath = resolveConfigPath(normalized, runtime)
  const info = await runtime.pathInfo(configPath)
  return success("status", "Status loaded.", emptyData("status", { configPath, hasConfig: info.exists }))
}

async function runLoadConfig(normalized: NormalizedWeiboSpiderInput, runtime: WeiboSpiderRuntime): Promise<WeiboSpiderResult> {
  const configPath = resolveConfigPath(normalized, runtime)
  const info = await runtime.pathInfo(configPath)
  if (!info.exists) return failure("load_config", `Config file does not exist: ${configPath}`, { configPath })
  let config = readJsonObject(await runtime.readText(configPath))
  if (isCookieOnlyConfig(config)) {
    const defaultPath = runtime.defaultConfigPath()
    const defaultInfo = await runtime.pathInfo(defaultPath)
    const defaults = defaultInfo.exists ? readJsonObject(await runtime.readText(defaultPath)) : defaultWeiboSpiderConfig()
    config = { ...asRecord(defaults), cookie: String(asRecord(config).cookie ?? "") }
  }
  const normalizedConfig = normalizeConfig(config)
  return success("load_config", "Config loaded.", emptyData("load_config", { configPath, hasConfig: true, configData: normalizedConfig, outputDir: normalizedConfig.output_dir ?? "" }))
}

async function runSaveConfig(normalized: NormalizedWeiboSpiderInput, runtime: WeiboSpiderRuntime, onEvent: (event: NodeRunEvent) => void): Promise<WeiboSpiderResult> {
  const configPath = resolveConfigPath(normalized, runtime)
  const existing = await readConfigIfExists(configPath, runtime)
  const config = mergeConfig(existing, normalized)
  await runtime.ensureDir(runtime.dirname(configPath))
  await runtime.writeText(configPath, `${JSON.stringify(config, null, 2)}\n`)
  onEvent({ type: "log", message: `Saved config: ${configPath}` })
  return success("save_config", "Config saved.", emptyData("save_config", { configPath, hasConfig: true, configData: config, outputDir: config.output_dir ?? "" }))
}

async function runImportConfig(normalized: NormalizedWeiboSpiderInput, runtime: WeiboSpiderRuntime, onEvent: (event: NodeRunEvent) => void): Promise<WeiboSpiderResult> {
  if (!normalized.importPath) return failure("import_config", "Import path is required.")
  const configPath = resolveConfigPath(normalized, runtime)
  const imported = readJsonObject(await runtime.readText(normalized.importPath))
  const existing = await readConfigIfExists(configPath, runtime)
  const merged = normalizeConfig({ ...asRecord(existing), ...asRecord(imported) })
  await runtime.ensureDir(runtime.dirname(configPath))
  await runtime.writeText(configPath, `${JSON.stringify(merged, null, 2)}\n`)
  onEvent({ type: "log", message: `Imported config: ${normalized.importPath}` })
  return success("import_config", "Config imported.", emptyData("import_config", { configPath, hasConfig: true, configData: merged, outputDir: merged.output_dir ?? "" }))
}

async function runExportConfig(normalized: NormalizedWeiboSpiderInput, runtime: WeiboSpiderRuntime, onEvent: (event: NodeRunEvent) => void): Promise<WeiboSpiderResult> {
  if (!normalized.exportPath) return failure("export_config", "Export path is required.")
  const configPath = resolveConfigPath(normalized, runtime)
  const existing = await readConfigIfExists(configPath, runtime)
  const config = normalizeConfig(Object.keys(asRecord(existing)).length ? existing : mergeConfig({}, normalized))
  await runtime.ensureDir(runtime.dirname(normalized.exportPath))
  await runtime.writeText(normalized.exportPath, `${JSON.stringify(config, null, 2)}\n`)
  onEvent({ type: "log", message: `Exported config: ${normalized.exportPath}` })
  return success("export_config", "Config exported.", emptyData("export_config", { configPath, hasConfig: true, configData: config, outputPaths: [normalized.exportPath], outputDir: config.output_dir ?? "" }))
}

async function runValidateCookie(normalized: NormalizedWeiboSpiderInput, runtime: WeiboSpiderRuntime, onEvent: (event: NodeRunEvent) => void): Promise<WeiboSpiderResult> {
  const configPath = resolveConfigPath(normalized, runtime)
  const existing = await readConfigIfExists(configPath, runtime)
  const cookie = normalized.cookie || normalizeConfig(existing).cookie
  const result = normalized.online
    ? await validateCookieOnline(cookie, runtime, normalized.timeoutMs)
    : validateCookieFields(cookie)
  onEvent({ type: "log", message: result.message })
  return {
    success: true,
    message: result.message,
    data: emptyData("validate_cookie", { configPath, hasConfig: Object.keys(asRecord(existing)).length > 0, cookieValid: result.valid, cookieMessage: result.message }),
  }
}

async function runGetBrowserCookie(normalized: NormalizedWeiboSpiderInput, runtime: WeiboSpiderRuntime, onEvent: (event: NodeRunEvent) => void): Promise<WeiboSpiderResult> {
  if (!runtime.getBrowserCookie) return failure("get_browser_cookie", "Browser cookie acquisition is not available in this runtime.")
  const result = await runtime.getBrowserCookie(normalized.browser, onEvent)
  if (result.success && result.cookie) {
    const configPath = resolveConfigPath(normalized, runtime)
    const existing = await readConfigIfExists(configPath, runtime)
    const config = normalizeConfig({ ...asRecord(existing), cookie: result.cookie })
    await runtime.ensureDir(runtime.dirname(configPath))
    await runtime.writeText(configPath, `${JSON.stringify(config, null, 2)}\n`)
  }
  return {
    success: result.success,
    message: result.message,
    data: emptyData("get_browser_cookie", { cookieValid: result.success, cookieMessage: result.message, configData: normalizeConfig({ cookie: result.cookie }) }),
  }
}

async function runCrawl(normalized: NormalizedWeiboSpiderInput, runtime: WeiboSpiderRuntime, onEvent: (event: NodeRunEvent) => void): Promise<WeiboSpiderResult> {
  const configPath = resolveConfigPath(normalized, runtime)
  const existing = await readConfigIfExists(configPath, runtime)
  const config = mergeConfig(existing, normalized)
  const validation = validateConfig(config)
  const cookieValidation = validateCookieFields(config.cookie)
  if (!cookieValidation.valid) validation.errors.push(cookieValidation.message)
  if (validation.errors.length) return failure("crawl", validation.errors.join(" "), { configPath, configData: config, warnings: validation.warnings, errors: validation.errors })

  await runtime.ensureDir(runtime.dirname(configPath))
  await runtime.writeText(configPath, `${JSON.stringify(config, null, 2)}\n`)

  const userFileText = typeof config.user_id_list === "string" ? await runtime.readText(config.user_id_list) : ""
  const userConfigs = buildUserConfigList(config, userFileText)
  if (!userConfigs.length) return failure("crawl", "No user ids to crawl.", { configPath, configData: config })

  const outputDir = runtime.resolve(normalized.outputDir || config.output_dir || runtime.defaultOutputDir())
  const users: WeiboUser[] = []
  const posts: WeiboPost[] = []
  const outputPaths: string[] = []
  const downloadedFiles: string[] = []
  const warnings = [...validation.warnings]
  const errors: string[] = []

  for (let userIndex = 0; userIndex < userConfigs.length; userIndex += 1) {
    const userConfig = userConfigs[userIndex]!
    onEvent({ type: "progress", progress: progressFor(userIndex, userConfigs.length, 5, 90), message: `Crawling ${userConfig.user_uri}` })
    try {
      const profile = await runtime.fetchText(buildProfileUrl(userConfig.user_uri), { cookie: config.cookie, timeoutMs: normalized.timeoutMs })
      if (profile.status >= 300 && profile.status < 400) {
        errors.push(`Profile redirected for ${userConfig.user_uri}; cookie may be expired.`)
        continue
      }
      const parsedProfile = parseProfileHtml(profile.text, userConfig.user_uri)
      const user = parsedProfile.user
      users.push(user)
      const userPosts = await crawlUserPages(userConfig, user, parsedProfile.pageNum, config, normalized, profile.text, runtime, onEvent)
      posts.push(...userPosts)
      const written = await writeUserOutputs(user, userPosts, config, outputDir, runtime)
      outputPaths.push(...written)
      if (normalized.downloadMedia && !normalized.dryRun) {
        const downloaded = await downloadPostMedia(user, userPosts, config, outputDir, runtime, onEvent)
        downloadedFiles.push(...downloaded)
      }
    } catch (error) {
      errors.push(`${userConfig.user_uri}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  onEvent({ type: "progress", progress: 100, message: "Crawl complete." })
  const data = emptyData("crawl", {
    configPath,
    outputDir,
    hasConfig: true,
    configData: config,
    cookieValid: true,
    cookieMessage: cookieValidation.message,
    users,
    posts,
    crawledUsers: users.length,
    crawledWeibos: posts.length,
    outputPaths: unique(outputPaths),
    downloadedFiles,
    warnings,
    errors,
  })
  return {
    success: errors.length === 0,
    message: `Crawl complete: ${users.length} user(s), ${posts.length} weibo(s), ${errors.length} error(s).`,
    data,
    stats: { users: users.length, weibos: posts.length, errors: errors.length },
    outputPath: outputDir,
  }
}

async function crawlUserPages(
  userConfig: WeiboUserConfig,
  user: WeiboUser,
  profilePageNum: number,
  config: WeiboSpiderConfig,
  input: NormalizedWeiboSpiderInput,
  profileHtml: string,
  runtime: WeiboSpiderRuntime,
  onEvent: (event: NodeRunEvent) => void,
): Promise<WeiboPost[]> {
  const pageLimit = input.maxPages > 0 ? Math.min(input.maxPages, profilePageNum) : profilePageNum
  const posts: WeiboPost[] = []
  const seen = new Set<string>()
  let stop = false
  let olderPinnedCount = 0
  const sinceMs = dateMs(userConfig.since_date, runtime.now())
  for (let page = 1; page <= pageLimit && !stop; page += 1) {
    const html = page === 1 && userConfig.end_date === "now"
      ? profileHtml
      : (await runtime.fetchText(buildPageUrl(userConfig.user_uri, page, userConfig.since_date, userConfig.end_date), { cookie: config.cookie, timeoutMs: input.timeoutMs })).text
    const parsed = parseWeiboPageHtml(html, { userId: user.id, filterOriginal: config.filter === 1, now: runtime.now() })
    for (const post of parsed.posts) {
      if (seen.has(post.id)) continue
      seen.add(post.id)
      const published = dateMs(post.publish_time, runtime.now())
      if (sinceMs > 0 && published > 0 && published < sinceMs) {
        if (page === 1 && olderPinnedCount < 2) {
          olderPinnedCount += 1
          continue
        }
        stop = true
        break
      }
      posts.push(post)
    }
    onEvent({ type: "progress", progress: 10 + Math.round((page / Math.max(pageLimit, 1)) * 70), message: `${user.nickname || user.id}: page ${page}/${pageLimit}, ${posts.length} post(s)` })
    if (!parsed.toContinue) stop = true
  }
  return posts
}

async function writeUserOutputs(user: WeiboUser, posts: WeiboPost[], config: WeiboSpiderConfig, outputDir: string, runtime: WeiboSpiderRuntime): Promise<string[]> {
  const dirName = sanitizePathSegment(config.result_dir_name ? user.id : user.nickname || user.id)
  const userDir = runtime.join(outputDir, dirName)
  await runtime.ensureDir(userDir)
  const paths: string[] = []
  const modes = config.write_mode.filter((mode) => SUPPORTED_WRITE_MODES.has(mode)) as WeiboSpiderWriteMode[]
  if (modes.includes("json")) {
    const path = runtime.join(userDir, `${user.id}.json`)
    const existing = await readJsonIfExists(path, runtime)
    const oldPosts = Array.isArray(asRecord(existing).weibo) ? asRecord(existing).weibo as unknown[] : []
    const merged = mergePosts(oldPosts.map(normalizePost).filter(Boolean) as WeiboPost[], posts)
    await runtime.writeText(path, `${JSON.stringify({ user, weibo: merged }, null, 2)}\n`)
    paths.push(path)
  }
  if (modes.includes("csv")) {
    const path = runtime.join(userDir, `${user.id}.csv`)
    await runtime.writeText(path, toCsv(posts, config.filter === 1))
    paths.push(path)
  }
  if (modes.includes("txt")) {
    const path = runtime.join(userDir, `${user.id}.txt`)
    await runtime.writeText(path, toTxt(user, posts, config.filter === 1))
    paths.push(path)
  }
  return paths
}

async function downloadPostMedia(user: WeiboUser, posts: WeiboPost[], config: WeiboSpiderConfig, outputDir: string, runtime: WeiboSpiderRuntime, onEvent: (event: NodeRunEvent) => void): Promise<string[]> {
  if (!runtime.downloadFile) return []
  const dirName = sanitizePathSegment(config.result_dir_name ? user.id : user.nickname || user.id)
  const imgDir = runtime.join(outputDir, dirName, "img")
  const videoDir = runtime.join(outputDir, dirName, "video")
  const downloaded: string[] = []
  for (const post of posts) {
    if (config.pic_download === 1) {
      const pictures = [...post.original_pictures, ...post.retweet_pictures].filter(Boolean)
      for (let index = 0; index < pictures.length; index += 1) {
        const target = runtime.join(imgDir, `${post.id}_${index + 1}${extensionFromUrl(pictures[index]!, ".jpg")}`)
        await runtime.ensureDir(runtime.dirname(target))
        await runtime.downloadFile(pictures[index]!, target, { cookie: config.cookie, timeoutMs: config.file_download_timeout[2] * 1000 })
        downloaded.push(target)
        onEvent({ type: "log", message: `Downloaded image: ${target}` })
      }
    }
    if (config.video_download === 1 && post.video_url) {
      const target = runtime.join(videoDir, `${post.id}${extensionFromUrl(post.video_url, ".mp4")}`)
      await runtime.ensureDir(runtime.dirname(target))
      await runtime.downloadFile(post.video_url, target, { cookie: config.cookie, timeoutMs: config.file_download_timeout[2] * 1000 })
      downloaded.push(target)
      onEvent({ type: "log", message: `Downloaded video: ${target}` })
    }
  }
  return downloaded
}

function parseWeiboBlock(block: string, id: string, userId: string, now: Date): WeiboPost | null {
  const cmtCount = (block.match(/class=["']cmt["']/g) ?? []).length
  const original = cmtCount <= 3
  const ctt = firstMatch(block, /<span[^>]*class=["']ctt["'][^>]*>([\s\S]*?)(?:<\/span>|<span[^>]*class=["']ct["'])/i)
  const fallbackText = stripHtml(block).split(/\u8d5e\[/u)[0] ?? ""
  const content = clean(stripHtml(ctt) || fallbackText).replace(/^[:\s]+/, "")
  const ct = stripHtml(firstMatch(block, /<span[^>]*class=["']ct["'][^>]*>([\s\S]*?)<\/span>/i))
  const [publishRaw, toolRaw] = ct.split(/\u6765\u81ea/u)
  const pictures = extractPictureUrls(block)
  const videoUrl = firstMatch(block, /href=["']([^"']*m\.weibo\.cn\/s\/video\/show\?object_id=[^"']+)["']/i)
    || firstMatch(block, /href=["']([^"']*video[^"']+)["']/i)
  const text = stripHtml(block)
  if (!id || !content) return null
  return {
    id,
    user_id: userId,
    content,
    article_url: firstMatch(block, /href=["'](https:\/\/weibo\.com\/ttarticle[^"']+)["']/i),
    original_pictures: pictures,
    retweet_pictures: original ? [] : pictures,
    original,
    video_url: decodeHtml(videoUrl),
    publish_place: "",
    publish_time: normalizePublishTime(clean(publishRaw), now),
    publish_tool: clean(toolRaw) || "",
    up_num: numberAfter(text, "\u8d5e"),
    retweet_num: numberAfter(text, "\u8f6c\u53d1"),
    comment_num: numberAfter(text, "\u8bc4\u8bba"),
  }
}

function extractWeiboBlocks(html: string): Array<{ id: string; html: string }> {
  const starts = [...html.matchAll(/<div[^>]*class=["']c["'][^>]*id=["']M_?([^"']+)["'][^>]*>/gi)]
  return starts.map((match, index) => {
    const start = match.index ?? 0
    const end = index + 1 < starts.length ? starts[index + 1]!.index ?? html.length : html.length
    return { id: match[1] ?? "", html: html.slice(start, end) }
  })
}

function extractPictureUrls(block: string): string[] {
  const urls = [
    ...[...block.matchAll(/<img[^>]*src=["']([^"']+)["']/gi)].map((match) => match[1] ?? ""),
    ...[...block.matchAll(/href=["']([^"']+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^"']*)?)["']/gi)].map((match) => match[1] ?? ""),
  ]
  return unique(urls
    .map(decodeHtml)
    .filter((url) => /sinaimg|\.jpg|\.jpeg|\.png|\.gif|\.webp/i.test(url))
    .map((url) => url.replace("/wap180/", "/large/").replace("/thumb180/", "/large/")))
}

function mergePosts(existing: WeiboPost[], next: WeiboPost[]): WeiboPost[] {
  const map = new Map<string, WeiboPost>()
  for (const post of existing) map.set(post.id, post)
  for (const post of next) map.set(post.id, post)
  return [...map.values()].sort((a, b) => b.publish_time.localeCompare(a.publish_time))
}

function toCsv(posts: WeiboPost[], filterOriginal: boolean): string {
  const headers = [
    ["weibo_id", "id"],
    ["content", "content"],
    ["article_url", "article_url"],
    ["original_pictures", "original_pictures"],
    ...(filterOriginal ? [] : [["retweet_pictures", "retweet_pictures"], ["original", "original"]] as Array<[string, keyof WeiboPost]>),
    ["video_url", "video_url"],
    ["publish_place", "publish_place"],
    ["publish_time", "publish_time"],
    ["publish_tool", "publish_tool"],
    ["up_num", "up_num"],
    ["retweet_num", "retweet_num"],
    ["comment_num", "comment_num"],
  ] as Array<[string, keyof WeiboPost]>
  const rows = [headers.map(([label]) => label)]
  for (const post of posts) {
    rows.push(headers.map(([, key]) => Array.isArray(post[key]) ? (post[key] as string[]).join(",") : String(post[key] ?? "")))
  }
  return `${rows.map((row) => row.map(escapeCsv).join(",")).join("\n")}\n`
}

function toTxt(user: WeiboUser, posts: WeiboPost[], filterOriginal: boolean): string {
  const lines = [
    "User:",
    `nickname: ${user.nickname}`,
    `id: ${user.id}`,
    `weibo_num: ${user.weibo_num}`,
    `following: ${user.following}`,
    `followers: ${user.followers}`,
    "",
    filterOriginal ? "Original weibos:" : "Weibos:",
  ]
  for (const post of posts) {
    lines.push(
      "",
      post.content,
      `publish_place: ${post.publish_place}`,
      `publish_time: ${post.publish_time}`,
      `up_num: ${post.up_num}`,
      `retweet_num: ${post.retweet_num}`,
      `comment_num: ${post.comment_num}`,
      `publish_tool: ${post.publish_tool}`,
      `url: https://weibo.cn/comment/${post.id}`,
    )
  }
  return `${lines.join("\n")}\n`
}

function emptyData(action: WeiboSpiderAction, partial: Partial<WeiboSpiderData> = {}): WeiboSpiderData {
  return {
    action,
    configPath: "",
    outputDir: "",
    hasConfig: false,
    configData: defaultWeiboSpiderConfig(),
    cookieValid: false,
    cookieMessage: "",
    users: [],
    posts: [],
    crawledUsers: 0,
    crawledWeibos: 0,
    outputPaths: [],
    downloadedFiles: [],
    warnings: [],
    errors: [],
    ...partial,
  }
}

function success(action: WeiboSpiderAction, message: string, data: WeiboSpiderData): WeiboSpiderResult {
  return { success: true, message, data }
}

function failure(action: WeiboSpiderAction, message: string, partial: Partial<WeiboSpiderData> = {}): WeiboSpiderResult {
  return { success: false, message, data: emptyData(action, { errors: [message], ...partial }) }
}

async function readConfigIfExists(configPath: string, runtime: WeiboSpiderRuntime): Promise<unknown> {
  const info = await runtime.pathInfo(configPath)
  if (!info.exists) return {}
  return readJsonObject(await runtime.readText(configPath))
}

async function readJsonIfExists(path: string, runtime: WeiboSpiderRuntime): Promise<unknown> {
  const info = await runtime.pathInfo(path)
  if (!info.exists) return {}
  return readJsonObject(await runtime.readText(path))
}

function readJsonObject(text: string): unknown {
  return JSON.parse(text) as unknown
}

function resolveConfigPath(input: NormalizedWeiboSpiderInput, runtime: WeiboSpiderRuntime): string {
  return runtime.resolve(input.configPath || runtime.defaultConfigPath())
}

function isCookieOnlyConfig(value: unknown): boolean {
  const record = asRecord(value)
  return Object.keys(record).length === 1 && typeof record.cookie === "string"
}

function normalizeUserIdInput(value: unknown): Array<string | { id: string; since_date?: string; end_date?: string }> | string {
  if (typeof value === "string") {
    const trimmed = clean(value)
    if (trimmed.endsWith(".txt") || /[\\/]/.test(trimmed)) return trimmed
    return unique(trimmed.split(/[,;\s]+/).map(clean).filter(Boolean))
  }
  if (!Array.isArray(value)) return []
  const normalized: Array<string | { id: string; since_date?: string; end_date?: string }> = []
  for (const item of value) {
    if (typeof item === "string") {
      const id = clean(item)
      if (id) normalized.push(id)
      continue
    }
    const record = asRecord(item)
    const id = clean(String(record.id ?? record.user_uri ?? ""))
    if (!id) continue
    normalized.push({
      id,
      since_date: clean(String(record.since_date ?? record.sinceDate ?? "")) || undefined,
      end_date: clean(String(record.end_date ?? record.endDate ?? "")) || undefined,
    })
  }
  return normalized
}

function normalizeWriteMode(value: unknown): string[] {
  if (Array.isArray(value)) return unique(value.map(String).map((item) => clean(item).toLowerCase()).filter(Boolean))
  if (typeof value === "string") return unique(value.split(/[,;\s]+/).map((item) => clean(item).toLowerCase()).filter(Boolean))
  return ["json"]
}

function normalizeBrowser(value: unknown): WeiboSpiderBrowser {
  const browser = clean(String(value ?? "edge")).toLowerCase()
  if (browser === "chrome" || browser === "firefox") return browser
  return "edge"
}

function normalizeNumberPair(value: unknown, fallback: [number, number]): [number, number] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;\s]+/) : []
  const nums = list.map(Number).filter(Number.isFinite).map((item) => Math.max(1, Math.floor(item)))
  if (nums.length < 2) return fallback
  return [Math.min(nums[0]!, nums[1]!), Math.max(nums[0]!, nums[1]!)]
}

function normalizeTriple(value: unknown, fallback: [number, number, number]): [number, number, number] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;\s]+/) : []
  const nums = list.map(Number).filter(Number.isFinite).map((item) => Math.max(1, Math.floor(item)))
  return nums.length >= 3 ? [nums[0]!, nums[1]!, nums[2]!] : fallback
}

function normalizeGlobalWait(value: unknown): Array<[number, number]> {
  if (Array.isArray(value)) {
    const pairs = value.map((item) => normalizeNumberPair(item, [0, 0])).filter((item) => item[0] > 0 && item[1] > 0)
    if (pairs.length) return pairs
  }
  if (typeof value === "string") {
    const pairs = value.split(/[|;]/).map((item) => normalizeNumberPair(item, [0, 0])).filter((item) => item[0] > 0 && item[1] > 0)
    if (pairs.length) return pairs
  }
  return [[1000, 3600], [500, 2000]]
}

function toFlag(value: unknown, fallback: 0 | 1): 0 | 1 {
  if (value === 0 || value === "0" || value === false) return 0
  if (value === 1 || value === "1" || value === true) return 1
  return fallback
}

function pairIsPositive(value: number[]): boolean {
  return value.length >= 2 && value.every((item) => Number.isInteger(item) && item > 0)
}

function normalizeDateValue(value: string | number, now: Date): string {
  if (typeof value === "number") {
    const date = new Date(now.getTime() - value * 86400000)
    return date.toISOString().slice(0, 10)
  }
  return clean(value)
}

function normalizePublishTime(value: string, now: Date): string {
  const text = clean(value)
  if (!text) return ""
  if (text.includes("\u521a\u521a")) return formatMinute(now)
  const minute = /(\d+)\s*\u5206\u949f/.exec(text)
  if (minute) return formatMinute(new Date(now.getTime() - Number(minute[1]) * 60000))
  if (text.includes("\u4eca\u5929")) return `${now.toISOString().slice(0, 10)} ${firstMatch(text, /(\d{1,2}:\d{2})/)}`.trim()
  const monthDay = /(\d{1,2})\s*\u6708\s*(\d{1,2})\s*\u65e5\s*(\d{1,2}:\d{2})/.exec(text)
  if (monthDay) return `${now.getFullYear()}-${pad(monthDay[1]!)}-${pad(monthDay[2]!)} ${monthDay[3]}`
  const full = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}:\d{2}))?/.exec(text)
  if (full) return `${full[1]}-${pad(full[2]!)}-${pad(full[3]!)}${full[4] ? ` ${full[4]}` : ""}`
  return text.slice(0, 16)
}

function dateMs(value: string, now: Date): number {
  const normalized = normalizePublishTime(value, now)
  const ms = Date.parse(normalized.replace(" ", "T"))
  return Number.isFinite(ms) ? ms : 0
}

function dateCompact(value: string): string {
  const match = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(value)
  return match ? `${match[1]}${pad(match[2]!)}${pad(match[3]!)}` : value.replace(/\D/g, "").slice(0, 8)
}

function isDateLike(value: unknown): boolean {
  if (typeof value === "number") return Number.isInteger(value)
  if (typeof value !== "string") return false
  if (value === "now") return true
  return /^\d{4}-\d{1,2}-\d{1,2}(?:\s+\d{1,2}:\d{2})?$/.test(value)
}

function oneYearAgo(now: Date): string {
  const date = new Date(now)
  date.setFullYear(date.getFullYear() - 1)
  return date.toISOString().slice(0, 10)
}

function stringToInt(value: string): number {
  const text = clean(value)
  if (!text) return 0
  const number = Number.parseFloat(text.replace(/,/g, ""))
  if (!Number.isFinite(number)) return 0
  if (text.endsWith("\u4e07")) return Math.round(number * 10000)
  if (text.endsWith("\u4ebf")) return Math.round(number * 100000000)
  return Math.round(number)
}

function numberAfter(text: string, label: string): number {
  const index = text.indexOf(label)
  if (index < 0) return 0
  return stringToInt(firstMatch(text.slice(index), /\[?(\d+(?:\.\d+)?[\u4e07\u4ebf]?)\]?/u))
}

function stripHtml(html: string): string {
  return decodeHtml(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\u200b/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " }
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_, entity: string) => {
    const lower = entity.toLowerCase()
    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16))
    if (lower.startsWith("#")) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10))
    return named[lower] ?? `&${entity};`
  })
}

function firstMatch(value: string, regex: RegExp): string {
  return regex.exec(value)?.[1] ?? ""
}

function normalizePost(value: unknown): WeiboPost | null {
  const record = asRecord(value)
  const id = clean(String(record.id ?? ""))
  if (!id) return null
  return {
    id,
    user_id: clean(String(record.user_id ?? "")),
    content: clean(String(record.content ?? "")),
    article_url: clean(String(record.article_url ?? "")),
    original_pictures: normalizeStringArray(record.original_pictures),
    retweet_pictures: normalizeStringArray(record.retweet_pictures),
    original: Boolean(record.original),
    video_url: clean(String(record.video_url ?? "")),
    publish_place: clean(String(record.publish_place ?? "")),
    publish_time: clean(String(record.publish_time ?? "")),
    publish_tool: clean(String(record.publish_tool ?? "")),
    up_num: Number(record.up_num) || 0,
    retweet_num: Number(record.retweet_num) || 0,
    comment_num: Number(record.comment_num) || 0,
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map(clean).filter(Boolean)
  if (typeof value === "string") return value.split(",").map(clean).filter(Boolean)
  return []
}

function extensionFromUrl(url: string, fallback: string): string {
  try {
    const pathname = new URL(url).pathname
    const match = /(\.[a-z0-9]{2,5})$/i.exec(pathname)
    return match?.[1] ?? fallback
  } catch {
    return fallback
  }
}

function escapeCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, "\"\"")}"` : value
}

function sanitizePathSegment(value: string): string {
  return (clean(value) || "weibo").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 120)
}

function progressFor(index: number, total: number, start: number, end: number): number {
  return start + Math.round((index / Math.max(total, 1)) * (end - start))
}

function pad(value: string): string {
  return value.padStart(2, "0")
}

function formatMinute(date: Date): string {
  return `${date.getFullYear()}-${pad(String(date.getMonth() + 1))}-${pad(String(date.getDate()))} ${pad(String(date.getHours()))}:${pad(String(date.getMinutes()))}`
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function clean(value: unknown): string {
  return String(value ?? "").trim().replace(/^["']|["']$/g, "")
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    if (!value || seen.has(value)) return false
    seen.add(value)
    return true
  })
}

export const weiboSpiderCore = {
  buildPageUrl,
  buildProfileUrl,
  buildUserConfigList,
  defaultWeiboSpiderConfig,
  mergeConfig,
  normalizeConfig,
  normalizeWeiboSpiderInput,
  parseCookieInput,
  parseCookieString,
  parseProfileHtml,
  parseUserListText,
  parseWeiboPageHtml,
  runWeiboSpider,
  validateConfig,
  validateCookieFields,
  validateCookieOnline,
}
