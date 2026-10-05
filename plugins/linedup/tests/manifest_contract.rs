//! `manifest.toml` and `definition.json` against the code that has to agree with them.
//!
//! Two documents decide how this plugin is loaded: the manifest tells the host which wasm to install,
//! which capability imports to register and which ceiling to enforce; the definition tells the CLI, the
//! TUI and the GUI what the node's fields mean. Either side drifting produces a plugin that loads and
//! then traps on its first host call, or a face that invents field meaning again (ADR-0069), so both
//! files are read here rather than trusted to match `src/node_metadata.rs`.
//!
//! The TOML reader is a deliberate ~70-line subset over the shape this manifest actually uses — one
//! `[backend]` table, scalar keys and two string arrays — because the full parser is not this crate's
//! business: `crates/xiranite-node-runtime/src/manifest.rs` (via `toml`) and
//! `scripts/audit-plugin-manifests.ts` (via `Bun.TOML.parse`) are the authoritative readers, and both
//! run against this file. What a test can own is the *agreement* between the manifest's text and the
//! constants the shim compiles against.

use std::collections::BTreeMap;
use std::path::Path;

use xiranite_plugin_linedup::node_metadata::{
    EXTISM_RUNTIME_VERSION, LINEDUP_ENTRY_POINTS, LINEDUP_HOST_FUNCTIONS, MEMORY_MAX_PAGES, PLUGIN_API_VERSION,
    PLUGIN_ID, PLUGIN_VERSION, WASM_FILE_NAME,
};

/// The nine settled capability names, spelled out from
/// `crates/xiranite-plugin-api/src/host_function_names.rs:46-56` and re-checked against that file by
/// `tests/plugin_contract.rs`. A tenth name needs an ADR (ADR-0071 Decision 4), so a manifest
/// declaring one is not a manifest this gate may bless.
const CANONICAL_HOST_FUNCTIONS: [&str; 9] = [
    "xiranite.operation.checkpoint",
    "xiranite.operation.update",
    "xiranite.operation.emit",
    "xiranite.process.run",
    "xiranite.scheduler.acquire",
    "xiranite.scheduler.release",
    "xiranite.log",
    "xiranite.now",
    "xiranite.path_token.resolve",
];

/// A manifest read as scalars and string arrays, keyed by the section they appeared under.
#[derive(Debug, Default)]
struct Manifest {
    sections: Vec<String>,
    scalars: BTreeMap<(String, String), String>,
    arrays: BTreeMap<(String, String), Vec<String>>,
}

impl Manifest {
    fn scalar(&self, section: &str, key: &str) -> Option<&str> {
        self.scalars.get(&(section.to_owned(), key.to_owned())).map(String::as_str)
    }

    fn array(&self, section: &str, key: &str) -> Vec<String> {
        self.arrays.get(&(section.to_owned(), key.to_owned())).cloned().unwrap_or_default()
    }
}

fn read_manifest() -> Manifest {
    parse_manifest(&std::fs::read_to_string(manifest_path()).expect("manifest.toml must sit beside Cargo.toml"))
}

/// Parses the subset of TOML this manifest uses. Anything shaped differently is a bug in this reader or
/// in the manifest, and panics with the offending line rather than reading it as empty.
fn parse_manifest(text: &str) -> Manifest {
    let mut manifest = Manifest::default();
    let mut section = String::new();
    let mut lines = text.lines().peekable();

    while let Some(line) = lines.next() {
        let trimmed = strip_inline_comment(line.trim());
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(header) = trimmed.strip_prefix('[') {
            let name = header.trim_end_matches(']').trim().to_owned();
            manifest.sections.push(name.clone());
            section = name;
            continue;
        }

        let (key, raw_value) =
            trimmed.split_once('=').unwrap_or_else(|| panic!("not a `key = value` line: {trimmed}"));
        let key = key.trim().to_owned();
        let raw_value = raw_value.trim();

        if raw_value.starts_with('[') {
            let mut body = raw_value.to_owned();
            while !body.ends_with(']') {
                let next = lines.next().unwrap_or_else(|| panic!("unterminated array for key {key}"));
                body.push(' ');
                body.push_str(strip_inline_comment(next.trim()));
            }
            let items = body
                .trim_start_matches('[')
                .trim_end_matches(']')
                .split(',')
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(|item| item.trim_matches('"').to_owned())
                .collect::<Vec<String>>();
            manifest.arrays.insert((section.clone(), key), items);
            continue;
        }

        manifest.scalars.insert((section.clone(), key), raw_value.trim_matches('"').to_owned());
    }

    manifest
}

/// Cuts a trailing `# …` comment. No value in this manifest contains a `#`, and a quoted `#` would be a
/// path the host generated rather than a comment, so the rule is stated rather than made context-aware.
fn strip_inline_comment(line: &str) -> &str {
    match line.find(" #") {
        Some(index) => line[..index].trim_end(),
        None => line,
    }
}

