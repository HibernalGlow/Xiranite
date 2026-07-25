import {
  PlatformFileMutationProvider,
  type PlatformFileMutationProviderOptions,
} from "@xiranite/file-operations/platform"

export type PlatformReaderFileMutationProviderOptions = PlatformFileMutationProviderOptions

/** NeoView compatibility name for the shared CZ trash-rs platform adapter. */
export class PlatformReaderFileMutationProvider extends PlatformFileMutationProvider {}
