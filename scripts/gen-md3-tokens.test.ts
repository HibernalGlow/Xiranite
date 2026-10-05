import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import { expect, test } from "bun:test"

import {
  MD3_COMPONENT_SET_NAMES,
  MD3_COMPONENT_TOKENS,
  MD3_SYS_TOKENS,
  MD3_TOKEN_SOURCE,
} from "../src/lib/design-theme/md3/tokens.generated.ts"
import {
  collectMd3Tokens,
  describeGeneratedDrift,
  parseScssTokenSections,
  parseScssValue,
  renderGeneratedFile,
  stripScssComments,
} from "./gen-md3-tokens.ts"

/**
 * The directory the checked-in file says it came from. Pinned on purpose: when @material/web bumps,
 * MD3_TOKEN_SOURCE.designVersion and this path are meant to fail together and get updated together.
 */
const TOKEN_DIR = join(import.meta.dirname, "..", "node_modules/@material/web/tokens/versions/v0_192")

/**
 * Everything below reads the *real* installed package, because the point of this generator is that nobody has to
 * trust a transcribed number. The expectations are the ones a Material 3 reviewer would recognise by eye: if the
 * parser mis-classified an `if()` guard, a tuple or a reference, one of them stops matching.
 */
test("the installed package answers with the provenance the file claims", () => {
  expect(MD3_TOKEN_SOURCE.package).toBe("@material/web")
  expect(MD3_TOKEN_SOURCE.designSystem).toBe("Google Material 3")
  expect(MD3_TOKEN_SOURCE.designVersion).toBe("v0.192")
  expect(MD3_TOKEN_SOURCE.license).toBe("Apache-2.0")
  // Read from node_modules, not written here: a bump of the package must show up as a version change, not a red test.
  expect(MD3_TOKEN_SOURCE.version).toMatch(/^\d+\.\d+\.\d+$/)
})

test("every documented system group is present, with color split by scheme", () => {
  for (const group of ["md-sys-shape", "md-sys-elevation", "md-sys-state", "md-sys-typescale", "md-sys-motion", "md-ref-typeface", "md-ref-palette"]) {
    expect(MD3_SYS_TOKENS[group], group).toBeDefined()
    expect(Object.keys(MD3_SYS_TOKENS[group] ?? {}), group).not.toHaveLength(0)
  }
  expect(MD3_SYS_TOKENS["md-sys-color"]).toBeUndefined()
  expect(Object.keys(MD3_SYS_TOKENS["md-sys-color.light"] ?? {})).not.toHaveLength(0)
  expect(Object.keys(MD3_SYS_TOKENS["md-sys-color.dark"] ?? {})).not.toHaveLength(0)
  // 8 modules -> 9 sections, because md-sys-color.scss is the one file with two schemes.
  expect(MD3_TOKEN_SOURCE.sysGroups).toBe(8)
  expect(Object.keys(MD3_SYS_TOKENS).length).toBe(9)
})

test("system literals are the numbers Material 3 publishes", () => {
  const shape = MD3_SYS_TOKENS["md-sys-shape"] as Record<string, string>
  const elevation = MD3_SYS_TOKENS["md-sys-elevation"] as Record<string, string>
  const state = MD3_SYS_TOKENS["md-sys-state"] as Record<string, string>
  const motion = MD3_SYS_TOKENS["md-sys-motion"] as Record<string, string>
  const typescale = MD3_SYS_TOKENS["md-sys-typescale"] as Record<string, string>
  const color = MD3_SYS_TOKENS["md-sys-color.light"] as Record<string, string>

  expect(shape["corner-medium"]).toBe("12px")
  expect(shape["corner-full"]).toBe("9999px")
  expect(shape["corner-extra-large"]).toBe("28px")
  expect(elevation["level3"]).toBe("6")
  expect(elevation["level0"]).toBe("0")
  expect(state["focus-state-layer-opacity"]).toBe("0.12")
  expect(motion["duration-short4"]).toBe("200ms")
  expect(motion["easing-emphasized"]).toBe("cubic-bezier(0.2, 0, 0, 1)")
  expect(typescale["body-large-size"]).toBe("1rem")
  expect(color["primary"]).toBe("ref:md-ref-palette:primary40")
})

test("tuples keep their order and compress only redundant zeros", () => {
  const shape = MD3_SYS_TOKENS["md-sys-shape"] as Record<string, string>
  expect(shape["corner-large-top"]).toBe("16px 16px 0 0")
  expect(shape["corner-large-end"]).toBe("0 16px 16px 0")
  // A lone 0px is what the source wrote; rewriting it to 0 would be the generator editing the design system.
  expect(shape["corner-none"]).toBe("0px")
})