fn manifest_path() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("manifest.toml")
}

fn crate_path(relative: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(relative)
}

fn read_definition() -> serde_json::Value {
    let text = std::fs::read_to_string(crate_path("definition.json")).expect("definition.json must exist beside the manifest");
    serde_json::from_str(&text).expect("definition.json must parse as JSON")
}

#[test]
fn identity_and_the_three_version_facts_are_the_shipped_values() {
    let manifest = read_manifest();
    assert_eq!(manifest.scalar("", "id"), Some(PLUGIN_ID), "id must equal the plugin directory name");
    assert_eq!(manifest.scalar("", "version"), Some(PLUGIN_VERSION), "ADR-0068 pluginVersion");
    assert_eq!(manifest.scalar("", "backend_api"), Some(PLUGIN_API_VERSION), "ADR-0068 pluginApiVersion");
    assert_eq!(manifest.scalar("backend", "runtime_version"), Some(EXTISM_RUNTIME_VERSION), "ADR-0068 runtimeVersion");
    assert_eq!(manifest.scalar("backend", "runtime"), Some("extism"), "the only runtime this host executes");
    assert_eq!(manifest.scalar("backend", "entry"), Some(WASM_FILE_NAME));
    assert_eq!(manifest.sections, vec!["backend".to_owned()], "no other section is read by the host");
}

#[test]
fn the_entry_point_is_the_zero_parameter_export_the_host_can_drive() {
    let manifest = read_manifest();
    let entry_point = manifest.scalar("backend", "entry_point").expect("[backend] entry_point is required by manifest.rs");
    assert_eq!(entry_point, "linedup_run");
    assert!(
        LINEDUP_ENTRY_POINTS.contains(&entry_point),
        "the manifest's entry point must be one of the published document entry points"
    );
    // `compiled.rs:129-133` refuses anything that is not `(0) -> i32`, so the shim must not have grown
    // parameters. Text-scanned because the module is wasm-only and absent from a native build.
    let shim = std::fs::read_to_string(crate_path("src/extism_host.rs")).expect("src/extism_host.rs");
    assert!(shim.contains("pub extern \"C\" fn linedup_run() -> i32"), "the entry point must take no wasm parameters");
    assert!(!shim.contains("fn linedup_run(u64"), "a one-parameter export is unlinkable by the Rust host");
}

#[test]
fn the_memory_ceiling_is_the_number_the_plugin_also_quotes() {
    let manifest = read_manifest();
    let declared = manifest.scalar("backend", "memory_max_pages").expect("[backend] memory_max_pages is parsed by manifest.rs");
    assert_eq!(
        declared,
        MEMORY_MAX_PAGES.to_string().as_str(),
        "`count_of`, the batch sizing and lib.rs's memory note all quote this page count"
    );
    let pages: u32 = declared.parse().expect("memory_max_pages is a page count");
    assert!(pages > 0, "a zero-page plugin cannot be instantiated");
    assert!(pages <= 1024, "{pages} pages would exceed a 64 MiB isolate on a text node");
}

#[test]
fn host_functions_are_exactly_the_declared_one_and_from_the_nine() {
    let manifest = read_manifest();
    let declared = manifest.array("backend", "host_functions");
    assert_eq!(declared, LINEDUP_HOST_FUNCTIONS.to_vec(), "one list, one producer");
    assert!(declared.contains(&"xiranite.operation.checkpoint".to_owned()), "ADR-0066 requires every run to checkpoint");

    for name in &declared {
        assert!(
            CANONICAL_HOST_FUNCTIONS.contains(&name.as_str()),
            "{name} is not in the ADR-0068 vocabulary as closed by ADR-0071"
        );
    }
}

#[test]
fn no_retired_or_invented_capability_name_appears_in_code() {
    let forbidden = ["xiranite.fs.", "xiranite.file.", "xiranite.checkpoint", "xiranite.emit", "xiranite_checkpoint", "file.list_dir"];
    for relative in ["manifest.toml", "src/extism_host.rs", "src/run_control.rs", "src/file_access.rs", "src/plugin_entry.rs"] {
        let text = std::fs::read_to_string(crate_path(relative)).unwrap_or_else(|error| panic!("{relative}: {error}"));
        let code = strip_comment_lines(&text);
        for needle in forbidden {
            assert!(!code.contains(needle), "{relative} uses the retired or invented name {needle}");
        }
    }
}

#[test]
fn file_access_is_the_only_place_the_guest_touches_the_machine() {
    // ADR-0071: `std::fs` is the mechanism, and it belongs in exactly one module so path semantics,
    // refusal messages and the preopen contract have one home.
    let mut users: Vec<String> = Vec::new();
    for entry in std::fs::read_dir(crate_path("src")).expect("src exists") {
        let path = entry.expect("entry").path();
        if path.extension().is_some_and(|extension| extension != "rs") {
            continue;
        }
        let text = strip_comment_lines(&std::fs::read_to_string(&path).expect("readable"));
        if text.contains("std::fs::") {
            users.push(path.file_name().expect("file name").to_string_lossy().into_owned());
        }
    }
    assert_eq!(users, vec!["file_access.rs".to_owned()], "the filesystem seam must stay in one file");
}

