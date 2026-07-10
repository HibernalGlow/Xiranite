import { access, mkdir, readdir, writeFile } from "node:fs/promises"
import { join, relative, resolve } from "node:path"

type RegistryItem = {
  name?: string
  title?: string
  description?: string
  type?: string
  premium?: boolean
  files?: Array<{ path?: string }>
}

type RegistryDocument = {
  items?: RegistryItem[]
}

const cacheRoot = resolve("tmp/ui-registry-cache")

const registries = [
  {
    id: "magicui",
    website: "https://magicui.design/",
    url: "https://raw.githubusercontent.com/magicuidesign/magicui/main/apps/www/public/r/registry.json",
  },
  {
    id: "diceui",
    website: "https://diceui.com/",
    url: "https://diceui.com/r/new-york/registry.json",
  },
  {
    id: "cult-ui",
    website: "https://www.cult-ui.com/",
    url: "https://cult-ui.com/r/registry.json",
  },
  {
    id: "smoothui",
    website: "https://smoothui.dev/",
    url: "https://smoothui.dev/r/registry.json",
  },
  {
    id: "shadcn-io",
    website: "https://www.shadcn.io/",
    url: "https://www.shadcn.io/r/registry.json",
  },
] as const

const sourceRepositories = [
  {
    id: "aceternity-ui",
    website: "https://ui.aceternity.com/",
    repo: "https://github.com/manuarora700/ui.aceternity.git",
    roots: ["components", "app", "src"],
    note: "Public source reference; the site does not expose a shadcn registry index.",
  },
  {
    id: "react-bits",
    website: "https://www.reactbits.dev/",
    repo: "https://github.com/DavidHDev/react-bits.git",
    roots: ["src"],
    note: "Public source reference; components are organized by framework and styling variant.",
  },
  {
    id: "react-three-fiber",
    website: "https://r3f.docs.pmnd.rs/",
    repo: "https://github.com/pmndrs/react-three-fiber.git",
    roots: ["docs", "packages/fiber"],
    note: "Rendering framework reference, not a shadcn component registry.",
  },
  {
    id: "21st-magic-mcp",
    website: "https://21st.dev/ai",
    repo: "https://github.com/21st-dev/magic-mcp.git",
    roots: ["src"],
    note: "21st.dev discovery/client reference; component delivery is API-backed rather than a public registry.json index.",
  },
  {
    id: "registry-directory",
    website: "https://registry.directory/",
    repo: "https://github.com/rbadillap/registry.directory.git",
    roots: ["src", "app", "data"],
    note: "Local directory reference for discovering additional shadcn-compatible registries.",
  },
] as const

await mkdir(cacheRoot, { recursive: true })

const searchIndex: Array<Record<string, unknown>> = []

for (const registry of registries) {
  const response = await fetch(registry.url, {
    headers: { "user-agent": "Xiranite UI registry cache" },
  })
  if (!response.ok) {
    throw new Error(`${registry.id}: ${response.status} ${response.statusText}`)
  }

  const text = await response.text()
  const document = JSON.parse(text) as RegistryDocument
  const targetDir = join(cacheRoot, "registries", registry.id)
  await mkdir(targetDir, { recursive: true })
  await writeFile(join(targetDir, "registry.json"), text, "utf8")

  for (const item of document.items ?? []) {
    searchIndex.push({
      source: registry.id,
      sourceType: "shadcn-registry",
      website: registry.website,
      name: item.name,
      title: item.title,
      description: item.description,
      type: item.type,
      premium: item.premium ?? false,
      files: item.files?.map((file) => file.path).filter(Boolean) ?? [],
    })
  }

  console.log(`${registry.id}: ${document.items?.length ?? 0} registry items`)
}

for (const source of sourceRepositories) {
  const targetDir = join(cacheRoot, "sources", source.id)
  if (await exists(join(targetDir, ".git"))) {
    await run("git", ["-C", targetDir, "pull", "--ff-only"])
  } else if (await exists(targetDir)) {
    throw new Error(`${targetDir} exists but is not a git checkout; move it aside and rerun.`)
  } else {
    await mkdir(join(cacheRoot, "sources"), { recursive: true })
    await run("git", ["clone", "--depth", "1", "--single-branch", source.repo, targetDir])
  }

  const commit = (await run("git", ["-C", targetDir, "rev-parse", "HEAD"])).trim()
  const files = await collectReferenceFiles(targetDir, source.roots)
  for (const file of files) {
    searchIndex.push({
      source: source.id,
      sourceType: "source-reference",
      website: source.website,
      repo: source.repo,
      commit,
      note: source.note,
      path: file,
      name: file.split(/[\\/]/).at(-1),
    })
  }
  console.log(`${source.id}: ${files.length} indexed source files @ ${commit.slice(0, 8)}`)
}

searchIndex.sort((a, b) => {
  const left = `${a.source ?? ""}/${a.name ?? a.path ?? ""}`
  const right = `${b.source ?? ""}/${b.name ?? b.path ?? ""}`
  return left.localeCompare(right)
})

await writeFile(
  join(cacheRoot, "search-index.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), items: searchIndex }, null, 2)}\n`,
  "utf8",
)

const summary = [
  "# Local UI registry cache",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  ...registries.map((registry) => `- ${registry.id}: registries/${registry.id}/registry.json`),
  ...sourceRepositories.map((source) => `- ${source.id}: sources/${source.id} (${source.note})`),
  "",
  `Search index: search-index.json (${searchIndex.length} entries)`,
  "",
]
await writeFile(join(cacheRoot, "README.md"), summary.join("\n"), "utf8")

console.log(`UI registry cache ready: ${cacheRoot}`)
console.log(`Search entries: ${searchIndex.length}`)

async function collectReferenceFiles(repositoryRoot: string, candidateRoots: readonly string[]): Promise<string[]> {
  const roots: string[] = []
  for (const candidate of candidateRoots) {
    const path = join(repositoryRoot, candidate)
    if (await exists(path)) roots.push(path)
  }
  if (!roots.length) roots.push(repositoryRoot)

  const files: string[] = []
  for (const root of roots) await walk(root, repositoryRoot, files)
  return files
}

async function walk(directory: string, repositoryRoot: string, files: string[]): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", ".next", "dist", "build", "node_modules", "coverage", "public"].includes(entry.name)) continue
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) {
      await walk(absolute, repositoryRoot, files)
      continue
    }
    if (!/\.(?:css|js|jsx|json|md|mdx|ts|tsx)$/.test(entry.name)) continue
    if (/\.(?:lock|map)$/.test(entry.name)) continue
    files.push(relative(repositoryRoot, absolute).replaceAll("\\", "/"))
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function run(command: string, args: string[]): Promise<string> {
  const child = Bun.spawn([command, ...args], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${exitCode})\n${stderr || stdout}`)
  }
  if (stderr.trim()) console.error(stderr.trim())
  return stdout
}
