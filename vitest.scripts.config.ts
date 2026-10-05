import { defineConfig } from "vitest/config"

/**
 * `test:unit` collects `src/**` only, so a gate that lives in `scripts/` has no test home; the older
 * script-side gates are run by their own `bun test` entries because they import `bun:test`. New code must not
 * add a Bun-only API (ADR-0075), so this config lists the Vitest-written script gates explicitly instead of
 * widening `test:unit` onto tests written for a different runner.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/audit-typecheck-baseline.test.ts", "scripts/audit-ci-build-targets.test.ts"],
  },
})
