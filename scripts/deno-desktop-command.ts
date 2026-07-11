import path from "node:path"

export const DENO_DESKTOP_VERSION = "2.9.2"

export function resolveDenoCommand(): string {
  const candidates = [
    process.env.DENO_BIN,
    "deno",
    "deno.exe",
    "D:\\scoop\\apps\\deno\\current\\deno.exe",
    path.join(process.env.USERPROFILE ?? "", "scoop", "apps", "deno", "current", "deno.exe"),
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    const result = trySpawn([candidate, "--version"])
    if (!result || result.exitCode !== 0) continue
    const version = /^deno\s+(\S+)/m.exec(result.stdout)?.[1]
    if (version !== DENO_DESKTOP_VERSION) {
      throw new Error(`Deno Desktop is pinned to ${DENO_DESKTOP_VERSION}, but ${candidate} reports ${version ?? "an unknown version"}. Set DENO_BIN to the pinned executable.`)
    }
    return candidate
  }

  throw new Error(`Deno ${DENO_DESKTOP_VERSION} was not found. Install the pinned version or set DENO_BIN to deno.exe.`)
}

export function desktopRuntimePermissionArgs(): string[] {
  return [
    "--allow-env",
    "--allow-net=127.0.0.1,localhost",
    "--allow-read",
    "--allow-run",
    "--allow-write",
  ]
}

function trySpawn(command: string[]): { exitCode: number; stdout: string } | undefined {
  try {
    const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" })
    return {
      exitCode: result.exitCode,
      stdout: result.stdout ? new TextDecoder().decode(result.stdout) : "",
    }
  } catch {
    return undefined
  }
}
