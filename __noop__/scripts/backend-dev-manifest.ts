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

export async function writeBackendDevManifest(manifest: BackendDevManifest): Promise<void> {
  await Bun.$`mkdir -p ${dirname(BACKEND_DEV_MANIFEST_PATH)}`.quiet()
  await Bun.write(BACKEND_DEV_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
}

export async function removeBackendDevManifest(): Promise<void> {
  await Bun.file(BACKEND_DEV_MANIFEST_PATH).delete().catch(() => undefined)
}
