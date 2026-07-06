/**
 * i18n 配置 — react-i18next
 *
 * 设计要点：
 * 1. 资源直接打包进 bundle（避免运行时异步加载，桌面端启动更快）
 * 2. 不用 i18next-browser-languagedetector 包 — 直接读 localStorage + navigator.language
 *    足够桌面端使用，省一个依赖
 * 3. 持久化到 localStorage，切换语言立即生效，无需刷新
 * 4. 资源按 namespace 组织（common / topbar / settings / registry / view），
 *    组件用 useTranslation("namespace") 取键
 * 5. fallbackLng: "en" — 缺失键时回退英文
 *
 * 用法：
 *   import { useTranslation } from "react-i18next"
 *   const { t } = useTranslation("topbar")
 *   t("viewMode.cards")  // → "Cards" / "卡片"
 *
 *   import { changeLanguage, getCurrentLanguage, type Language } from "@/i18n"
 *   changeLanguage("zh")
 */
import i18n, { type Resource } from "i18next"
import { initReactI18next } from "react-i18next"
import en from "./locales/en.json"
import zh from "./locales/zh.json"

export type Language = "en" | "zh"

export const LANGUAGES: { key: Language; label: string; nativeLabel: string }[] = [
  { key: "en", label: "English",   nativeLabel: "English" },
  { key: "zh", label: "Chinese (Simplified)", nativeLabel: "中文（简体）" },
]

const STORAGE_KEY = "i18n.lang"

// 资源文件的顶层 key 即为 namespace（common / topbar / settings / registry / overlay / view / module）
// 这样组件可以用 t("common:close")、t("topbar:workspace.label") 跨 namespace 取键
const NS_KEYS = ["common", "topbar", "settings", "registry", "overlay", "view", "module"] as const

const resources = {
  en: {
    common: en.common,
    topbar: en.topbar,
    settings: en.settings,
    registry: en.registry,
    overlay: en.overlay,
    view: en.view,
    module: en.module,
  },
  zh: {
    common: zh.common,
    topbar: zh.topbar,
    settings: zh.settings,
    registry: zh.registry,
    overlay: zh.overlay,
    view: zh.view,
    module: zh.module,
  },
} as unknown as Resource

function detectInitialLanguage(): Language {
  // 1. localStorage 优先
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === "en" || stored === "zh") return stored

  // 2. navigator.language 回退
  const nav = navigator.language?.toLowerCase() ?? ""
  if (nav.startsWith("zh")) return "zh"
  return "en"
}

function init() {
  i18n.use(initReactI18next).init({
    resources,
    lng: detectInitialLanguage(),
    fallbackLng: "en",
    defaultNS: "common",
    ns: NS_KEYS as unknown as string[],
    interpolation: {
      // React 已 escape，关闭 i18next 自带 escape 避免双重转义
      escapeValue: false,
    },
    returnNull: false,
  })

  // 持久化语言选择
  i18n.on("languageChanged", (lng) => {
    localStorage.setItem(STORAGE_KEY, lng)
    // 同步 <html lang="..."> 让浏览器/辅助技术读到当前语言
    document.documentElement.lang = lng
  })

  // 初始化时也同步一次
  document.documentElement.lang = i18n.language
}

init()

/** 切换语言（持久化 + 立即生效，无需刷新） */
export function changeLanguage(lang: Language) {
  return i18n.changeLanguage(lang)
}

/** 获取当前语言 */
export function getCurrentLanguage(): Language {
  const cur = i18n.language
  return cur?.startsWith("zh") ? "zh" : "en"
}

export default i18n