#[test]
fn the_file_grant_is_empty_because_the_definition_declares_no_path_field() {
    let manifest = read_manifest();
    assert!(manifest.array("backend", "allowed_paths").is_empty(), "Linedup takes its roots from the operation, not from the manifest");
    assert!(manifest.array("backend", "allowed_hosts").is_empty(), "Linedup performs no network access");

    // The claim above is only true if the published definition really has no path field. Read the kinds.
    let definition = read_definition();
    let kinds: Vec<&str> = definition["fields"]
        .as_array()
        .expect("fields")
        .iter()
        .map(|field| field["kind"].as_str().expect("kind"))
        .collect();
    assert_eq!(kinds, vec!["multiline", "multiline", "boolean", "boolean"], "no path-shaped field exists to grant");
    assert_eq!(definition["publishesOutputPath"], serde_json::json!(false));

    // The write half of ADR-0071 is still real, which is why nothing is `ro:`-prefixed: `outputFile`
    // writes kept lines (`cli.ts:341`/`cli.ts:441`), so a read-only standing root would refuse the node's
    // own documented CLI flow while adding no containment the per-operation grant does not already give.
    let seam = std::fs::read_to_string(crate_path("src/file_access.rs")).expect("src/file_access.rs");
    assert!(seam.contains("std::fs::write"), "the node really writes, through std::fs and not a host function");
    assert!(seam.contains("std::fs::read_to_string"), "and reads the same way");
}

#[test]
fn the_published_definition_is_the_repositorys_copy_in_content() {
    let plugin = read_definition();
    let published_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../node-definitions/linedup.json");
    let published_text = std::fs::read_to_string(&published_path).unwrap_or_else(|error| {
        panic!("{} must exist: the published definition is the single source (ADR-0069): {error}", published_path.display())
    });
    let published: serde_json::Value = serde_json::from_str(&published_text).expect("node-definitions/linedup.json parses");

    assert_eq!(plugin, published, "definition.json must equal node-definitions/linedup.json");
    assert_eq!(plugin["nodeId"], serde_json::json!(PLUGIN_ID), "the definition must name the node the manifest ids");
    assert_eq!(plugin["definitionVersion"], serde_json::json!(1));

    // The node's own help block, quoted verbatim: `packages/nodes/linedup/src/help.ts` is the source of
    // these strings and `AGENTS.md` forbids drift in them.
    let help = &plugin["help"];
    assert_eq!(
        help["whenToUse"]["en"][0],
        serde_json::json!("Clean a source list by subtracting another list of names, IDs, paths, or tags.")
    );
    assert_eq!(help["safety"]["defaultMode"], serde_json::json!("preview"));
    assert_eq!(
        help["commands"][0]["command"],
        serde_json::json!("xiranite linedup filter"),
        "the command surface the CLI face must answer to"
    );
    assert_eq!(help["workflows"].as_array().expect("workflows").len(), 2);
    assert_eq!(
        help["whenToUse"]["zh"].as_array().expect("zh").len(),
        3,
        "the Chinese help copy ships with the definition, not with this crate"
    );
}

#[test]
fn an_empty_capability_list_would_be_caught_by_this_gate() {
    // Negative control for the tables above: the reader really reads the arrays, rather than returning
    // an empty default that would make every assertion above vacuously true.
    let text = std::fs::read_to_string(manifest_path()).expect("manifest.toml");

    let stripped = parse_manifest(&text.replace("\"xiranite.operation.checkpoint\",", ""));
    assert!(stripped.array("backend", "host_functions").is_empty(), "a removed entry is seen as removed");

    let renamed = parse_manifest(&text.replace("xiranite.operation.checkpoint", "xiranite.fs.list"));
    assert_eq!(renamed.array("backend", "host_functions"), vec!["xiranite.fs.list".to_owned()]);
    assert!(
        !renamed.array("backend", "host_functions").iter().any(|name| CANONICAL_HOST_FUNCTIONS.contains(&name.as_str())),
        "and a retired name fails the vocabulary check"
    );

    let unversioned = parse_manifest(&text.replace("backend_api = \"1.0\"", ""));
    assert_eq!(unversioned.scalar("", "backend_api"), None, "a missing version fact is missing, not defaulted");
}

/// Drops whole-line comments so a doc comment that *names* a retired capability is not mistaken for an
/// import of it.
fn strip_comment_lines(text: &str) -> String {
    text.lines()
        .filter(|line| {
            let trimmed = line.trim_start();
            !(trimmed.starts_with("//") || trimmed.starts_with('#'))
        })
        .collect::<Vec<&str>>()
        .join("\n")
}
