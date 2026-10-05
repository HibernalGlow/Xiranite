//! The machine's own state — clipboard, interface traffic, CPU usage — as a node-reachable host service.
//!
//! ## Why these three live in one service called `os`
//!
//! They are not a node's domain: no retained node owns "what is on the clipboard". The first two are also
//! the questions nodes used to answer by spawning a shell, which is what the grant audit refused to sign
//! (`packages/nodes/*/src/platform.ts` calling `powershell.exe Get-Clipboard` / `pbpaste` /
//! `Get-NetAdapterStatistics` — an interpreter on an allowlist is a script runner, ADR-0074's
//! `DangerGate` reasoning). One service, one grant name, no `proc.exec` grant needed for any of them.
//!
//! `cpu.usage` is here for the same reason in a different costume: in the Node/Bun face it was
//! `node:os`'s `cpus()[].times` diffed against a previous read, and a realm has neither `node:os` nor
//! `times` on the `os.cpus` answer (`xiranite_core::cpu`'s module doc records the measured rejection of
//! `sleept`'s bundle at `cpu.times.user`). Answering the busy percentage — with the window it was measured
//! over — is the shape both transports can agree on.
//!
//! ## What a refusal looks like here
//!
//! `clipboard.readText` answers `{"text": "", "empty": true}` when the clipboard is reachable but holds
//! no text, because every shell path it replaces answered `""` and the nodes' behaviour was written
//! against that. A clipboard that cannot be opened at all answers an error instead — that is the
//! distinction the shell version destroyed (see `xiranite_core::clipboard`'s module doc). Traffic
//! counters have no failure mode to invent a shape for: the OS either reports an interface or it does not.
//!
//! ## Names are the wire contract
//!
//! The JSON keys are camelCase because a bundle reads them directly, and they mirror the Rust field
//! names of `xiranite_core::{clipboard,network}` so a reader can trace one value to one source.

use serde_json::{Value, json};
use xiranite_node_registry::NodeHost;

use crate::host_calls::{CallError, HostAnswer, answer, required_text};
use crate::machine::MachineAccess;

/// The methods this service answers, spelled once here and published by the service table.
pub(crate) const METHODS: &[&str] =
    &["info", "clipboard.readText", "clipboard.writeText", "net.counters", "cpu.usage", "knownFolder"];

/// Answers one `os` service method.
pub(crate) fn dispatch(
    method: &str,
    arguments: &Value,
    _host: &mut (dyn NodeHost + 'static),
    _machine: &MachineAccess,
) -> Result<HostAnswer, CallError> {
    match method {
        "info" => Ok(answer(info_document())),
        "clipboard.readText" => read_clipboard(),
        "clipboard.writeText" => write_clipboard(arguments),
        "net.counters" => Ok(answer(network_document())),
        "cpu.usage" => Ok(answer(cpu_document())),
        "knownFolder" => known_folder(arguments),
        other => Err(CallError::Failure(format!(
            "the os service does not answer {other:?}; it answers: {}",
            METHODS.join(", ")
        ))),
    }
}

/// What the host can ask this machine about itself, before any node tries.
fn info_document() -> Value {
    json!({
        "service": "os",
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "clipboard": {
            // Not a probe. Reading the pasteboard just to answer "can it be read" would touch the
            // user's clipboard during capability discovery — and measured, concurrent pasteboard
            // access aborts the process on macOS (`clipboard` serialises it behind a process-wide
            // gate for exactly that reason; a single worker thread is fine). What is declared here is
            // what this build promises; reachability is only ever reported by a call that needed it.
            "maxTextBytes": xiranite_core::clipboard::MAX_TEXT_BYTES,
            "readable": null,
            "writable": null
        },
        "networkCounters": true,
        "folders": xiranite_core::known_folders::ALL_FOLDERS
            .iter()
            .copied()
            .map(folder_json)
            .collect::<Vec<_>>(),
    })
}

/// The wire name of a known-folder source: `system` means the OS answered, `fallback` means a
/// home-relative guess, and a face must not render those two the same way.
fn source_name(source: xiranite_core::known_folders::FolderSource) -> &'static str {
    match source {
        xiranite_core::known_folders::FolderSource::System => "system",
        xiranite_core::known_folders::FolderSource::Fallback => "fallback",
    }
}