test("the composite shorthand is keyed apart from its discrete siblings", () => {
  const typescale = MD3_SYS_TOKENS["md-sys-typescale"] as Record<string, string>
  expect(typescale["body-large-composite"]).toBe("ref:md-ref-typeface:weight-regular 1rem / 1.5rem ref:md-ref-typeface:plain")
  expect(typescale["body-large"]).toBeUndefined()
  expect(typescale["body-large-line-height"]).toBe("1.5rem")
  expect(typescale["body-large-weight"]).toBe("ref:md-ref-typeface:weight-regular")
  expect(typescale["body-large-tracking"]).toBe("0.03125rem")

  const button = MD3_COMPONENT_TOKENS["filled-button"] as Record<string, string>
  expect(button["label-text-type-composite"]).toBe(
    "ref:md-sys-typescale:label-large-weight ref:md-sys-typescale:label-large-size / ref:md-sys-typescale:label-large-line-height ref:md-sys-typescale:label-large-font",
  )
})

test("the motion path token records that the design system exports nothing for it", async () => {
  const data = await collectMd3Tokens()
  // `_md-sys-motion.scss` writes: 'path': /* Type "motion_path" is not supported. */ null
  expect(data.sys["md-sys-motion"]?.["path"]).toBe("null")
})

test("component tokens carry the shipped vocabulary, literal or reference", () => {
  const filledButton = MD3_COMPONENT_TOKENS["filled-button"] as Record<string, string>
  const switchSet = MD3_COMPONENT_TOKENS["switch"] as Record<string, string>
  const dialog = MD3_COMPONENT_TOKENS["dialog"] as Record<string, string>

  expect(filledButton["container-height"]).toBe("40px")
  expect(filledButton["container-shape"]).toBe("ref:md-sys-shape:corner-full")
  expect(filledButton["disabled-label-text-opacity"]).toBe("0.38")
  expect(filledButton["disabled-container-opacity"]).toBe("0.12")
  expect(filledButton["with-icon-icon-size"]).toBe("18px")
  expect(switchSet["track-width"]).toBe("52px")
  expect(dialog["container-shape"]).toBe("ref:md-sys-shape:corner-extra-large")
})

/**
 * The rule the whole generator exists to protect: a component color is a *reference* to the scheme, never a hex,
 * because the scheme is computed from the user's seed colour at runtime. Checked over every set, not a sample.
 */
test("no component color token was flattened to a literal colour", () => {
  const offenders: string[] = []
  const checked: string[] = []
  for (const [setName, tokens] of Object.entries(MD3_COMPONENT_TOKENS)) {
    for (const [token, value] of Object.entries(tokens)) {
      if (!token.endsWith("-color")) continue
      checked.push(`${setName}.${token}`)
      if (!value.startsWith("ref:")) offenders.push(`${setName}.${token} = ${value}`)
    }
  }
  expect(checked.length).toBeGreaterThan(100)
  expect(offenders).toEqual([])
  // And the reverse direction: the fixed palette group is the only place hex literals live.
  expect(MD3_SYS_TOKENS["md-ref-palette"]?.["error40"]).toBe("#b3261e")
})

test("MD3_COMPONENT_SET_NAMES matches the sets actually on disk", async () => {
  // 84, measured 2026-10-06 with:
  //   ls node_modules/@material/web/tokens/versions/v0_192 | grep '^_md-comp-' | grep -v -- '-meta\.scss$' | wc -l
  // (the brief said 77; the installed @material/web 2.5.0 ships 84, so the file says 84.)
  expect(MD3_COMPONENT_SET_NAMES.length).toBe(84)
  expect(MD3_TOKEN_SOURCE.componentSets).toBe(84)

  const files = await readdir(TOKEN_DIR)
  const onDisk = files.filter((name) => name.startsWith("_md-comp-") && name.endsWith(".scss") && !name.endsWith("-meta.scss"))
    .map((name) => name.replace(/^_md-comp-/, "").replace(/\.scss$/, ""))
    .sort()
  expect(MD3_COMPONENT_SET_NAMES).toEqual(onDisk)
})

/**
 * A second, deliberately dumber count over the same source: the generator is a tokenizer, this is a line count, and
 * they agree only if the tokenizer neither invented entries nor dropped any. Counting the wiring lines
 * (`'md-sys-color': md-sys-color.values-light(),` inside `$_default`) is what makes the two methods comparable —
 * 3505 key lines minus 348 wiring lines is exactly the 3495 tokens the file publishes.
 */
