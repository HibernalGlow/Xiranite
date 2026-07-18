import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { parseSync } from "oxc-parser"
import type {
  ArrayExpression,
  Expression,
  Node,
  ObjectExpression,
  ParenthesizedExpression,
  Property,
  TSSatisfiesExpression,
  StringLiteral,
  TSAsExpression,
  VariableDeclaration,
} from "@oxc-project/types"

export interface NodeDefLiteral {
  id: string
  name: string
  version: string
  category: string
  description: string
  icon: string
  keywords?: string[]
}

/**
 * Read the `def` literal from a node package entry file.
 *
 * Supports the current entry shapes:
 *   export const def = { ... } satisfies NodeDef
 *   const entry = { def: { ... }, core }
 *
 * Uses oxc-parser instead of the TypeScript compiler API so the registry
 * scripts do not depend on `typescript` and remain compatible with tsgo/TS7.
 */
export async function readNodeDef(indexPath: string): Promise<NodeDefLiteral> {
  return readNodeDefFile(indexPath, new Set())
}

async function readNodeDefFile(indexPath: string, visited: Set<string>): Promise<NodeDefLiteral> {
  if (visited.has(indexPath)) throw new Error(`Circular NodeEntry def import from ${indexPath}.`)
  visited.add(indexPath)
  const sourceText = await readFile(indexPath, "utf8")
  const result = parseSync(indexPath, sourceText, {
    lang: "ts",
    sourceType: "module",
    astType: "ts",
    preserveParens: true,
  })

  const found = findDefLiteral(result.program)
  if (found) return found
  const imported = findLocalDefImport(result.program)
  if (imported) {
    const sourcePath = resolve(dirname(indexPath), imported.replace(/\.js$/, ".ts"))
    return readNodeDefFile(sourcePath, visited)
  }
  throw new Error(`Unable to find NodeEntry def literal in ${indexPath}.`)
}

function findLocalDefImport(root: Node): string | undefined {
  let found: string | undefined
  function visit(node: Node | undefined | null): void {
    if (!node || found) return
    if (node.type === "ImportDeclaration") {
      const declaration = node as unknown as {
        source?: { value?: unknown }
        specifiers?: Array<{ local?: { name?: string } }>
      }
      const source = declaration.source?.value
      if (
        typeof source === "string"
        && source.startsWith(".")
        && declaration.specifiers?.some((specifier) => specifier.local?.name === "def")
      ) found = source
    }
    walkChildren(node, visit)
  }
  visit(root)
  return found
}

function findDefLiteral(root: Node): NodeDefLiteral | undefined {
  let found: NodeDefLiteral | undefined

  function visit(node: Node | undefined | null): void {
    if (!node || found) return

    if (node.type === "VariableDeclaration") {
      for (const declarator of (node as VariableDeclaration).declarations) {
        if (declarator.id.type === "Identifier" && declarator.id.name === "def" && declarator.init) {
          const object = objectLiteralFromExpression(declarator.init)
          const parsed = object ? parseNodeDefLiteral(object) : undefined
          if (parsed) {
            found = parsed
            return
          }
        }
      }
    }

    if (node.type === "Property") {
      const property = node as Property
      if (propertyKey(property.key) === "def") {
        const object = objectLiteralFromExpression(property.value)
        const parsed = object ? parseNodeDefLiteral(object) : undefined
        if (parsed) {
          found = parsed
          return
        }
      }
    }

    walkChildren(node, visit)
  }

  visit(root)
  return found
}

function parseNodeDefLiteral(object: ObjectExpression): NodeDefLiteral | undefined {
  const strings = new Map<string, string>()
  let keywords: string[] | undefined

  for (const property of object.properties) {
    if (property.type !== "Property") continue
    const name = propertyKey(property.key)
    if (!name) continue

    const value = property.value
    if (isStringLiteral(value)) {
      strings.set(name, value.value)
    } else if (name === "keywords" && value.type === "ArrayExpression") {
      keywords = (value as ArrayExpression).elements
        .map((element) => (element && isStringLiteral(element) ? element.value : undefined))
        .filter((item): item is string => typeof item === "string")
    }
  }

  const required = ["id", "name", "version", "category", "description", "icon"] as const
  if (!required.every((key) => strings.has(key))) return undefined

  return {
    id: strings.get("id")!,
    name: strings.get("name")!,
    version: strings.get("version")!,
    category: strings.get("category")!,
    description: strings.get("description")!,
    icon: strings.get("icon")!,
    ...(keywords?.length ? { keywords } : {}),
  }
}

function objectLiteralFromExpression(expression: Expression): ObjectExpression | undefined {
  if (expression.type === "ObjectExpression") return expression
  if (expression.type === "TSSatisfiesExpression" || expression.type === "TSAsExpression") {
    return objectLiteralFromExpression((expression as TSSatisfiesExpression | TSAsExpression).expression)
  }
  if (expression.type === "ParenthesizedExpression") {
    return objectLiteralFromExpression((expression as ParenthesizedExpression).expression)
  }
  return undefined
}

function propertyKey(key: Node): string | undefined {
  if (key.type === "Identifier") return (key as { name: string }).name
  if (key.type === "Literal") return String((key as { value: unknown }).value)
  return undefined
}

function isStringLiteral(node: Node): node is StringLiteral {
  return node.type === "Literal" && typeof (node as { value: unknown }).value === "string"
}

function walkChildren(node: Node, visit: (child: Node) => void): void {
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && "type" in item) visit(item as Node)
      }
    } else if (value && typeof value === "object" && "type" in value) {
      visit(value as Node)
    }
  }
}
