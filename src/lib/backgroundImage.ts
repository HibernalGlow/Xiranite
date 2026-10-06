/**
 * 背景图片 URL 处理工具。
 *
 * 该模块负责处理工作区背景图的 URL 规范化、持久化过滤与 CSS url() 转换。
 * 核心约束：base64 data URL 因体积过大不写入 localStorage，只保留 URL/path
 * 字符串；完整的 base64 数据由后端 SQLite kv_store 表持久化。
 */
import { localBackendFileUrl } from "@/backend/localBackendConfig"

/**
 * 规范化持久化的背景图 URL。
 *
 * - 非字符串 / 空字符串 / blob: URL 返回 undefined（不持久化）
 * - 其他 URL/path 字符串原样返回
 *
 * blob: URL 是浏览器内存中的临时对象，刷新页面后失效，不应持久化。
 */
export function normalizePersistedBackgroundImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed || isTransientBackgroundImageUrl(trimmed)) return undefined
  return trimmed
}

/** sanitize 版本：normalize 的非空包装，返回字符串（空串表示无背景图）。 */
export function sanitizePersistedBackgroundImageUrl(value: string): string {
  return normalizePersistedBackgroundImageUrl(value) ?? ""
}

/**
 * 把背景图 URL 转换为可直接写入 CSS url() 的形式。
 *
 * 本地文件路径（如 `C:\images\bg.jpg` 或 `/home/user/bg.jpg`）会通过
 * localBackendFileUrl 转为后端 file 协议 URL，让浏览器能加载本地文件。
 * 转换失败时回退为原值（可能是已经可用的 URL）。
 */
export function toBackgroundImageCssUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (isLocalFilePath(trimmed)) {
    try {
      return localBackendFileUrl(trimmed)
    } catch {
      return trimmed
    }
  }
  return trimmed
}

/** 判断是否为临时 URL（blob: 开头，刷新后失效，不应持久化）。 */
export function isTransientBackgroundImageUrl(value: string): boolean {
  return value.startsWith("blob:")
}

/**
 * 从 File 对象提取本地路径（Electron / Tauri 等环境在 file.path 上提供）。
 * 浏览器原生 File 对象没有 path 字段，返回 undefined。
 */
export function localPathFromFile(file: File): string | undefined {
  const maybePath = (file as File & { path?: unknown }).path
  return typeof maybePath === "string" && maybePath.trim() ? maybePath.trim() : undefined
}

/**
 * 判断字符串是否为本地文件路径（Windows 盘符 / UNC / Unix 绝对路径）。
 * 用于决定是否需要通过后端 file 协议转换。
 */
function isLocalFilePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("/")
}
