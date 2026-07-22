export const VITE_EAGER_DEPENDENCIES = [
  "@wailsio/runtime",
  "p-map",
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-dev-runtime",
  "react/jsx-runtime",
  "use-sync-external-store",
  "use-sync-external-store/shim",
  "use-sync-external-store/shim/with-selector",
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