fn folder_json(folder: xiranite_core::known_folders::KnownFolder) -> Value {
    let resolved = xiranite_core::known_folders::resolve(folder);
    json!({
        "folder": folder.as_str(),
        "path": resolved.path.to_string_lossy(),
        "source": source_name(resolved.source),
    })
}

/// One well-known user directory, asked by name.
///
/// This is why the method exists: node defaults were literal Windows paths (`E:\SteamLibrary\…`,
/// `C:\Program Files\…`), which on macOS and Linux either name a volume that does not exist or
/// silently scan nothing. A default now has somewhere to ask.
fn known_folder(arguments: &Value) -> Result<HostAnswer, CallError> {
    use xiranite_core::known_folders::ALL_FOLDERS;
    let wanted = required_text(arguments, "folder")?;
    match ALL_FOLDERS.iter().copied().find(|folder| folder.as_str() == wanted) {
        Some(folder) => Ok(answer(folder_json(folder))),
        None => Err(CallError::Failure(format!(
            "unknown folder {wanted:?}; this host resolves: {}",
            ALL_FOLDERS.iter().map(|folder| folder.as_str()).collect::<Vec<_>>().join(", ")
        ))),
    }
}

fn read_clipboard() -> Result<HostAnswer, CallError> {
    match xiranite_core::clipboard::read_text() {
        Ok(text) => Ok(answer(json!({ "text": text, "empty": text.is_empty() }))),
        Err(xiranite_core::clipboard::ClipboardError::NoText) => {
            Ok(answer(json!({ "text": "", "empty": true })))
        }
        Err(error) => Err(CallError::Failure(error.to_string())),
    }
}

fn write_clipboard(arguments: &Value) -> Result<HostAnswer, CallError> {
    let text = required_text(arguments, "text")?;
    xiranite_core::clipboard::write_text(text).map_err(|error| CallError::Failure(error.to_string()))?;
    Ok(answer(json!({ "written": true, "bytes": text.len() })))
}

fn network_document() -> Value {
    let snapshot = xiranite_core::network::sample();
    json!({
        "truncated": snapshot.truncated,
        "interfaces": snapshot
            .interfaces
            .iter()
            .map(|row| json!({
                "name": row.name,
                "receivedTotal": row.received_total,
                "transmittedTotal": row.transmitted_total,
                "receivedSinceLastSample": row.received_since_last_sample,
                "transmittedSinceLastSample": row.transmitted_since_last_sample,
            }))
            .collect::<Vec<_>>(),
    })
}