test("a line count of the SCSS agrees with the tokenizer, so nothing was silently dropped", async () => {
  const names = (await readdir(TOKEN_DIR))
    .filter((name) => /^_md-(?:sys|ref|comp)-[a-z0-9-]+\.scss$/.test(name) && !name.endsWith("-meta.scss"))
    .sort()
  expect(names.length).toBe(MD3_TOKEN_SOURCE.sysGroups + MD3_TOKEN_SOURCE.componentSets)

  let keyLines = 0
  let wiringLines = 0
  for (const name of names) {
    const text = await readFile(join(TOKEN_DIR, name), "utf8")
    for (const line of text.split("\n")) {
      if (/^\s+'[a-z0-9-]+':/.test(line)) keyLines += 1
      if (/^\s+'md-[a-z-]+': md-[a-z-]+\.values/.test(line)) wiringLines += 1
    }
  }
  expect(keyLines - wiringLines).toBe(MD3_TOKEN_SOURCE.sysTokenCount + MD3_TOKEN_SOURCE.componentTokenCount)
  expect(wiringLines).toBe(348)
})

test("counts in the header equal the objects, and nothing is silently skipped", async () => {
  const data = await collectMd3Tokens()
  const sysTotal = Object.values(data.sys).reduce((sum, tokens) => sum + Object.keys(tokens).length, 0)
  const componentTotal = Object.values(data.component).reduce((sum, tokens) => sum + Object.keys(tokens).length, 0)
  expect(MD3_TOKEN_SOURCE.sysTokenCount).toBe(sysTotal)
  expect(MD3_TOKEN_SOURCE.componentTokenCount).toBe(componentTotal)
  // 3160 + 335 is the whole vocabulary: if a token file or an entry stopped parsing, these would drop, not warn.
  expect(componentTotal).toBe(3_160)
  expect(sysTotal).toBe(335)
})

test("the checked-in module is exactly what the generator produces", async () => {
  // The spot checks above read the module, the checks below read the generator: without this pair, a change to the
  // generator (say, dropping the `-composite` rename) would keep every module assertion green on the old file.
  const data = await collectMd3Tokens()
  expect(data.sys).toEqual(MD3_SYS_TOKENS)
  expect(data.component).toEqual(MD3_COMPONENT_TOKENS)
  expect(data.componentSetNames).toEqual([...MD3_COMPONENT_SET_NAMES])
  expect(data.source).toEqual(MD3_TOKEN_SOURCE)

  const checkedIn = await readFile(join(import.meta.dirname, "..", "src/lib/design-theme/md3/tokens.generated.ts"), "utf8")
  expect(renderGeneratedFile(data)).toBe(checkedIn)
})

test("the generated file is byte-reproducible and free of machine specifics", async () => {
  const data = await collectMd3Tokens()
  const rendered = renderGeneratedFile(data)
  expect(rendered).toBe(renderGeneratedFile(await collectMd3Tokens()))
  expect(rendered).not.toMatch(/[A-Za-z]:[\\/]/)
  expect(rendered).not.toContain("/Users/")
  expect(rendered).not.toMatch(/(?:20\d\d-\d\d-\d\d|Date\.now|new Date)/)
  expect(rendered).toContain("DO NOT EDIT — run bun run gen:md3-tokens")
  expect(rendered.split("\n").length).toBeLessThanOrEqual(1_000)
})

// ---------------------------------------------------------------------------------------------
// Falsification controls: the parser must be able to fail, and so must the gate.
// ---------------------------------------------------------------------------------------------

const FIXTURE = `
// Design system display name: Fixture
// Design system version: v9.999
$_default: (
  'md-sys-shape': md-sys-shape.values(),
);

@function values($deps: $_default, $exclude-hardcoded-values: false) {
  @return (
    // a line comment that must not become a token
    'multi-line-ref':
      map.get(
        $deps,
        'md-sys-shape',
        'corner-full'
      ),
    'tuple': if($exclude-hardcoded-values, null, (16px 16px 0px 0px)),
    'plain': if($exclude-hardcoded-values, null, 40px),
    'opacity': if($exclude-hardcoded-values, null, 0.12),
    'easing': if($exclude-hardcoded-values, null, cubic-bezier(0.2, 0, 0, 1)),
    'title-large':
      if(
        $exclude-hardcoded-values,
        null,
        /** Warning: risk of reduced fidelity from using this composite typography token. */
          map.get($deps, 'md-ref-typeface', 'weight-regular')
          if($exclude-hardcoded-values, null, 1.375rem) #{'/'} if($exclude-hardcoded-values, null, 1.75rem) map.get($deps, 'md-ref-typeface', 'brand')
      ),
    'family': if($exclude-hardcoded-values, null, (Roboto))
  );
}
`

