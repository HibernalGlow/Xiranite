import { join, parse, relative, resolve } from "node:path"

const ROOT_SYSTEM_DIRECTORY_NAMES = ["$Recycle.Bin", "System Volume Information", "Recovery"] as const

export interface ReaderSystemPathEnvironment {
  platform?: NodeJS.Platform
  systemRoot?: string
  programFiles?: string
  programFilesX86?: string
  programData?: string
}

export function isDefaultReaderSystemPath(path: string, environment: ReaderSystemPathEnvironment = {}): boolean {
  const candidate = resolve(path)
  return defaultReaderSystemExcludedPaths(parse(candidate).root, environment)
    .some((excludedPath) => isSameOrDescendant(pathKey(candidate), pathKey(excludedPath)))
}

export function defaultReaderSystemExcludedPaths(
  rootPath: string,
  environment: ReaderSystemPathEnvironment = {},
): string[] {
  if ((environment.platform ?? process.platform) !== "win32") return []

  const root = resolve(rootPath)
  const volumeRoot = parse(root).root
  const candidates = [
    ...ROOT_SYSTEM_DIRECTORY_NAMES.map((name) => join(volumeRoot, name)),
    environment.systemRoot ?? process.env.SystemRoot ?? process.env.WINDIR,
    environment.programFiles ?? process.env.ProgramFiles,
    environment.programFilesX86 ?? process.env["ProgramFiles(x86)"],
    environment.programData ?? process.env.ProgramData,
  ].flatMap((path) => typeof path === "string" && path.trim() ? [resolve(path)] : [])

  const output = new Map<string, string>()
  for (const candidate of candidates) {
    const child = relative(root, candidate)
    if (child && (child === ".." || child.startsWith(`..${pathSeparator(child)}`)) || isAbsoluteChild(child)) continue
    output.set(pathKey(candidate), candidate)
  }
  return [...output.values()]
}

function isAbsoluteChild(path: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(path) || path.startsWith("\\\\")
}

function pathKey(path: string): string {
  return resolve(path).replaceAll("\\", "/").replace(/\/+$/u, "").toLocaleLowerCase()
}

function isSameOrDescendant(candidate: string, ancestor: string): boolean {
  return candidate === ancestor || candidate.startsWith(`${ancestor}/`)
}

function pathSeparator(path: string): string {
  return path.includes("\\") ? "\\" : "/"
}
