import { normalizeArchivePath } from "../../domain/archive/archive-path.js"
import type { ArchivePasswordInput } from "../../ports/ReaderBookLoader.js"

const MAX_PASSWORDS = 16
const MAX_PASSWORD_BYTES = 4096
const MAX_ENTRY_PATHS = 16

export class ArchiveCredentialStore implements AsyncDisposable {
  readonly #passwords = new Map<string, Uint8Array>()
  readonly #copies = new Set<Uint8Array>()
  #closed = false

  constructor(inputs: readonly ArchivePasswordInput[] = []) {
    if (inputs.length > MAX_PASSWORDS) throw new Error(`Archive password count exceeds ${MAX_PASSWORDS}.`)
    try {
      for (const input of inputs) {
        const entryPaths = normalizeEntryPaths(input.entryPaths)
        const key = credentialKey(entryPaths)
        if (this.#passwords.has(key)) throw new Error(`Duplicate archive password scope: ${displayScope(entryPaths)}`)
        const bytes = passwordBytes(input)
        if (bytes.byteLength === 0) throw new Error(`Archive password is empty: ${displayScope(entryPaths)}`)
        if (bytes.byteLength > MAX_PASSWORD_BYTES) {
          bytes.fill(0)
          throw new Error(`Archive password exceeds ${MAX_PASSWORD_BYTES} UTF-8 bytes: ${displayScope(entryPaths)}`)
        }
        this.#passwords.set(key, bytes)
      }
    } catch (error) {
      this.#clear()
      throw error
    }
  }

  copyRawPassword(entryPaths: readonly string[] = []): Uint8Array | undefined {
    this.#assertOpen()
    const copy = this.#passwords.get(credentialKey(normalizeEntryPaths(entryPaths)))?.slice()
    if (copy) this.#copies.add(copy)
    return copy
  }

  clearRawPassword(password: Uint8Array | undefined): void {
    if (!password) return
    password.fill(0)
    this.#copies.delete(password)
  }

  close(): Promise<void> {
    if (this.#closed) return Promise.resolve()
    this.#closed = true
    this.#clear()
    return Promise.resolve()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  #clear(): void {
    for (const password of this.#passwords.values()) password.fill(0)
    for (const copy of this.#copies) copy.fill(0)
    this.#passwords.clear()
    this.#copies.clear()
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Archive credential store is closed.")
  }
}

function normalizeEntryPaths(entryPaths: readonly string[] | undefined): string[] {
  if (!entryPaths) return []
  if (entryPaths.length > MAX_ENTRY_PATHS) throw new Error(`Archive password scope exceeds ${MAX_ENTRY_PATHS} nested paths.`)
  return entryPaths.map((path) => normalizeArchivePath(path))
}

function passwordBytes(input: ArchivePasswordInput): Uint8Array {
  const hasText = input.password !== undefined
  const hasRaw = input.rawPassword !== undefined
  if (hasText === hasRaw) throw new Error("Archive password input must contain exactly one of password or rawPassword.")
  return hasText ? new TextEncoder().encode(input.password) : input.rawPassword!.slice()
}

function credentialKey(entryPaths: readonly string[]): string {
  return entryPaths.join("\0")
}

function displayScope(entryPaths: readonly string[]): string {
  return entryPaths.length ? entryPaths.join(" -> ") : "<root>"
}
