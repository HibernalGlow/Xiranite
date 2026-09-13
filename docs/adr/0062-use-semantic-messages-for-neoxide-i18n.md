---
status: accepted
---

# Use semantic messages for Neoxide internationalization

Neoxide will use stable semantic message IDs, language resource catalogs, and
typed parameters for Japanese, Simplified Chinese, and English. The user explicitly
rejected character replacement and the existing Japanese-source-string lookup
approach. Replace the localization infrastructure and its call sites completely.
Existing translations are reusable wording only, migrated by domain meaning into
the new catalogs. This decision supersedes the incremental source-keyed strategy
in Neoxide's `docs/i18n-plan.md` and `src/i18n.rs` module documentation. Keeping
upstream diffs small does not justify retaining that strategy. The replacement is
an accepted requirement; library selection and validation remain implementation work.

Each viewing session supplies its locale explicitly. Shared catalogs contain no
mutable global current language. A language change invalidates that session's text
and layout caches, while stable widget IDs, command names, persisted enums, setting
keys, file paths, and user-authored content retain their identities.

For example, `viewer-selected-count` is a semantic message ID and `count` is a
numeric argument. Plural selection and word order belong to each language resource.
Do not format a Japanese sentence first and then search/replace its finished text.
Background events should expose structured outcomes or message IDs and parameters
so each client can present them in its own language.

## Completion criteria

- Cover application-owned user-facing text in the native and WASM clients:
  menus, titles, sidebars, settings and their search index, tooltips, accessibility
  labels, notifications, progress, and errors presented to users. A sample screen
  or newly redesigned controls alone cannot establish completion.
- Migrate all display call sites to semantic messages and parameters. Retire the
  source-string lookup API and tables, `t_owned` translation of finished strings,
  and the `i18n_tool.py wrap` workflow. Do not leave a hidden source-string adapter
  behind the new API or continue extending the old mechanism during migration.
- Validate complete Japanese, Simplified Chinese, and English catalogs against
  the message inventory, including argument contracts. Language fallback may use
  the same semantic ID in another catalog; it must not consult the old Japanese
  source-text dictionary or count missing translations as completed coverage.
- Use stable message identity independent of any language's wording. Give
  different meanings separate IDs even when the old Japanese labels coincide.
  Changing a translation must not require changing its call sites or widget IDs.
- Inventory and verify call sites through source-aware tooling and explicit
  review. Character-range scans or literal-replacement counts cannot establish
  coverage: English labels, dynamic messages, and identical text with different
  meanings need to be accounted for too. Update maintenance docs and checks so
  the retired wrapping workflow cannot be mistaken for the supported approach.

The migration can be delivered in coherent commits, but both the infrastructure
and every inventoried application text surface must satisfy these criteria before
the i18n refactor is reported complete. Locale ownership, stable UI identity, and
rendering performance remain part of acceptance.

## Evaluated implementation candidate

The current recommendation is Fluent/FTL through `fluent-templates 0.15.1`, using
explicit-locale lookup and statically embedded resources. Its MIT/Apache-2.0
licensing, maintained upstream, parameter/plural handling, fallback support, and
official WASM compilation job fit native and browser clients without coupling
domain code to a UI framework.

| Candidate | Relevant trade-off |
| --- | --- |
| `fluent-templates 0.15.1` | Mature embedded loader over Fluent; explicit locale, parameters and language plural rules. Lookup returns allocated strings; initialization and hot-path cost need measurement. |
| `fluent-bundle 0.16.0` | Lower-level engine with the same message semantics, but requires loader/fallback assembly already supplied by the candidate above. |
| `i18n-embed 0.16.0` with Fluent | Suitable native/WASM requester and per-loader language selection; adds embedding/requester machinery beyond the currently needed explicit session boundary. |
| `rust-i18n 4.2.2` | Supports semantic keys and explicit locale, with a relatively direct runtime; the inspected implementation did not establish built-in CLDR plural selection for the required messages. |

If the candidate passes validation, use versioned crates.io dependencies. For this
version, `default-features = false` with `features = ["macros", "walkdir"]` provides
the embedded loader without optional template-engine integrations or the default
parallel directory walker. `macros` alone is insufficient because the crate
requires a directory traversal feature. No dependency has been introduced yet.

Official evidence:

- [Loader API](https://github.com/XAMPPRocky/fluent-templates#looking-up-fluent-resources),
  [WASM CI](https://github.com/XAMPPRocky/fluent-templates/blob/master/.github/workflows/rust.yml),
  [feature requirement](https://github.com/XAMPPRocky/fluent-templates/blob/master/src/fs.rs).
- [Fluent plural handling](https://github.com/projectfluent/fluent-rs/tree/main/fluent-bundle),
  [i18n-embed native/WASM loaders](https://github.com/kellpossible/cargo-i18n/tree/master/i18n-embed),
  [rust-i18n explicit locale](https://github.com/longbridge/rust-i18n#current-locale).

## Validation before adoption

Compile the selected loader for native and WASM; verify typed arguments, plural
branches, missing keys, fallback, and independent session language changes. Validate
catalog key/argument parity across all three languages and preserve stable widget
state across switches. Reuse Chinese translations by call-site meaning, splitting
identical Japanese text when it has different domain meanings.

Measure binary/WASM size, catalog initialization, formatting allocations, and frame
time. Parse catalogs once and cache stable labels by locale; never rebuild bundles
or read language files during each paint. Fonts and CJK shaping/fallback need
their own cross-platform check. This evaluation is source/documentation research,
not native/WASM compilation or performance evidence.
