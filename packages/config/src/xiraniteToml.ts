import { parse as parseToml, stringify as stringifyToml } from "smol-toml"

export { parseToml, stringifyToml }

/**
 * Node settings are written as plain TOML. The `[nodes.neoview]` canonicalizer that used to live here
 * split the reader's nested config into one section per related group and unwrapped a legacy
 * `config = { ... }` envelope; the node it served is out of the product (ADR-0064), and a write format
 * with no reader is a contract nobody upholds, so the special case is gone rather than kept "just in
 * case". Reading still accepts whatever `smol-toml` parses, including orphan `[nodes.*]` sections.
 */
export function stringifyXiraniteConfig(root: Record<string, unknown>): string {
  return stringifyToml(root)
}
