import { parse, type Edit, type SgNode } from "@ast-grep/napi"

import { toNapiLanguage, type MigrationLanguage } from "./languages.js"

export interface StructuralRewriteRule {
  id: string
  language: MigrationLanguage
  pattern: string
  replacement: string
}

export interface StructuralRewriteResult {
  code: string
  changes: Array<{ ruleId: string; matches: number }>
}

export function applyStructuralRewrites(
  source: string,
  rules: StructuralRewriteRule[],
): StructuralRewriteResult {
  let code = source
  const changes: StructuralRewriteResult["changes"] = []

  for (const rule of rules) {
    const root = parse(toNapiLanguage(rule.language), code).root()
    const matches = root.findAll({ rule: { pattern: rule.pattern } })
    if (!matches.length) continue
    const edits: Edit[] = matches.map((node) => node.replace(renderReplacement(node, rule.replacement)))
    code = root.commitEdits(edits)
    changes.push({ ruleId: rule.id, matches: matches.length })
  }
  return { code, changes }
}

function renderReplacement(node: SgNode, template: string): string {
  const variables = [...template.matchAll(/\$\$\$?([A-Z][A-Z0-9_]*)|\$([A-Z][A-Z0-9_]*)/g)]
  let result = template
  for (const match of variables) {
    const token = match[0]
    const name = match[1] ?? match[2]!
    const value = token.startsWith("$$$")
      ? multipleMatchText(node, name) ?? token
      : node.getMatch(name)?.text() ?? token
    result = result.replaceAll(token, value)
  }
  return result
}

function multipleMatchText(node: SgNode, name: string): string | null {
  const matches = node.getMultipleMatches(name)
  const first = matches.at(0)
  const last = matches.at(-1)
  if (!first || !last) return null
  const source = Buffer.from(node.getRoot().root().text(), "utf8")
  return source.subarray(first.range().start.index, last.range().end.index).toString("utf8")
}
