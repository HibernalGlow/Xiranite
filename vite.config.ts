/// <reference types="vitest" />
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const appSrc = path.resolve(__dirname, "./src")
const oceanSrc = path.resolve(__dirname, "./vendor/ocean-dataview/src")

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
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
      ignored: ["**/build/**", "**/artifacts/**"],
    },
  },
  optimizeDeps: {
    // use-sync-external-store/shim 是 CommonJS（module.exports = require(...)),
    // 不预构建时浏览器 ESM `import { useSyncExternalStore }` 拿不到命名导出。
    // esbuild 预构建会把 CJS 转成 ESM 命名导出。zustand / @base-ui/react /
    // @tanstack/react-store 都通过 shim 入口引用。
    include: [
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
    exclude: ["nuqs"],
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/test/setup-i18n.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["**/dist/**", "**/artifacts/**", "**/build/**", "**/vendor/**", "**/ref/**", "**/tests/e2e/**"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "scheduler"],
          "vendor-radix": [
            "radix-ui",
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-popover",
            "@radix-ui/react-tooltip",
            "@radix-ui/react-tabs",
            "@radix-ui/react-checkbox",
            "@radix-ui/react-scroll-area",
            "@radix-ui/react-separator",
            "@radix-ui/react-slot",
            "@radix-ui/react-switch",
            "@radix-ui/react-alert-dialog",
            "@radix-ui/react-progress",
          ],
          "vendor-query": ["@tanstack/react-query"],
          "vendor-i18n": ["i18next", "react-i18next"],
          "vendor-state": ["zustand", "nuqs"],
          "vendor-motion": ["motion"],
          "vendor-dockview": ["dockview-react"],
          "vendor-gridstack": ["gridstack"],
        },
      },
    },
  },
})
