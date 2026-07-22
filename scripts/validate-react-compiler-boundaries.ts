#!/usr/bin/env bun
import { readdir, readFile } from "node:fs/promises"
import { join, relative, resolve } from "node:path"

interface Finding {
  file: string
  message: string
}

const root = resolve(process.cwd())
const findings: Finding[] = []

await validateViteConfig()
await validatePackageNodeRenderer()
await validateNodeEntrypoints()

if (findings.length) {
  for (const finding of findings) {
    console.error(`${relative(root, finding.file)}: ${finding.message}`)
  }
  console.error(`\nReact Compiler boundary audit failed: ${findings.length} finding(s).`)
  process.exit(1)
}

console.log("React Compiler boundary audit passed.")

async function validateViteConfig() {
  const file = join(root, "vite.config.ts")
  const source = await readFile(file, "utf8")
  if (!/reactCompilerModeForCommand\(command\)/.test(source)) {
    findings.push({ file, message: "React Compiler mode must be selected from the Vite build command." })
  }
  if (!/babel-plugin-react-compiler/.test(source)) {
    findings.push({ file, message: "React Compiler Babel plugin is missing." })
  }
}

async function validatePackageNodeRenderer() {
  const file = join(root, "src", "components", "modules", "ModuleRenderer.tsx")
  const source = await readFile(file, "utf8")
  validateDirective(file, source, "PackageNodeRenderer")
}

async function validateNodeEntrypoints() {
  const nodesRoot = join(root, "src", "nodes")
  const entries = await readdir(nodesRoot, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const file = join(nodesRoot, entry.name, "Component.tsx")
    const source = await readFile(file, "utf8").catch(() => null)
    if (source === null) continue
    validateDirective(file, source, "Component")
  }
}

function validateDirective(file: string, source: string, functionName: string) {
  const pattern = new RegExp(`function\\s+${functionName}(?:\\s*<[^>]*>)?\\s*\\([\\s\\S]*?\\)\\s*(?::[^\\{]+)?\\{\\s*(["'])use ([^"']+)\\1`)
  const match = source.match(pattern)
  if (!match) {
    findings.push({ file, message: `${functionName} must start with the "use no memo" directive.` })
    return
  }
  if (match[2] !== "no memo") {
    findings.push({ file, message: `${functionName} must use "use no memo", found "use ${match[2]}".` })
  }
}
