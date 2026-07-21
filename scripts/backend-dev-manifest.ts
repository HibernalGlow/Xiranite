import { dirname, join } from "node:path"

export interface BackendDevManifest {
  baseUrl: string
  token?: string
}

export const BACKEND_DEV_MANIFEST_PATH = join(
  import.meta.dir,
  "..",
  "public",
  ".well-known",
  "xiranite",
  "backend.json",
)

export function backendDevManifestPath(frontendUrl?: string): string {
  if (!frontendUrl) return BACKEND_DEV_MANIFEST_PATH
  const frontend = new URL(frontendUrl)
  const port = frontend.port || (frontend.protocol === "https:" ? "443" : "80")
  return join(dirname(BACKEND_DEV_MANIFEST_PATH), `backend-${port}.json`)
}

export async function writeBackendDevManifest(manifest: BackendDevManifest, frontendUrl?: string): Promise<void> {
  const path = backendDevManifestPath(frontendUrl)
  await Bun.$`mkdir -p ${dirname(path)}`.quiet()
  await Bun.write(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

export async function removeBackendDevManifest(frontendUrl?: string): Promise<void> {
  await Bun.file(backendDevManifestPath(frontendUrl)).delete().catch(() => undefined)
}
