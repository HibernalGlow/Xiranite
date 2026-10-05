/**
 * Vitest's happy-dom environment hands `window` over without `localStorage`: the installed
 * happy-dom 20.10.6 `Window` does have it, but the globals Vitest 4.1.10 copies onto the test
 * `window` do not include it (measured — `src/i18n`'s `languageChanged` listener reads
 * `window.localStorage.setItem` and gets `undefined`, which fails *every* `src/**` test file during
 * setup, including the ones that never touch i18n).
 *
 * A real WebView always has Storage, so this is an environment gap rather than product behaviour:
 * the test environment supplies the one object the browser guarantees, and nothing else.
 */
function ensureLocalStorage(): void {
  if (typeof window === "undefined" || window.localStorage) return

  const entries = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return entries.size
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, String(value))
    },
    removeItem: (key: string) => {
      entries.delete(key)
    },
    clear: () => entries.clear(),
  }

  Object.defineProperty(window, "localStorage", { value: storage, configurable: true, writable: false })
}

ensureLocalStorage()

const i18nModule = await import("@/i18n")

await i18nModule.initI18n("zh")
await i18nModule.default.changeLanguage("zh")
