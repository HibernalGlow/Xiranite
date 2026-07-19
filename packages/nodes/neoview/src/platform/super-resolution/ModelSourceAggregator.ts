import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { copyFile, lstat, mkdir, readdir, stat, symlink } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import type {
  SuperResolutionCustomModelManifest,
  SuperResolutionModelManifest,
  SuperResolutionModelType,
} from "../../ports/SuperResolutionProvider.js"

export interface AggregatedModelMetadata {
  modelType: SuperResolutionModelType
  family: string
  category: string
  sizeBytes: number
  installed: boolean
  sourceDirectories: readonly string[]
  noise?: readonly number[]
  noiseByScale?: Readonly<Record<number, readonly number[]>>
}

export interface ModelSourceAggregation {
  customModels: readonly SuperResolutionCustomModelManifest[]
  metadata: ReadonlyMap<string, AggregatedModelMetadata>
}

interface ModelAlias {
  source: string
  target: string
}

interface ModelSourceSpec {
  id: string
  family: string
  category: string
  scales: readonly number[]
  noise?: readonly number[]
  noiseByScale?: Readonly<Record<number, readonly number[]>>
  folder: string
  aliases: readonly ModelAlias[]
  custom?: {
    displayName: string
    engine: "upscayl" | "realcugan"
    scaleFiles?: Readonly<Record<number, string>>
  }
}

interface SourceCatalog {
  sourceDirectory: string
  files: ReadonlyMap<string, { path: string; bytes: number }>
}

const MODEL_SPECS: readonly ModelSourceSpec[] = [
  {
    id: "realesr-animevideov3",
    family: "RealESRGAN",
    category: "anime",
    scales: [2, 3, 4],
    folder: "models",
    aliases: [2, 3, 4].flatMap((scale) => (["bin", "param"].map((extension) => ({
      source: `REALESRGAN_ANIMAVIDEOV3_UP${scale}X.${extension}`,
      target: `realesr-animevideov3-x${scale}.${extension}`,
    })))),
  },
  {
    id: "realesrgan-x4plus-anime",
    family: "RealESRGAN",
    category: "anime",
    scales: [2, 3, 4],
    folder: "models",
    aliases: ["bin", "param"].map((extension) => ({
      source: `REALESRGAN_X4PLUSANIME_UP4X.${extension}`,
      target: `realesrgan-x4plus-anime.${extension}`,
    })),
  },
  {
    id: "realesrgan-x4plus",
    family: "RealESRGAN",
    category: "general",
    scales: [2, 3, 4],
    folder: "models",
    aliases: ["bin", "param"].map((extension) => ({
      source: `REALESRGAN_X4PLUS_UP4X.${extension}`,
      target: `realesrgan-x4plus.${extension}`,
    })),
  },
  realcuganSpec("realcugan", "SE", "realcugan/models-se", [2, 3, 4], {
    2: [-1, 0, 1, 2, 3],
    3: [-1, 0, 3],
    4: [-1, 0, 3],
  }),
  {
    id: "external-realsr-df2k-x4",
    family: "RealSR",
    category: "photo",
    scales: [4],
    folder: "aggregated/realsr-df2k",
    aliases: ["bin", "param"].map((extension) => ({
      source: `REALSR_DF2K_UP4X.${extension}`,
      target: `realsr-df2k-x4.${extension}`,
    })),
    custom: {
      displayName: "RealSR DF2K x4",
      engine: "upscayl",
      scaleFiles: { 4: "realsr-df2k-x4" },
    },
  },
  realcuganSpec("external-realcugan-pro", "PRO", "aggregated/realcugan-pro", [2, 3], {
    2: [-1, 0, 3],
    3: [-1, 0, 3],
  }, {
    displayName: "RealCUGAN Pro",
    engine: "realcugan",
  }),
]

export async function aggregateModelSources(
  modelsDirectory: string,
  sourceDirectories: readonly string[],
): Promise<ModelSourceAggregation> {
  const catalogs = await Promise.all(sourceDirectories.map(loadSourceCatalog))
  const customModels: SuperResolutionCustomModelManifest[] = []
  const metadata = new Map<string, AggregatedModelMetadata>()
  const checksums = new Map<string, string>()

  for (const spec of MODEL_SPECS) {
    const resolved = spec.aliases.map((alias) => {
      for (const catalog of catalogs) {
        const file = catalog.files.get(alias.source.toLocaleLowerCase("en-US"))
        if (file) return { alias, catalog, file }
      }
      return undefined
    })
    const available = resolved.filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
    if (!available.length) continue

    for (const entry of available) {
      await materializeAlias(entry.file.path, join(modelsDirectory, "upscale", spec.folder, entry.alias.target))
    }
    const installed = available.length === spec.aliases.length
    const sources = [...new Set(available.map((entry) => entry.catalog.sourceDirectory))]
    const sourceFiles = new Map(available.map((entry) => [entry.file.path, entry.file.bytes]))
    metadata.set(spec.id, {
      modelType: "upscale",
      family: spec.family,
      category: spec.category,
      sizeBytes: [...sourceFiles.values()].reduce((sum, bytes) => sum + bytes, 0),
      installed,
      sourceDirectories: sources,
      noise: spec.noise,
      noiseByScale: spec.noiseByScale,
    })

    if (spec.custom && installed) {
      const modelFiles = spec.aliases.map((alias) => alias.target)
      const modelChecksums = Object.fromEntries(await Promise.all(available.map(async (entry) => [
        entry.alias.target,
        await fileChecksum(entry.file.path, checksums),
      ])))
      customModels.push({
        id: spec.id,
        type: "upscale",
        displayName: spec.custom.displayName,
        engine: spec.custom.engine,
        scales: spec.scales,
        noise: spec.noise,
        modelDirectory: spec.folder,
        modelFiles,
        scaleFiles: spec.custom.scaleFiles,
        license: "External model source; see the source package for license terms",
        checksums: modelChecksums,
        inputBlob: "data",
        outputBlob: "output",
      })
    }
  }

  return { customModels, metadata }
}

