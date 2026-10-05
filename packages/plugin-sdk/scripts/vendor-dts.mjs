/**
 * Post-process the emitted declarations so `@xiranite/plugin-sdk` is installable **outside** this
 * repository (`docs/plugin-architecture.md` §12).
 *
 * Why this exists at all, measured rather than assumed (2026-10-05): tsc emits
 * `import type { … } from "@xiranite/contract"` into `dist/index.d.ts`, and `@xiranite/contract`
 * declares its own dependencies as `workspace:*`, which resolves only inside the root workspace. An
 * external consumer therefore fails outright — `file:` gives
 * `error: @xiranite/contract@workspace:* failed to resolve`, `link:` gives
 * `FileNotFound: failed linking dependency/workspace`.
 *
 * Why this instead of a mature bundler: the repository is on **TypeScript 7.0.2**, where
 * `require("typescript").sys` is `undefined`. `dts-bundle-generator` dies on exactly that
 * (`TypeError: Cannot read properties of undefined (reading 'getCurrentDirectory')`), and
 * `@microsoft/api-extractor` / `rollup-plugin-dts` sit behind the same classic-compiler-API wall.
 * So the step is small and explicit: *copy* the already-emitted declaration files of the packages
 * this ABI references into `dist/vendor/`, and rewrite every specifier to a relative path. Nothing is
 * re-typed by hand, which is the whole reason §12 refuses a hand-copied host shape.
 *
 * Two properties the gate in `src/abi.test.ts` depends on:
 * - it refuses to guess. Any specifier shape it does not understand (a subpath like
 *   `@xiranite/api/operationsClient`, a non-workspace package) throws instead of being left behind —
 *   a leftover bare specifier in a published ABI is precisely the bug this file exists to prevent;
 * - it records a sha256 per vendored file, so a stale vendor (contract changed, nobody re-ran this)
 *   is detectable against the live build output rather than by reading comments.
 */

import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = resolve(packageRoot, "../..")
const distDir = join(packageRoot, "dist")
const vendorDir = join(distDir, "vendor")
const sdkDeclarations = join(distDir, "index.d.ts")

/**
 * Workspace packages this step is allowed to vendor. Anything else in the closure must be an explicit
 * decision: a new workspace package gets added here on purpose, and a third-party package is not
 * vendored at all — it stays a bare specifier and must be declared as a real dependency, because a
 * published package resolves fine on the consumer's machine while `workspace:*` does not.
 */
const ALLOWED_PACKAGES = new Set(["contract", "shared"])

const specifiers = /from\s+"([^"]+)"/g

function hash(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16)
}

/** Bare specifiers that are not workspace packages, collected so the gate can require them declared. */
const externalPackages = new Set()

function packageNameOf(specifier) {
  if (!specifier.startsWith("@xiranite/")) {
    // Real npm packages (zod, today) stay as-is: they are resolvable outside this repository, which is
    // exactly the property `workspace:*` lacks. Record them so nothing hides behind the rewrite.
    externalPackages.add(specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0])
    return null
  }
  const segments = specifier.slice("@xiranite/".length).split("/")
  if (segments.length !== 1) {
    throw new Error(`subpath specifiers are not supported by this step: ${specifier}`)
  }
  const name = segments[0]
  if (!ALLOWED_PACKAGES.has(name)) {
    throw new Error(`package "${name}" is not in ALLOWED_PACKAGES; add it deliberately or drop the reference`)
  }
  return name
}

/** The emitted declaration file a package's root specifier points at. */
function declarationPathFor(packageName) {
  return resolve(repoRoot, "packages", packageName, "dist/index.d.ts")
}

/** `./versionRange.js` next to `index.d.ts` → that package's `dist/versionRange.d.ts`. */
function siblingDeclarationPath(fromFile, specifier) {
  if (!specifier.startsWith("./") || !specifier.endsWith(".js")) {
    throw new Error(`only sibling "./name.js" specifiers are handled, got ${specifier} in ${fromFile}`)
  }
  return resolve(dirname(fromFile), `${specifier.slice(2, -3)}.d.ts`)
}

function posixRelative(fromDir, toFile) {
  const rel = relative(fromDir, toFile).replace(/\\/g, "/")
  // NodeNext resolution wants ".js" in the specifier even though the file on disk is ".d.ts".
  return (rel.startsWith(".") ? rel : `./${rel}`).replace(/\.d\.ts$/, ".js")
}

const vendored = new Map()

