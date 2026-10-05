// Vitest project for the repository's own `scripts/` suites.
//
// They need this file because the root config is the app's: `vite.config.ts` limits vitest to
// `src/[**]/ *.test.{ts,tsx}` (spaces only to keep this comment legal — a bare `**/` closes a block comment)
// and runs it under happy-dom, so `vitest run scripts/x.test.ts` answers "No test files found" and the scripts
// suites were reachable only through `bun test`, which ADR-0075 removes. With this file a scripts suite runs as
// `bunx vitest run --config scripts/vitest.config.ts scripts/<name>.test.ts`, in the plain Node environment the
// scripts actually use.
//
// Wiring the whole project into `bun run test:unit` or CI needs a line in the root `package.json`, which several
// lanes hold open at once; until then this config is what makes each migrated suite runnable.
export default {
  // The dev-tui suites are .tsx with `@jsxImportSource @opentui/react`; bun defaults to the automatic JSX
  // runtime and vite's esbuild does not, so without this the compiled JSX calls a bare `React`.
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    // react-reconciler@0.33.0 ships constants.js with no `exports` map, and Node's ESM loader will not
    // infer the extension that @opentui/react's bundled chunk imports; inlining is what lets the alias apply.
    alias: {
      "react-reconciler/constants": "react-reconciler/constants.js",
    },
  },
  test: {
    server: {
      deps: {
        inline: [/@opentui\/react/],
      },
    },
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["**/*.bun.test.{ts,tsx}", "**/node_modules/**", "**/.wscan/**"],
    root: import.meta.dirname,
  },
}
