/// <reference types="vitest" />
import path from "path"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import tailwindcss from "@tailwindcss/vite"
import { Scanner } from "@tailwindcss/oxide"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

const appSrc = path.resolve(__dirname, "./src")
const oceanSrc = path.resolve(__dirname, "./vendor/ocean-dataview/src")
const tailwindCandidateSnapshot = path.resolve(appSrc, "./styles/.tailwind-candidates.txt")
const reactCompilerMode = process.env.XIRANITE_REACT_COMPILER_MODE ?? "infer"

if (reactCompilerMode !== "annotation" && reactCompilerMode !== "infer" && reactCompilerMode !== "off") {
  throw new Error("XIRANITE_REACT_COMPILER_MODE must be annotation, infer, or off")
}

/**
 * Tailwind v4 normally watches every source file and re-emits the generated
 * global stylesheet whenever a component's class candidates change.  That is
 * correct but visually disruptive in the desktop WebView.  Snapshot the
 * application candidates once per Vite process instead: component edits then
 * update their own module without replacing the global Tailwind stylesheet.
 *
 * A newly introduced utility needs one dev-server restart so it enters the
 * snapshot. Production builds generate a fresh snapshot before compiling.
 */
function tailwindCandidateSnapshotPlugin() {
  return {
    name: "xiranite:tailwind-candidate-snapshot",
    async configResolved() {
      const scanner = new Scanner({
        sources: [
          { base: appSrc, pattern: "**/*.{html,ts,tsx}", negated: false },
          { base: appSrc, pattern: "**/__backup__/**", negated: true },
          { base: __dirname, pattern: "index.html", negated: false },
        ],
      })
      const next = `${[...scanner.scan()].sort().join("\n")}\n`
      const current = await readFile(tailwindCandidateSnapshot, "utf8").catch(() => "")

      if (current === next) return
      await mkdir(path.dirname(tailwindCandidateSnapshot), { recursive: true })
      await writeFile(tailwindCandidateSnapshot, next, "utf8")
    },
  }
}

