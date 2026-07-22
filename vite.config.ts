/// <reference types="vitest" />
import path, { dirname, resolve } from "path"
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import tailwindcss from "@tailwindcss/vite"
import { Scanner } from "@tailwindcss/oxide"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"
import { collectLucideIconExports, rewriteLucideDeepImports } from "./scripts/lucide-deep-imports"
import { reactCompilerModeForCommand } from "./scripts/react-compiler-mode"
import { VITE_EAGER_DEPENDENCIES, VITE_EXCLUDED_DEPENDENCIES } from "./scripts/vite-dependency-policy"

const appSrc = path.resolve(__dirname, "./src")
const oceanSrc = path.resolve(__dirname, "./vendor/ocean-dataview/src")
const tailwindCandidateSnapshot = path.resolve(appSrc, "./styles/.tailwind-candidates.txt")
const lucideReactEntry = path.resolve(__dirname, "./node_modules/lucide-react/dist/esm/lucide-react.js")
const propTypesDevShim = path.resolve(__dirname, "./src/vendor/prop-types-dev.ts")

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

function developmentCjsShimPlugin() {
  return {
    name: "xiranite:development-cjs-shims",
    apply: "serve" as const,
    enforce: "pre" as const,
    resolveId(id: string) {
      return id === "prop-types" ? propTypesDevShim : null
    },
  }
}

function developmentDebugLogPlugin() {
  return {
    name: "xiranite:development-debug-log",
    apply: "serve" as const,
    configureServer(server: {
      config: { root: string }
      middlewares: { use: (path: string, handler: (request: NodeJS.ReadableStream & { method?: string }, response: { statusCode: number; setHeader: (k: string, v: string) => void; end: (body?: string) => void }) => void) => void }
    }) {
      const logPath = resolve(server.config.root, ".tmp/neoview-debug.log")
      mkdirSync(dirname(logPath), { recursive: true })
      appendFileSync(logPath, `\n---- session ${new Date().toISOString()} ----\n`, "utf8")
      console.info(`[xiranite-debug] writing browser timeline to ${logPath}`)

      server.middlewares.use("/__xiranite-debug-log", (request, response) => {
        if (request.method === "GET") {
          try {
            const body = existsSync(logPath) ? readFileSync(logPath, "utf8") : ""
            response.statusCode = 200
            response.setHeader("content-type", "text/plain; charset=utf-8")
            response.end(body)
          } catch (error) {
            response.statusCode = 500
            response.end(error instanceof Error ? error.message : String(error))
          }
          return
        }

        let body = ""
        request.setEncoding("utf8")
        request.on("data", (chunk) => {
          if (body.length < 32_768) body += String(chunk)
        })
        request.on("end", () => {
          try {
            const event = JSON.parse(body) as { sequence?: unknown; elapsedMs?: unknown; label?: unknown; detail?: unknown }
            const line = `[xiranite-debug #${String(event.sequence)} +${String(event.elapsedMs)}ms] ${String(event.label)}${event.detail === undefined ? "" : ` ${JSON.stringify(event.detail)}`}`
            console.log(line)
            appendFileSync(logPath, `${line}\n`, "utf8")
          } catch {
            console.warn("[xiranite-debug] invalid browser event")
          }
          response.statusCode = 204
          response.end()
        })
      })
    },
  }
}

function lucideDeepImportsPlugin() {
  let iconExports: Promise<ReturnType<typeof collectLucideIconExports>> | undefined
  return {
    name: "xiranite:lucide-deep-imports",
    enforce: "pre" as const,
    async transform(source: string, id: string) {
      if (!source.includes("lucide-react") || !/\.[cm]?[jt]sx?(?:\?|$)/.test(id)) return null
      iconExports ??= readFile(lucideReactEntry, "utf8").then(collectLucideIconExports)
      const code = rewriteLucideDeepImports(source, id, await iconExports)
      return code === null ? null : { code, map: null }
    },
  }
}

function reactCompilerBabelOptions(command: "build" | "serve") {
  const mode = reactCompilerModeForCommand(command)
  return mode === "off" ? undefined : { plugins: [["babel-plugin-react-compiler", { compilationMode: mode }]] }
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  cacheDir: process.env.XIRANITE_VITE_CACHE_DIR,
  esbuild: {
    jsx: "automatic",
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "development"),
  },
  plugins: [
    developmentCjsShimPlugin(),
    developmentDebugLogPlugin(),
    lucideDeepImportsPlugin(),
    tailwindCandidateSnapshotPlugin(),
    productionChunkReportPlugin(),
    react({ babel: reactCompilerBabelOptions(command) }),
    tailwindcss(),
  ],
  resolve: {
    alias: [
      { find: "void-elements", replacement: path.resolve(__dirname, "src/vendor/void-elements.ts") },
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
    // Background-transform the first open path after listen. This does not delay
    // server startup; it reduces first-tab cost once the document is openable.
    warmup: {
      clientFiles: [
        "./index.html",
        "./src/main.tsx",
      ],
    },
    watch: {
      // Vite watches the repository root. Exclude large non-runtime trees so
      // Chokidar does not contend with the first HTTP transform after listen.
      ignored: [
        "**/.cache/**",
        "**/.playwright-cli/**",
        "**/.tmp/**",
        "**/.turbo/**",
        "**/artifacts/**",
        "**/build/**",
        "**/examples/**",
        "**/migration/**",
        "**/native/target/**",
        "**/output/**",
        "**/ref/**",
        "**/tmp/**",
      ],
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
    // The generated node registry exposes many feature-only dynamic imports.
    // Keep discovery disabled and explicitly prebundle only the compatibility
    // dependencies below; a full cold crawl takes roughly a minute on Windows.
    noDiscovery: true,
    holdUntilCrawlEnd: false,
    // use-sync-external-store/shim 是 CommonJS（module.exports = require(...)),
    // 不预构建时浏览器 ESM `import { useSyncExternalStore }` 拿不到命名导出。
    // esbuild 预构建会把 CJS 转成 ESM 命名导出。zustand / @base-ui/react /
    // @tanstack/react-store 都通过 shim 入口引用。
    include: [...VITE_EAGER_DEPENDENCIES],
    // nuqs 必须排除预构建：nuqs 用 window.__NuqsAdapterContext 做全局单例检测，
    // 若 esbuild 把 `nuqs` 和 `nuqs/adapters/react` 各自打包成独立 chunk，
    // context-CayRnDCw.js 会被内联两次 → 两个 createContext 实例 →
    // "Multiple adapter contexts detected" (NUQS-303) + context provider 失效。
    // nuqs 是纯 ESM（type: module），浏览器原生 ESM 按 URL 去重模块，
    // exclude 后所有入口共享同一份 context 模块。
    exclude: [...VITE_EXCLUDED_DEPENDENCIES],
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
}))