/**
 * Copy one declaration file into `dist/vendor/<package>/`, then chase what it references.
 *
 * `visited` is keyed by absolute source path, so a diamond dependency copies once.
 */
function vendorFile(sourcePath, targetPath, visited) {
  if (visited.has(sourcePath)) return visited.get(sourcePath)
  visited.set(sourcePath, targetPath)
  mkdirSync(dirname(targetPath), { recursive: true })

  let text = readFileSync(sourcePath, "utf8")
  // Provenance hashes the SOURCE as it was read, before any specifier rewrite: the gate compares it
  // against the live build output of that package, so hashing the rewritten copy would compare two
  // different things and go red on every file that had an import to begin with.
  const sourceDigest = hash(text)
  const sourceBytes = text.length
  const rewrites = []
  for (const match of text.matchAll(specifiers)) {
    rewrites.push(match[1])
  }
  for (const specifier of rewrites) {
    let target
    if (specifier.startsWith(".")) {
      const siblingSource = siblingDeclarationPath(sourcePath, specifier)
      const siblingTarget = join(dirname(targetPath), siblingSource.split("/").pop())
      vendorFile(siblingSource, siblingTarget, visited)
      target = posixRelative(dirname(targetPath), siblingTarget)
    } else {
      const packageName = packageNameOf(specifier)
      if (packageName === null) continue
      const packageTarget = join(vendorDir, packageName, "index.d.ts")
      vendorFile(declarationPathFor(packageName), packageTarget, visited)
      target = posixRelative(dirname(targetPath), packageTarget)
    }
    text = text.replace(`from "${specifier}"`, `from "${target}"`)
  }

  writeFileSync(targetPath, text)
  vendored.set(targetPath, { bytes: sourceBytes, sha256: sourceDigest, source: relative(repoRoot, sourcePath) })
  return targetPath
}

rmSync(vendorDir, { recursive: true, force: true })

const visited = new Map()
const sdkSource = join(packageRoot, "src/index.ts")
const sdkText = readFileSync(sdkSource, "utf8")
const sdkSpecifiers = [...sdkText.matchAll(specifiers)].map((match) => match[1])
const externalSpecifiers = sdkSpecifiers.filter((specifier) => !specifier.startsWith("."))

let declarations = readFileSync(sdkDeclarations, "utf8")
for (const specifier of externalSpecifiers) {
  const packageName = packageNameOf(specifier)
  if (packageName === null) continue
  const target = join(vendorDir, packageName, "index.d.ts")
  vendorFile(declarationPathFor(packageName), target, visited)
  declarations = declarations.replace(`from "${specifier}"`, `from "${posixRelative(distDir, target)}"`)
}

const provenancePath = join(vendorDir, "PROVENANCE.json")
mkdirSync(vendorDir, { recursive: true })
writeFileSync(
  provenancePath,
  `${JSON.stringify(
    {
      note: "Generated by scripts/vendor-dts.mjs from the current build output of the referenced workspace packages. Do not edit by hand; the ABI gate compares these hashes against the live dist.",
      generatedFrom: externalSpecifiers,
      /// Third-party specifiers intentionally left bare; they must each appear in package.json deps.
      externalPackages: [...externalPackages].sort(),
      files: [...vendored.entries()].map(([targetPath, info]) => ({
        file: relative(distDir, targetPath),
        source: info.source,
        sha256_16: info.sha256,
        bytes: info.bytes,
      })),
    },
    null,
    2,
  )}\n`,
)

writeFileSync(sdkDeclarations, declarations)

// Scan the whole emitted artifact, vendor files included: one leftover `@xiranite/*` would reproduce
// the original failure, just one file deeper.
const emitted = [sdkDeclarations, ...[...vendored.keys()]]
const bareLeft = []
for (const file of emitted) {
  for (const match of readFileSync(file, "utf8").matchAll(specifiers)) {
    if (match[1].startsWith("@xiranite/")) bareLeft.push(`${relative(packageRoot, file)} → ${match[1]}`)
  }
}
console.log(
  `vendored ${vendored.size} declaration file(s) for [${externalSpecifiers.join(", ")}]; `
  + `third-party specifiers kept bare: [${[...externalPackages].sort().join(", ")}]; `
  + `workspace specifiers left: ${bareLeft.length}`,
)
if (bareLeft.length > 0) {
  throw new Error(`workspace specifiers survived the rewrite:\n${bareLeft.join("\n")}`)
}
