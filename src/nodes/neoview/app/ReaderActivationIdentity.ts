import type {
  ReaderActivationIdentityDto,
  ReaderActivationProvenanceDto,
  ReaderActivationTraversalFrameDto,
} from "../adapters/reader-http-client"

export function cloneReaderActivationIdentity(identity: ReaderActivationIdentityDto): ReaderActivationIdentityDto {
  return {
    ...identity,
    ...(identity.traversalFrames?.length
      ? { traversalFrames: identity.traversalFrames.map((frame) => ({ ...frame })) }
      : {}),
  }
}

export function parseReaderActivationIdentity(value: unknown): ReaderActivationIdentityDto | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const candidate = value as Partial<ReaderActivationIdentityDto>
  const readerSourcePath = nonEmptyString(candidate.readerSourcePath)
  const activatedEntryPath = nonEmptyString(candidate.activatedEntryPath)
  const traversalRootPath = nonEmptyString(candidate.traversalRootPath)
  if (!readerSourcePath || !activatedEntryPath || !traversalRootPath) return undefined
  if (candidate.selfTerminal !== undefined && typeof candidate.selfTerminal !== "boolean") return undefined

  const traversalFrames = parseTraversalFrames(candidate.traversalFrames)
  if (candidate.traversalFrames !== undefined && !traversalFrames) return undefined
  if (traversalFrames?.length) {
    if (!isSameReaderPath(traversalFrames[0]!.directoryPath, traversalRootPath)
      || !isSameReaderPath(traversalFrames.at(-1)!.currentEntryPath, activatedEntryPath)) return undefined
    for (let index = 1; index < traversalFrames.length; index += 1) {
      if (!isSameReaderPath(traversalFrames[index - 1]!.currentEntryPath, traversalFrames[index]!.directoryPath)) return undefined
    }
  }

  return {
    readerSourcePath,
    activatedEntryPath,
    traversalRootPath,
    ...(traversalFrames?.length ? { traversalFrames } : {}),
    ...(candidate.selfTerminal ? { selfTerminal: true } : {}),
  }
}

export function legacyReaderActivationIdentity(
  readerSourcePath: string,
  traversalRootPath?: string,
  activatedEntryPath?: string,
): ReaderActivationIdentityDto {
  const source = readerSourcePath.trim()
  const activated = activatedEntryPath?.trim() || source
  return {
    readerSourcePath: source,
    activatedEntryPath: activated,
    traversalRootPath: traversalRootPath?.trim() || activated,
  }
}

export function readerActivationProvenanceFromIdentity(
  identity: ReaderActivationIdentityDto,
): ReaderActivationProvenanceDto {
  return {
    browserOriginPath: identity.traversalRootPath,
    browserOriginEntryPath: identity.activatedEntryPath,
    ...(identity.selfTerminal ? { browserOriginSelfTerminal: true } : {}),
    ...(identity.traversalFrames?.length
      ? { browserOriginTraversalFrames: identity.traversalFrames.map((frame) => ({ ...frame })) }
      : {}),
  }
}

export function readerActivationIdentityMatchesProvenance(
  identity: ReaderActivationIdentityDto,
  provenance: ReaderActivationProvenanceDto,
): boolean {
  if (!isSameReaderPath(identity.traversalRootPath, provenance.browserOriginPath)
    || !isSameReaderPath(identity.activatedEntryPath, provenance.browserOriginEntryPath)) return false
  if (Boolean(identity.selfTerminal) !== Boolean(provenance.browserOriginSelfTerminal)) return false
  const frames = provenance.browserOriginTraversalFrames
  if (!frames) return true
  if (identity.traversalFrames?.length !== frames.length) return false
  return frames.every((frame, index) => {
    const candidate = identity.traversalFrames?.[index]
    return Boolean(candidate
      && isSameReaderPath(candidate.directoryPath, frame.directoryPath)
      && isSameReaderPath(candidate.currentEntryPath, frame.currentEntryPath)
      && Boolean(candidate.selfTerminal) === Boolean(frame.selfTerminal))
  })
}

export function relocateReaderActivationIdentity(
  identity: ReaderActivationIdentityDto,
  sourcePath: string,
  destinationPath: string,
): ReaderActivationIdentityDto {
  let changed = false
  const relocate = (path: string) => {
    if (!isSameReaderPath(path, sourcePath)) return path
    changed ||= path !== destinationPath
    return destinationPath
  }
  const relocated = {
    ...identity,
    readerSourcePath: relocate(identity.readerSourcePath),
    activatedEntryPath: relocate(identity.activatedEntryPath),
    traversalRootPath: relocate(identity.traversalRootPath),
    ...(identity.traversalFrames?.length
      ? { traversalFrames: identity.traversalFrames.map((frame) => ({
          ...frame,
          directoryPath: relocate(frame.directoryPath),
          currentEntryPath: relocate(frame.currentEntryPath),
        })) }
      : {}),
  }
  return changed ? relocated : identity
}

export function isSameReaderPath(left: string, right: string): boolean {
  const normalize = (value: string) => value.trim().replaceAll("\\", "/").replace(/\/+$/u, "")
  const normalizedLeft = normalize(left)
  const normalizedRight = normalize(right)
  return /^[a-z]:/iu.test(normalizedLeft) || /^[a-z]:/iu.test(normalizedRight)
    ? normalizedLeft.toLocaleLowerCase("en-US") === normalizedRight.toLocaleLowerCase("en-US")
    : normalizedLeft === normalizedRight
}

export type ReaderActivationIdentityCommittedCallback = (identity: ReaderActivationIdentityDto | undefined) => void

export interface ReaderAppActivationIdentityProps {
  initialActivationIdentity?: ReaderActivationIdentityDto
  /** Legacy Card state read compatibility. New writes use initialActivationIdentity. */
  initialBrowserOriginPath?: string
  onActivationIdentityCommitted?: ReaderActivationIdentityCommittedCallback
}

function parseTraversalFrames(value: unknown): readonly ReaderActivationTraversalFrameDto[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) return undefined
  const frames: ReaderActivationTraversalFrameDto[] = []
  for (const valueFrame of value) {
    if (!valueFrame || typeof valueFrame !== "object" || Array.isArray(valueFrame)) return undefined
    const frame = valueFrame as Partial<ReaderActivationTraversalFrameDto>
    const directoryPath = nonEmptyString(frame.directoryPath)
    const currentEntryPath = nonEmptyString(frame.currentEntryPath)
    if (!directoryPath || !currentEntryPath) return undefined
    if (frame.selfTerminal !== undefined && typeof frame.selfTerminal !== "boolean") return undefined
    frames.push({ directoryPath, currentEntryPath, ...(frame.selfTerminal ? { selfTerminal: true } : {}) })
  }
  return frames
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return value.trim() || undefined
}