export async function enrichModelManifests(
  models: readonly SuperResolutionModelManifest[],
  modelsDirectory: string,
  aggregated: ReadonlyMap<string, AggregatedModelMetadata>,
): Promise<readonly SuperResolutionModelManifest[]> {
  return await Promise.all(models.map(async (model) => {
    const discovered = aggregated.get(model.id)
    const installation = await inspectInstallation(model, modelsDirectory)
    return {
      ...model,
      modelType: discovered?.modelType ?? model.modelType ?? "upscale",
      family: discovered?.family ?? model.family ?? modelFamily(model),
      category: discovered?.category ?? model.category ?? modelCategory(model),
      sizeBytes: discovered?.sizeBytes ?? installation.sizeBytes,
      installed: discovered?.installed ?? installation.installed,
      sourceDirectories: discovered?.sourceDirectories
        ?? model.sourceDirectories
        ?? (installation.installed ? [modelsDirectory] : []),
      noise: discovered?.noise ?? model.noise,
      noiseByScale: discovered?.noiseByScale ?? model.noiseByScale,
    }
  }))
}

function realcuganSpec(
  id: string,
  variant: "SE" | "PRO",
  folder: string,
  scales: readonly number[],
  noiseByScale: Readonly<Record<number, readonly number[]>>,
  custom?: ModelSourceSpec["custom"],
): ModelSourceSpec {
  const aliases: ModelAlias[] = []
  for (const scale of scales) {
    for (const noise of noiseByScale[scale] ?? []) {
      const suffix = noise === -1 ? "_CONSERVATIVE" : noise === 0 ? "" : `_DENOISE${noise}X`
      const targetSuffix = noise === -1 ? "conservative" : noise === 0 ? "no-denoise" : `denoise${noise}x`
      for (const extension of ["bin", "param"]) {
        aliases.push({
          source: `REALCUGAN_${variant}_UP${scale}X${suffix}.${extension}`,
          target: `up${scale}x-${targetSuffix}.${extension}`,
        })
      }
    }
  }
  return {
    id,
    family: "RealCUGAN",
    category: variant === "PRO" ? "anime-pro" : "anime",
    scales,
    noise: [...new Set(Object.values(noiseByScale).flat())].sort((left, right) => left - right),
    noiseByScale,
    folder,
    aliases,
    custom,
  }
}

async function loadSourceCatalog(sourceDirectory: string): Promise<SourceCatalog> {
  const normalized = resolve(sourceDirectory)
  const nested = join(normalized, "models")
  const modelsDirectory = await isDirectory(nested) ? nested : normalized
  const entries = await readdir(modelsDirectory, { withFileTypes: true }).catch(() => [])
  const files = new Map<string, { path: string; bytes: number }>()
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const path = join(modelsDirectory, entry.name)
    const details = await stat(path)
    files.set(entry.name.toLocaleLowerCase("en-US"), { path, bytes: details.size })
  }
  return { sourceDirectory: normalized, files }
}

async function materializeAlias(source: string, target: string): Promise<void> {
  if (await pathExists(target)) return
  await mkdir(dirname(target), { recursive: true })
  try {
    await symlink(source, target, "file")
  } catch (error) {
    if (await pathExists(target)) return
    const code = error instanceof Error && "code" in error ? String(error.code) : ""
    if (!new Set(["EPERM", "EACCES", "EXDEV", "UNKNOWN"]).has(code)) throw error
    await copyFile(source, target)
  }
}

async function inspectInstallation(
  model: SuperResolutionModelManifest,
  modelsDirectory: string,
): Promise<{ installed: boolean; sizeBytes?: number }> {
  if (!model.modelDirectory || !model.modelFiles?.length) return { installed: false }
  let sizeBytes = 0
  for (const file of model.modelFiles) {
    const details = await stat(join(modelsDirectory, model.modelDirectory, file)).catch(() => undefined)
    if (!details?.isFile()) return { installed: false }
    sizeBytes += details.size
  }
  return { installed: true, sizeBytes }
}

function modelFamily(model: SuperResolutionModelManifest): string {
  if (/realcugan/iu.test(model.id)) return "RealCUGAN"
  if (/realesr|animevideo/iu.test(model.id)) return "RealESRGAN"
  if (/waifu2x/iu.test(model.id)) return "Waifu2x"
  if (/opencomic/iu.test(model.id)) return "OpenComic AI"
  return model.engine
}

function modelCategory(model: SuperResolutionModelManifest): string {
  if (model.modelType === "descreen") return "descreen"
  if (model.modelType === "artifact-removal") return "artifact-removal"
  if (/anime|cugan|waifu/iu.test(model.id)) return "anime"
  if (/photo|realsr/iu.test(model.id)) return "photo"
  return "general"
}

async function fileChecksum(path: string, cache: Map<string, string>): Promise<string> {
  const cached = cache.get(path)
  if (cached) return cached
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  const checksum = hash.digest("hex")
  cache.set(path, checksum)
  return checksum
}

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isDirectory() === true
}

async function pathExists(path: string): Promise<boolean> {
  return await lstat(path).then(() => true, () => false)
}