/** Opt-in module map for investigating production chunk regressions. */
function productionChunkReportPlugin() {
  return {
    name: "xiranite:production-chunk-report",
    apply: "build" as const,
    async generateBundle(_: unknown, bundle: Record<string, { type: string; fileName: string; code?: string; modules?: Record<string, unknown> }>) {
      if (process.env.XIRANITE_CHUNK_REPORT !== "1") return
      const chunks = Object.values(bundle)
        .filter((output) => output.type === "chunk")
        .map((output) => ({ fileName: output.fileName, bytes: output.code?.length ?? 0, modules: Object.keys(output.modules ?? {}) }))
        .sort((a, b) => b.bytes - a.bytes)
      await mkdir(path.resolve(__dirname, "artifacts"), { recursive: true })
      await writeFile(path.resolve(__dirname, "artifacts", "production-chunks.json"), `${JSON.stringify(chunks, null, 2)}\n`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  cacheDir: process.env.XIRANITE_VITE_CACHE_DIR,
  esbuild: {
    jsx: "automatic",
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "development"),
  },
  plugins: [
    tailwindCandidateSnapshotPlugin(),
    productionChunkReportPlugin(),
    react({
      babel: reactCompilerMode === "off"
        ? undefined
        : { plugins: [["babel-plugin-react-compiler", { compilationMode: reactCompilerMode }]] },
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: [
      // Keep the browser entry on the source-level UI boundary. The NeoView
      // package build replaces dist non-atomically, and a stale Vite optimized
      // dependency can otherwise retain the Node-only core module graph.
      { find: "@xiranite/node-neoview/ui-core", replacement: path.resolve(__dirname, "packages/nodes/neoview/src/ui-core.ts") },
      { find: "@hibernalglow/ocean-dataview/styles.css", replacement: path.resolve(oceanSrc, "styles.css") },
      { find: "@hibernalglow/ocean-dataview/validators", replacement: path.resolve(oceanSrc, "validators/index.ts") },
      { find: "@hibernalglow/ocean-dataview/parsers", replacement: path.resolve(oceanSrc, "parsers/index.ts") },
      { find: "@hibernalglow/ocean-dataview/providers", replacement: path.resolve(oceanSrc, "lib/providers/index.ts") },
      { find: "@hibernalglow/ocean-dataview/toolbars/notion", replacement: path.resolve(oceanSrc, "components/toolbars/notion/toolbar.tsx") },
      { find: "@hibernalglow/ocean-dataview/properties", replacement: path.resolve(oceanSrc, "components/ui/properties/index.ts") },
      { find: "@hibernalglow/ocean-dataview/hooks", replacement: path.resolve(oceanSrc, "hooks/index.ts") },
      { find: "@hibernalglow/ocean-dataview/types", replacement: path.resolve(oceanSrc, "types/index.ts") },
      { find: "@hibernalglow/ocean-dataview/utils", replacement: path.resolve(oceanSrc, "utils/index.ts") },
      { find: "@hibernalglow/ocean-dataview/dev", replacement: path.resolve(oceanSrc, "dev/main.tsx") },
      {
        find: /^@hibernalglow\/ocean-dataview\/views\/([^/]+)$/,
        replacement: path.resolve(oceanSrc, "components/views/$1/index.tsx"),
      },
      { find: /^@\//, replacement: `${appSrc}/` },
    ],
    // Force single instances of shared deps so the linked ocean-dataview-vite
    // package does not bring its own copy. Without dedupe, nuqs / react-query /
    // react-table end up with two separate module instances in the bundle,
    // which breaks React context (nuqs adapter, react-query client, etc.).
    dedupe: [
      "react",
      "react-dom",
      "nuqs",
      "@tanstack/react-query",
      "@tanstack/react-table",
      "@tanstack/table-core",
    ],
  },
  server: {
    watch: {
      ignored: ["**/.cache/**", "**/build/**", "**/artifacts/**", "**/native/target/**"],
    },
    // Keep HMR on the main HTTP server. Setting `hmr.port` to a different value
    // opens a websocket-only listener that answers document GETs with 426/404 and
    // steals free ports from the next managed XR session.
    hmr: process.env.VITE_XIRANITE_FRONTEND_DEV_URL
      ? {
          host: new URL(process.env.VITE_XIRANITE_FRONTEND_DEV_URL).hostname,
          clientPort: Number(new URL(process.env.VITE_XIRANITE_FRONTEND_DEV_URL).port) || 5173,
        }
      : undefined,
  },
  optimizeDeps: {
    // Standalone reference HTML under icon/ is not an application entry.
    entries: ["index.html"],
    // use-sync-external-store/shim 是 CommonJS（module.exports = require(...)),
    // 不预构建时浏览器 ESM `import { useSyncExternalStore }` 拿不到命名导出。
    // esbuild 预构建会把 CJS 转成 ESM 命名导出。zustand / @base-ui/react /
    // @tanstack/react-store 都通过 shim 入口引用。
    include: [
      "@wailsio/runtime",
      "use-sync-external-store",
      "use-sync-external-store/shim",
      "use-sync-external-store/shim/with-selector",
    ],
    // nuqs 必须排除预构建：nuqs 用 window.__NuqsAdapterContext 做全局单例检测，
    // 若 esbuild 把 `nuqs` 和 `nuqs/adapters/react` 各自打包成独立 chunk，
    // context-CayRnDCw.js 会被内联两次 → 两个 createContext 实例 →
    // "Multiple adapter contexts detected" (NUQS-303) + context provider 失效。
    // nuqs 是纯 ESM（type: module），浏览器原生 ESM 按 URL 去重模块，
    // exclude 后所有入口共享同一份 context 模块。
    exclude: [
      "nuqs",
      "@xiranite/node-neoview",
      "@shikijs/core",
      "@shikijs/engine-javascript",
      "@shikijs/langs/toml",
      "@shikijs/themes/github-light",
      "@shikijs/themes/github-dark",
    ],
    rolldownOptions: {
      transform: {
        define: {
          "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "development"),
        },
      },
    },
  },
  test: {
    environment: "happy-dom",
    setupFiles: [path.resolve(__dirname, "./src/test/setup-i18n.ts")],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["**/dist/**", "**/artifacts/**", "**/build/**", "**/vendor/**", "**/ref/**", "**/tests/e2e/**"],
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "vendor-react", test: /[\\/]node_modules[\\/](?:react|react-dom|scheduler)[\\/]/ },
            { name: "vendor-radix", test: /[\\/]node_modules[\\/](?:radix-ui|@radix-ui)[\\/]/ },
            { name: "vendor-query", test: /[\\/]node_modules[\\/]@tanstack[\\/]react-query[\\/]/ },
            { name: "vendor-i18n", test: /[\\/]node_modules[\\/](?:i18next|react-i18next)[\\/]/ },
            { name: "vendor-state", test: /[\\/]node_modules[\\/](?:zustand|nuqs)[\\/]/ },
            { name: "vendor-motion", test: /[\\/]node_modules[\\/]motion[\\/]/ },
            { name: "vendor-dockview", test: /[\\/]node_modules[\\/]dockview-react[\\/]/ },
            { name: "vendor-gridstack", test: /[\\/]node_modules[\\/]gridstack[\\/]/ },
          ],
        },
      },
    },
  },
})
