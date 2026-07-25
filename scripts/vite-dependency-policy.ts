export const VITE_EAGER_DEPENDENCIES = [
  // @diceui/shared@0.12.0 publishes CommonJS in its `import` entry. Force
  // esbuild conversion so Dice UI packages can use named ESM imports.
  "@diceui/shared",
  "@wailsio/runtime",
  "p-map",
  // p-queue imports CommonJS eventemitter3. With noDiscovery enabled it must
  // be prebundled, otherwise the browser sees eventemitter3 without a default
  // ESM export and NeoView's lazy module fails to load.
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
  "content-type",
  "ieee754",
  "dexie",
  "use-sync-external-store",
  "use-sync-external-store/shim",
  "use-sync-external-store/shim/with-selector",
  "use-sync-external-store/shim/with-selector.js",
] as const

export const VITE_EXCLUDED_DEPENDENCIES = [
  "nuqs",
  "@xiranite/node-neoview",
  "@shikijs/core",
  "@shikijs/engine-javascript",
  "@shikijs/langs/toml",
  "@shikijs/themes/github-light",
  "@shikijs/themes/github-dark",
] as const
