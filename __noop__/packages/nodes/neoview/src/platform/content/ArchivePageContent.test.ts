import { describe, expect, it, vi } from "vitest"

import { ArchiveCredentialStore } from "../../application/reader/ArchiveCredentialStore.js"
import { MemoryArchiveProvider } from "../../testing/MemoryArchiveProvider.js"
import { ArchivePageContent } from "./ArchivePageContent.js"

describe("ArchivePageContent credentials", () => {
  it("[neoview.archive.credential-lifecycle] clears temporary password bytes after stream completion", async () => {
    const provider = new MemoryArchiveProvider([{ path: "page.jpg", bytes: Uint8Array.of(1, 2, 3) }])
    const [entry] = await provider.list()
    const credentials = new ArchiveCredentialStore([{ password: "secret" }])
    const temporary = Uint8Array.of(9, 8, 7)
    vi.spyOn(credentials, "copyRawPassword").mockReturnValue(temporary)
    const content = new ArchivePageContent(provider, entry!.id, 3, "image/jpeg", credentials)
    const source = await content.load()
    expect(new Uint8Array(await new Response(await source.open()).arrayBuffer())).toEqual(Uint8Array.of(1, 2, 3))
    expect(temporary).toEqual(Uint8Array.of(0, 0, 0))
    await source.close()
    await credentials.close()
    await provider.close()
  })

  it("[neoview.archive.credential-lifecycle] clears outstanding response passwords when the session store closes", async () => {
    const provider = new MemoryArchiveProvider([{ path: "page.jpg", bytes: Uint8Array.of(1, 2, 3) }])
    const [entry] = await provider.list()
    const credentials = new ArchiveCredentialStore([{ password: "secret" }])
    const copyRawPassword = credentials.copyRawPassword.bind(credentials)
    let temporary: Uint8Array | undefined
    vi.spyOn(credentials, "copyRawPassword").mockImplementation((entryPaths) => {
      temporary = copyRawPassword(entryPaths)
      return temporary
    })
    const content = new ArchivePageContent(provider, entry!.id, 3, "image/jpeg", credentials)
    const source = await content.load()
    await source.open()
    await credentials.close()
    expect(temporary?.every((byte) => byte === 0)).toBe(true)
    await source.close()
    await provider.close()
  })
})
