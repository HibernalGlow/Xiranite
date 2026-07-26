import { createStore } from "@xstate/store"

import type { ReaderDirectoryNavigationDto } from "../../../../adapters/reader-http-client"

export type FolderTabKind = "directory" | "search" | "efu"
export type FolderTabReplacementPolicy = "replaceable" | "protected"

export function folderTabReplacementPolicy(kind: FolderTabKind): FolderTabReplacementPolicy {
  return kind === "directory" ? "replaceable" : "protected"
}

const navigationPolicyStore = createStore({
  context: {},
  on: {
    browse: (
      context,
      event: {
        policy: FolderTabReplacementPolicy
        forceNewTab: boolean
        path: string
        openInNewTab(path: string): void
        replaceCurrent(path: string): void
      },
      enqueue,
    ) => {
      enqueue.effect(() => {
        if (event.forceNewTab || event.policy === "protected") event.openInNewTab(event.path)
        else event.replaceCurrent(event.path)
      })
      return context
    },
    activate: (
      context,
      event: {
        policy: FolderTabReplacementPolicy
        path: string
        activateCurrent(path: string): void
      },
      enqueue,
    ) => {
      if (event.policy === "protected") return
      enqueue.effect(() => event.activateCurrent(event.path))
      return context
    },
    navigate: (
      context,
      event: {
        policy: FolderTabReplacementPolicy
        navigation: ReaderDirectoryNavigationDto
        fallbackPath?: string
        openInNewTab(path: string): void
      },
      enqueue,
    ) => {
      if (event.policy !== "protected" || event.navigation.action === "refresh") return
      const nextPath = event.navigation.action === "path"
        ? event.navigation.path
        : event.navigation.action === "back" || event.navigation.action === "up"
          ? event.fallbackPath
          : undefined
      if (nextPath) enqueue.effect(() => event.openInNewTab(nextPath))
      return context
    },
  },
})

export function routeFolderTabBrowse(input: {
  policy: FolderTabReplacementPolicy
  forceNewTab: boolean
  path: string
  openInNewTab(path: string): void
  replaceCurrent(path: string): void
}): void {
  navigationPolicyStore.trigger.browse(input)
}

export function routeFolderTabActivation(input: {
  policy: FolderTabReplacementPolicy
  path: string
  activateCurrent(path: string): void
}): boolean {
  if (!navigationPolicyStore.can.activate(input)) return false
  navigationPolicyStore.trigger.activate(input)
  return true
}

export function routeFolderTabNavigation(input: {
  policy: FolderTabReplacementPolicy
  navigation: ReaderDirectoryNavigationDto
  fallbackPath?: string
  openInNewTab(path: string): void
}): boolean {
  if (!navigationPolicyStore.can.navigate(input)) return false
  navigationPolicyStore.trigger.navigate(input)
  return true
}