function fixtureEntries(): Record<string, { value: string, composite: boolean }> {
  const sections = parseScssTokenSections(FIXTURE, "md-fixture", "fixture.scss")
  expect(sections.length).toBe(1)
  const out: Record<string, { value: string, composite: boolean }> = {}
  for (const entry of (sections[0] as { entries: ReturnType<typeof parseScssValue>[] }).entries) out[entry.key] = entry
  return out
}

test("the parser reads wrapped entries, tuples, references and composites", () => {
  const entries = fixtureEntries()
  // The `$_default` map above is wiring, not vocabulary: exactly the values() keys came out.
  expect(Object.keys(entries)).toEqual(["multi-line-ref", "tuple", "plain", "opacity", "easing", "title-large", "family"])
  expect(entries["multi-line-ref"]?.value).toBe("ref:md-sys-shape:corner-full")
  expect(entries["tuple"]?.value).toBe("16px 16px 0 0")
  expect(entries["plain"]?.value).toBe("40px")
  expect(entries["opacity"]?.value).toBe("0.12")
  expect(entries["easing"]?.value).toBe("cubic-bezier(0.2, 0, 0, 1)")
  expect(entries["family"]?.value).toBe("Roboto")
  expect(entries["title-large"]?.value).toBe("ref:md-ref-typeface:weight-regular 1.375rem / 1.75rem ref:md-ref-typeface:brand")
  expect(entries["title-large"]?.composite).toBe(true)
})

test("the parser fails loudly instead of dropping a value it cannot classify", () => {
  const where = "fixture.scss"
  // Unknown function, missing if() branches, a 2-argument map.get, a non-$deps source, an unquoted key.
  expect(() => parseScssValue("some-unknown-fn($deps, 1px)", where, "broken-token")).toThrow(/broken-token/)
  expect(() => parseScssValue("some-unknown-fn($deps, 1px)", where, "broken-token")).toThrow(/fixture\.scss/)
  expect(() => parseScssValue("if($exclude-hardcoded-values, null)", where, "short-if")).toThrow(/short-if.*needs 3 arguments/)
  expect(() => parseScssValue("if($other-flag, null, 4px)", where, "wrong-flag")).toThrow(/wrong-flag.*unexpected if\(\) condition/)
  expect(() => parseScssValue("map.get($deps, 'md-sys-shape')", where, "short-ref")).toThrow(/short-ref.*map\.get needs/)
  expect(() => parseScssValue("map.get($not-deps, 'md-sys-shape', 'corner-full')", where, "wrong-source")).toThrow(/must read from \$deps/)
  expect(() => parseScssValue("1px 2px", where, "naked-list")).toThrow(/naked-list/)
  expect(() => parseScssValue("", where, "empty")).toThrow(/empty value/)

  // A whole-file failure names the file and the token rather than skipping the entry.
  const broken = FIXTURE.replace("'plain': if($exclude-hardcoded-values, null, 40px),", "'plain': weird(1px),")
  expect(() => parseScssTokenSections(broken, "md-fixture", "fixture.scss")).toThrow(/fixture\.scss: token 'plain'/)
  // Two functions whose names are not values / values-light / values-dark are a grammar change, not a surprise.
  expect(() => parseScssTokenSections(FIXTURE.replace("@function values(", "@function values-hc("), "md-fixture", "fixture.scss")).toThrow(/unsupported token function/)
})

test("comment stripping keeps quoted slashes and drops the inline warning", () => {
  const stripped = stripScssComments(`'a': map.get($deps, 'we//ird', 'b'), /** Warning: nope. */ 'c': 1px // trailing`, "fixture.scss")
  expect(stripped).toContain("'we//ird'")
  expect(stripped).not.toContain("Warning")
  expect(stripped).not.toContain("trailing")
  expect(stripped).toContain("'c': 1px")
})

test("the audit gate reports a tampered generated file and stays quiet on an honest one", async () => {
  // Rendered from the real installed maps, so this exercises the same bytes the checked-in file holds.
  const rendered = renderGeneratedFile(await collectMd3Tokens())
  expect(describeGeneratedDrift(rendered, rendered)).toEqual([])

  const tampered = rendered.replace('"container-height": "40px"', '"container-height": "44px"')
  expect(tampered).not.toBe(rendered)
  const drift = describeGeneratedDrift(tampered, rendered)
  expect(drift.length).toBeGreaterThan(0)
  expect(drift[0]).toContain("container-height")
  expect(drift[0]).toContain("44px")
  expect(drift[0]).toContain("40px")

  // A truncation is a length difference, not just a line difference.
  const truncated = rendered.split("\n").slice(0, 40).join("\n")
  expect(describeGeneratedDrift(truncated, rendered).some((line) => line.includes("line count"))).toBe(true)
})