/// How busy the machine was since this run's previous read, and the window that covers.
///
/// The window travels with the number because a percentage without one is not checkable: `0 %` over 5 s and
/// `0 %` over 5 minutes are different answers, and `sleept` turns this into a power action.
fn cpu_document() -> Value {
    let usage = xiranite_core::cpu::sample();
    json!({
        "busyPercent": usage.busy_percent,
        "perCore": usage.per_core,
        "windowMs": usage.window_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::machine::MachineAccess;

    fn call(method: &str, arguments: Value) -> Result<String, String> {
        let mut host = crate::test_host::CountingHost::new();
        let machine = MachineAccess::seam_only();
        match dispatch(method, &arguments, &mut host, &machine) {
            Ok(HostAnswer::Text(text)) => Ok(text),
            Ok(HostAnswer::Bytes(_)) => Err("the os service never answers bytes".to_string()),
            Err(error) => Err(error.message().to_string()),
        }
    }

    #[test]
    fn info_names_the_platform_without_claiming_a_working_clipboard() {
        let text = call("info", json!({})).expect("info always answers");
        let document: Value = serde_json::from_str(&text).expect("info is JSON");
        assert_eq!(document["service"], "os");
        assert_eq!(document["platform"], json!(std::env::consts::OS));
        assert!(document["clipboard"]["maxTextBytes"].as_u64().is_some());
        // `readable` and `probe` describe the same attempt, so they may not disagree.
        // `info` answers declared facts only. It must not touch the pasteboard, so the two
        // probe-shaped keys arrive as unknown until a call actually needs the text — and on macOS
        // constructing the clipboard handle off the main thread faults, which is what this guard
        // keeps out of a discovery call.
        let clipboard_section = document["clipboard"].to_string();
        assert!(document["clipboard"]["readable"].is_null(), "info must not claim a probed clipboard: {clipboard_section}");
        assert!(document["clipboard"]["writable"].is_null(), "info must not promise a write it never tried: {clipboard_section}");
    }

    /// Every node default that used to be a literal `E:\…` now has somewhere to ask. The loop is the
    /// sample: a per-name assertion that never ran would pass silently.
    #[test]
    fn every_known_folder_resolves_absolutely_and_names_its_source() {
        for folder in xiranite_core::known_folders::ALL_FOLDERS {
            let text = call("knownFolder", json!({ "folder": folder.as_str() }))
                .unwrap_or_else(|error| panic!("{folder:?} must resolve: {error}"));
            let document: Value = serde_json::from_str(&text).expect("a folder answer is JSON");
            let path = document["path"].as_str().expect("a path string");
            assert!(!path.is_empty(), "{folder:?} resolved to nothing");
            assert!(std::path::Path::new(path).is_absolute(), "{folder:?} gave {path:?}");
            assert!(
                matches!(document["source"].as_str(), Some("system") | Some("fallback")),
                "the source has to be distinguishable: {document}"
            );
        }
    }

    #[test]
    fn an_unknown_folder_name_is_refused_with_the_names_this_host_resolves() {
        let error = call("knownFolder", json!({ "folder": "steam" }))
            .expect_err("a drive-letter habit is not a known folder");
        assert!(error.to_string().contains("pictures"), "{error}");
        assert!(error.to_string().contains("downloads"), "{error}");
    }

    #[test]
    fn info_lists_all_four_folders() {
        let text = call("info", json!({})).expect("info needs no grant");
        let document: Value = serde_json::from_str(&text).expect("info is JSON");
        assert_eq!(document["folders"].as_array().map(Vec::len), Some(4), "{document}");
    }

    /// The answer `sleept`'s CPU monitor is written against: a stated window, a percentage, one number per
    /// core. A zero-length window would read as "idle" to a trigger, so the floor is asserted here too.
    #[test]
    fn cpu_usage_answers_a_percentage_with_the_window_behind_it() {
        let text = call("cpu.usage", json!({})).expect("cpu.usage needs no grant beyond the service");
        let document: Value = serde_json::from_str(&text).expect("cpu.usage is JSON");
        let busy = document["busyPercent"].as_f64().expect("busyPercent is a number");
        let window = document["windowMs"].as_u64().expect("windowMs is a number");
        let cores = document["perCore"].as_array().expect("perCore is a list").clone();

        assert!((0.0..=100.0).contains(&busy), "busyPercent is a percentage: {document}");
        assert!(window >= 200, "the answer must come from a real window: {document}");
        assert!(!cores.is_empty(), "every core is listed: {document}");
        for core in cores {
            let usage = core.as_f64().expect("per-core usage is a number");
            assert!((0.0..=100.0).contains(&usage), "per-core usage is a percentage: {document}");
        }
    }

    #[test]
    fn an_unknown_method_is_refused_with_the_published_set() {
        let error = call("clipboard.readImage", json!({})).expect_err("not published");
        assert!(error.contains("does not answer"), "{error}");
        for method in METHODS {
            assert!(error.contains(method), "the refusal must list {method}: {error}");
        }
    }

    #[test]
    fn writing_the_clipboard_requires_the_text_rather_than_assuming_empty() {
        let error = call("clipboard.writeText", json!({})).expect_err("no text given");
        assert!(error.contains("text"), "{error}");
    }

    #[test]
    fn traffic_counters_come_back_sorted_and_usable_as_a_delta() {
        let text = call("net.counters", json!({})).expect("counters answer on every supported platform");
        let document: Value = serde_json::from_str(&text).expect("counters are JSON");
        let interfaces = document["interfaces"].as_array().expect("an array of interfaces");
        assert!(!interfaces.is_empty(), "a machine with no interface at all cannot be probed this way");
        let names: Vec<&str> = interfaces.iter().map(|row| row["name"].as_str().unwrap()).collect();
        let mut sorted = names.clone();
        sorted.sort_unstable();
        assert_eq!(names, sorted, "the service must not hand a bundle a different order each call");
        for row in interfaces {
            assert!(
                row["receivedTotal"].as_u64().unwrap() >= row["receivedSinceLastSample"].as_u64().unwrap(),
                "{row}"
            );
        }
    }
}
