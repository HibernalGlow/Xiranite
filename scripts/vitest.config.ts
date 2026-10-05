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
  test: {
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["**/*.bun.test.{ts,tsx}", "**/node_modules/**", "**/.wscan/**"],
    root: import.meta.dirname,
  },
}
