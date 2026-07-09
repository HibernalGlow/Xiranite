import i18n, { type ResourceLanguage } from "i18next"
import { initReactI18next } from "react-i18next"

export type Language = "en" | "zh"

export const LANGUAGES: { key: Language; label: string; nativeLabel: string }[] = [
  { key: "en", label: "English", nativeLabel: "English" },
  { key: "zh", label: "Chinese (Simplified)", nativeLabel: "中文（简体）" },
]

const STORAGE_KEY = "i18n.lang"
const NS_KEYS = ["common", "topbar", "settings", "registry", "overlay", "view", "module"] as const

const localeLoaders: Record<Language, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import("./locales/en.json"),
  zh: () => import("./locales/zh.json"),
}

let initPromise: Promise<typeof i18n> | null = null

function detectInitialLanguage(): Language {
  if (typeof window === "undefined") return "en"

  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === "en" || stored === "zh") return stored

  const nav = window.navigator.language?.toLowerCase() ?? ""
  return nav.startsWith("zh") ? "zh" : "en"
}

async function loadLanguageResource(lang: Language): Promise<void> {
  if (i18n.hasResourceBundle(lang, "common")) return

  const locale = (await localeLoaders[lang]()).default
  for (const ns of NS_KEYS) {
    i18n.addResourceBundle(lang, ns, locale[ns] as ResourceLanguage, true, true)
  }
}

export function initI18n(initialLanguage = detectInitialLanguage()): Promise<typeof i18n> {
  if (initPromise) return initPromise

  initPromise = (async () => {
    i18n.use(initReactI18next)

    await i18n.init({
      lng: initialLanguage,
      fallbackLng: "en",
      defaultNS: "common",
      ns: NS_KEYS as unknown as string[],
      interpolation: {
        escapeValue: false,
      },
      returnNull: false,
    })

    await loadLanguageResource(initialLanguage)
    if (i18n.language !== initialLanguage) await i18n.changeLanguage(initialLanguage)

    i18n.on("languageChanged", (lng) => {
      if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, lng)
      if (typeof document !== "undefined") document.documentElement.lang = lng
    })
    if (typeof document !== "undefined") document.documentElement.lang = i18n.language

    if (initialLanguage !== "en") void loadLanguageResource("en")

    return i18n
  })()

  return initPromise
}

export async function changeLanguage(lang: Language) {
  await initI18n()
  await loadLanguageResource(lang)
  return i18n.changeLanguage(lang)
}

export function getCurrentLanguage(): Language {
  const cur = i18n.language
  return cur?.startsWith("zh") ? "zh" : "en"
}

export default i18n
