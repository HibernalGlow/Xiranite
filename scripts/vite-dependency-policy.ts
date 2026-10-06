export const VITE_EAGER_DEPENDENCIES = [
  // @diceui/shared@0.12.0 publishes CommonJS in its `import` entry. Force
  // esbuild conversion so Dice UI packages can use named ESM imports.
  "@diceui/shared",
  "@wailsio/runtime",
  "p-map",
  // p-queue imports CommonJS eventemitter3. With noDiscovery enabled it must
  // be prebundled, otherwise the browser sees eventemitter3 without a default
  // ESM export and any lazy node chunk that awaits a queue fails to load.
  "p-queue",
  // react-querybuilder depends on CommonJS helpers such as fast-deep-equal.
  // noDiscovery leaves those helpers unconverted unless every browser entry
  // used by the shared rule editor is explicitly prebundled.
  "react-querybuilder",
  "@react-querybuilder/dnd",
  "@react-querybuilder/dnd/dnd-kit",
  "react-tag-input",
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-dev-runtime",
  "react/jsx-runtime",
  "scheduler",
  "scheduler/index.js",
  "@xmldom/xmldom",
  "blueimp-md5",
  "blueimp-md5/js/md5.js",
  "debug",
  "debug/src/browser.js",
  // remark's legacy HTML entity decoder imports CommonJS `extend`. With
  // discovery disabled, lazy Marku loading otherwise exposes its CommonJS
  // default export directly to the browser.
  "extend",
  "content-type",
  "ieee754",
  "dexie",
  // @tldraw/editor pins eventemitter3@4, CommonJS only, in its own node_modules; the top-level copy is v5 and
  // does publish an ESM entry, so the nested one has to be named through its parent to get converted.
  "@tldraw/editor > eventemitter3",
  "use-sync-external-store",
  "use-sync-external-store/shim",
  // Vite's `./shim` export condition resolves to `shim/index.js`; an importer that names that file
  // verbatim gets the raw CommonJS unless this exact specifier is mapped too, and a strict linker (WebKit,
  // the Tauri host's engine) then refuses the module for want of `useSyncExternalStore`. Measured on the
  // dev graph with Node's linker, which names the requested module: the flow view died here.
  "use-sync-external-store/shim/index.js",
  // tldraw publishes ESM but imports CommonJS helpers by name. Left unconverted, the browser receives a module
  // with no ESM exports, and WebKit — the engine the Tauri host runs — refuses the *whole* static graph with
  // "Importing binding name 'default' cannot be resolved by star export entries", which is what crashed the
  // flow view. Each entry below is an edge Node's linker named on the dev graph.
  "classnames",
  "lodash.isequal",
  "lodash.isequalwith",
  "lodash.throttle",
  "lodash.uniq",
  "lz-string",
  "rbush",
  "use-sync-external-store/shim/with-selector",
  "use-sync-external-store/shim/with-selector.js",
  // @lumino/coreutils is the only Lumino package that declares `browser`, and it names the UMD build
  // (`dist/index.js`); Vite's mainFields rank `browser` above `module`, so coreutils alone reaches the
  // browser as CommonJS and @lumino/signaling's `import { PromiseDelegate }` loses its named export.
  // Prebundling the entry converts the whole Lumino graph and keeps one coreutils instance.
  "@lumino/commands",
] as const

export const VITE_EXCLUDED_DEPENDENCIES = [
  "nuqs",
  "@shikijs/core",
  "@shikijs/engine-javascript",
  "@shikijs/langs/toml",
  "@shikijs/themes/github-light",
  "@shikijs/themes/github-dark",
] as const
