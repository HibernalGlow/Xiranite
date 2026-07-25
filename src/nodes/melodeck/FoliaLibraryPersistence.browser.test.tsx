import { afterEach, expect, test } from "vitest"

import {
  deleteFoliaStoredLibrary,
  loadFoliaStoredLibrary,
  saveFoliaStoredLibrary,
} from "@hibernalglow/folia-player"

const namespaces: string[] = []

afterEach(async () => {
  await Promise.all(namespaces.splice(0).map((namespace) => deleteFoliaStoredLibrary(namespace)))
})

test("distinguishes an uninitialized library from a deliberately empty library", async () => {
  const namespace = createNamespace()

  await expect(loadFoliaStoredLibrary(namespace)).resolves.toBeNull()
  await saveFoliaStoredLibrary(namespace, [])
  await expect(loadFoliaStoredLibrary(namespace)).resolves.toEqual([])
})

test("persists portable track records in the Folia player database", async () => {
  const namespace = createNamespace()
  await saveFoliaStoredLibrary(namespace, [
    { id: "one", path: "D:/Music/one.flac", title: "One", artist: "Artist", duration: 12 },
    { id: "", path: "D:/Music/bad.flac", title: "Bad" },
  ])

  await expect(loadFoliaStoredLibrary(namespace)).resolves.toEqual([
    { id: "one", path: "D:/Music/one.flac", title: "One", artist: "Artist", duration: 12 },
  ])
})

function createNamespace(): string {
  const namespace = `xiranite-melodeck-test-${crypto.randomUUID()}`
  namespaces.push(namespace)
  return namespace
}
