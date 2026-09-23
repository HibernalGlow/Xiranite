#!/usr/bin/env bun
/**
 * Wrap a built desktop host executable into a macOS .app bundle.
 *
 * A bare Mach-O binary is not a shippable macOS release: Finder cannot launch
 * it, `NSApplication` expects a bundle, and without a code signature the
 * extracted embedded Bun runtime is a worse Gatekeeper story, not a better one.
 * The bundle is ad-hoc signed because releases are not Developer ID signed.
 */
import { chmod, mkdir, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { basename, join, resolve } from "node:path"

interface Options {
  binary: string
  output: string
  version: string
  name: string
  identifier: string
}

const options = parseArgs(process.argv.slice(2))
const binaryPath = resolve(options.binary)
const bundlePath = resolve(options.output)

if (!existsSync(binaryPath)) {
  throw new Error(`Host executable not found: ${binaryPath}. Build it before packaging.`)
}

await rm(bundlePath, { recursive: true, force: true })
await mkdir(join(bundlePath, "Contents", "MacOS"), { recursive: true })
await Bun.write(join(bundlePath, "Contents", "MacOS", options.name), Bun.file(binaryPath))
await chmod(join(bundlePath, "Contents", "MacOS", options.name), 0o755)
await writeFile(join(bundlePath, "Contents", "Info.plist"), infoPlist(options), "utf8")
await writeFile(join(bundlePath, "Contents", "PkgInfo"), "APPL????", "utf8")
await sign(bundlePath)

console.log(`[macos-bundle] Created ${bundlePath} (version ${options.version}, ad-hoc signed)`)

// An ad-hoc signature needs no identity or timestamp authority, so it also works
// on a runner without Developer ID certificates.
async function sign(bundle: string): Promise<void> {
  const signProcess = Bun.spawn(["codesign", "--force", "--sign", "-", bundle], {
    stdout: "inherit",
    stderr: "inherit",
  })
  if ((await signProcess.exited) !== 0) {
    throw new Error(`codesign failed for ${bundle}`)
  }
  const verifyProcess = Bun.spawn(["codesign", "--verify", "--verbose=2", bundle], {
    stdout: "inherit",
    stderr: "inherit",
  })
  if ((await verifyProcess.exited) !== 0) {
    throw new Error(`codesign verification failed for ${bundle}`)
  }
}

function infoPlist(options: Options): string {
  // No CFBundleIconFile on purpose: adding one needs the real brand asset, and a
  // hand-drawn placeholder is worse than the generic application icon.
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleDevelopmentRegion</key>\n<string>en</string>
\t<key>CFBundleDisplayName</key>\n<string>${options.name}</string>
\t<key>CFBundleExecutable</key>\n<string>${options.name}</string>
\t<key>CFBundleIdentifier</key>\n<string>${options.identifier}</string>
\t<key>CFBundleInfoDictionaryVersion</key>\n<string>6.0</string>
\t<key>CFBundleName</key>\n<string>${options.name}</string>
\t<key>CFBundlePackageType</key>\n<string>APPL</string>
\t<key>CFBundleShortVersionString</key>\n<string>${options.version}</string>
\t<key>CFBundleVersion</key>\n<string>${options.version}</string>
\t<key>LSMinimumSystemVersion</key>\n<string>11.0</string>
\t<key>NSHighResolutionCapable</key>\n<true/>
\t<key>NSPrincipalClass</key>\n<string>NSApplication</string>
</dict>
</plist>
`
}

function parseArgs(args: string[]): Options {
  const parsed: Options = {
    binary: "",
    output: "build/macos/Xiranite.app",
    version: "0.0.0",
    name: "Xiranite",
    identifier: "com.hibernalglow.Xiranite",
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const value = args[index + 1]
    if (!arg?.startsWith("--") || !value) {
      throw new Error(`Unknown or incomplete argument: ${arg ?? ""}. Usage: --binary <exe> --output <app> --version <x.y.z> [--name <name>] [--identifier <id>]`)
    }
    index += 1
    if (arg === "--binary") parsed.binary = value
    else if (arg === "--output") parsed.output = value
    else if (arg === "--version") parsed.version = value
    else if (arg === "--name") parsed.name = value
    else if (arg === "--identifier") parsed.identifier = value
    else throw new Error(`Unknown option: ${arg}`)
  }
  if (!parsed.binary) {
    throw new Error("--binary is required.")
  }
  if (basename(parsed.output) !== `${parsed.name}.app`) {
    throw new Error(`--output must end with ${parsed.name}.app so CFBundleExecutable matches, got ${parsed.output}.`)
  }
  return parsed
}
