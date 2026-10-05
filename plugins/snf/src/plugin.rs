//! The plugin boundary: JSON in, JSON out, and the host functions this plugin
//! calls.
//!
//! Compiled only with `--features wasm` (the domain core above it never is, so
//! `cargo test` covers it on a normal host target). Two layers live here and they
//! are deliberately separate:
//!
//! - [`invoke_json`] is the document-level API of the node and is pure: any
//!   [`SnfFileSystem`], event sink and run control can be handed to it, which is how
//!   the unit tests at the bottom of this file exercise the entry logic without a
//!   wasm host.
//! - `mod isolate` is the Extism-facing shell: the `extern "C"` imports, the
//!   `offset | length` plumbing and the `#[unsafe(no_mangle)]` exports. It is
//!   `#[cfg(target_arch = "wasm32")]` because the packing it uses is only meaningful
//!   in a 32-bit linear address space, and because nothing on a host target can
//!   resolve the imports it declares.
//!
//! Boundary rules this layer obeys (ADR-0063 principle 9, ADR-0066, ADR-0071):
//!
//! - no sockets, no clock, no processes: `checkpoint`, `emit` and `scheduler.acquire` reach the host
//!   through the three imports below, whose names and count are pinned by
//!   `tests/manifest_contract.rs`. File IO is **not** one of them — `std::fs` against the WASI
//!   preopens the host grants is the whole filesystem (`crate::std_file_system`);
//! - bytes cross as `offset | length` blocks of UTF-8 JSON that stay small — a plan document or a
//!   progress event, never file contents;
//! - a refusal comes back as the shared envelope instead of trapping the isolate, so
//!   `core.ts`'s per-item error branch still has a message to store.

use serde::de::DeserializeOwned;

use crate::contract::{NodeRunEvent, SnfInput, SnfRunResult};
use crate::file_system::{SnfEventSink, SnfFileSystem, SnfRunControl};
use crate::input_normalization::normalize_snf_input;
use crate::node_metadata;
use crate::run::run_snf;

/// The document-level dispatcher for every exported entry point.
///
/// `snf_run` mirrors `runSnf`'s error boundary precisely: a request document that
/// cannot be deserialized at all fails the *call*, because `core.ts:86` normalizes
/// outside the `try` block, while anything that goes wrong while touching the
/// filesystem comes back as a `success: false` result document
/// (`core.ts:113-115`).
pub fn invoke_json(
    entry_point: &str,
    request: &str,
    file_system: &dyn SnfFileSystem,
    events: &dyn SnfEventSink,
    control: &dyn SnfRunControl,
) -> Result<String, InvocationFailure> {
    match entry_point {
        "snf_run" => {
            let input: SnfInput = parse_request_document(request)?;
            let result: SnfRunResult = run_snf(&input, file_system, events, control);
            Ok(encode_document(&result))
        }
        "snf_normalize_input" => {
            let input: SnfInput = parse_request_document(request)?;
            Ok(encode_document(&normalize_snf_input(&input)))
        }
        "snf_node_def" => Ok(encode_document(&node_metadata::node_definition())),
        "snf_node_help" => Ok(encode_document(&node_metadata::node_help())),
        "snf_plugin_descriptor" => Ok(encode_document(&node_metadata::plugin_descriptor())),
        other => Err(InvocationFailure::UnknownEntryPoint(other.to_string())),
    }
}

/// A call the plugin refused to make, reported to the host as the same envelope the
/// host functions answer with so there is one decoder on the host side.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InvocationFailure {
    /// The request document was not JSON, not an object, or missing a shape the
    /// entry point needs.
    InvalidRequest(String),
    /// The host called an export this plugin does not implement.
    UnknownEntryPoint(String),
}

impl InvocationFailure {
    /// Stable code the operation record and the card's error branch can switch on.
    #[must_use]
    pub const fn code(&self) -> &'static str {
        match self {
            Self::InvalidRequest(_) => "invalid_request",
            Self::UnknownEntryPoint(_) => "unknown_entry_point",
        }
    }

    #[must_use]
    pub fn message(&self) -> String {
        match self {
            Self::InvalidRequest(detail) => format!("SNF received a request it cannot read: {detail}"),
            Self::UnknownEntryPoint(name) => format!("SNF has no entry point named {name}"),
        }
    }

    /// `{"ok":false,"error":{"code","message"}}`.
    #[must_use]
    pub fn to_document(&self) -> String {
        format!(
            "{{\"ok\":false,\"error\":{{\"code\":\"{}\",\"message\":{}}}}}",
            self.code(),
            serde_json::to_string(&self.message()).unwrap_or_else(|_| "\"unencodable\"".to_string())
        )
    }
}

/// Decodes a request document.
///
/// `serde_json` rejects a non-object here exactly where `runSnf` would have
/// destructured `undefined`, so the plugin reports rather than guesses.
pub fn parse_request_document<T>(request: &str) -> Result<T, InvocationFailure>
where
    T: DeserializeOwned,
{
    if request.trim().is_empty() {
        return Ok(serde_json::from_str("{}").expect("empty object literal parses"));
    }
    serde_json::from_str(request).map_err(|error| InvocationFailure::InvalidRequest(error.to_string()))
}

/// The one encoder for response documents; a serialization failure cannot happen for
/// these types and is still reported rather than panicked on.
pub fn encode_document<T: serde::Serialize>(value: &T) -> String {
    crate::contract::write_json_or_placeholder(value)
}

/// Progress events are emitted as `nodeRunEventSchema` documents, the same shape the
/// operation stream already carries (`packages/shared/src/index.ts:91-98`).
pub fn event_document(event: &NodeRunEvent) -> String {
    encode_document(event)
}

#[cfg(target_arch = "wasm32")]
mod isolate {
    //! The Extism-facing half. Only compiled for the wasm target, where an
    //! `offset | length` block fits in 32 bits and the host can read the plugin's
    //! exported linear memory directly.

    use super::{encode_document, event_document};
    use crate::contract::NodeRunEvent;
    use crate::file_system::{SnfEventSink, SnfRunControl};
    use crate::host_surface::{
        CheckpointOutcome, ResourceAdmissionRequest, pack_offset_and_length, unpack_offset_and_length,
    };
    use crate::manifest_limits::MEMORY_MAX_BYTES;
    use crate::plugin::invoke_json;
    use crate::std_file_system::StdFileSystem;

    /// The capabilities SNF actually calls, and nothing else.
    ///
    /// The symbol is the part after the `xiranite.` namespace, which is how Extism registers a dotted
    /// Xiranite name (`xiranite.operation.checkpoint` is module `xiranite`, symbol
    /// `operation.checkpoint`); `tests/manifest_contract.rs` keeps these three imports, the declared
    /// list and `manifest.toml` identical.
    ///
    /// ADR-0071 removed the four `file.*` imports that used to sit here. The filesystem SNF works on
    /// is [`StdFileSystem`]: the host opened WASI preopens for the roots this node's manifest
    /// authorizes, so a `std::fs` call from inside the isolate reaches exactly those paths and
    /// nothing else.
    #[link(wasm_import_module = "xiranite")]
    unsafe extern "C" {
        #[link_name = "operation.checkpoint"]
        fn checkpoint(request: u64) -> u64;
        #[link_name = "operation.emit"]
        fn emit(request: u64) -> u64;
        #[link_name = "scheduler.acquire"]
        fn scheduler_acquire(request: u64) -> u64;
    }

    /// `xiranite.operation.emit`: the `onEvent` callback of `core.ts:85`.
    pub struct HostEventSink;

    impl SnfEventSink for HostEventSink {
        fn on_event(&self, event: &NodeRunEvent) {
            let request = event_document(event);
            let _written = unsafe { emit(pack_document(&request)) };
            // The return value is the host's retention verdict, not a failure the
            // plugin can act on: dropping a progress event must not abort a rename run.
        }
    }

    /// `xiranite.operation.checkpoint` and `xiranite.scheduler.acquire`.
    pub struct HostRunControl;

    impl SnfRunControl for HostRunControl {
        fn checkpoint(&self) -> CheckpointOutcome {
            // `0` is the packed empty block: a checkpoint carries no document, the
            // host already knows which operation owns this call.
            CheckpointOutcome::from_abi_code(unsafe { checkpoint(0) })
        }

        fn acquire_disk_admission(&self) -> bool {
            let request = encode_document(&ResourceAdmissionRequest {
                resource: "io".to_string(),
                kind: "folder-rename".to_string(),
                priority: "background".to_string(),
                weight: 1,
                minimum_weight: 1,
                memory_mib: u32::try_from(MEMORY_MAX_BYTES / (1024 * 1024)).unwrap_or(u32::MAX),
            });
            let token = unsafe { scheduler_acquire(pack_document(&request)) };
            // A zero token means the host runs without admission; the run continues
            // either way. The permit itself is the host's to reclaim when this
            // invocation returns, because ADR-0066 defines no release function.
            token != 0
        }
    }

    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    fn pack_document(document: &str) -> u64 {
        let bytes = document.as_bytes();
        pack_offset_and_length(bytes.as_ptr() as usize, bytes.len())
    }

    /// Reads a request document the host wrote into this plugin's memory.
    ///
    /// # Safety
    /// `argument` must be an `offset | length` block the host wrote, valid for
    /// `length` bytes, which is exactly the invariant Extism maintains.
    unsafe fn read_input_document(argument: u64) -> String {
        let (offset, length) = unpack_offset_and_length(argument);
        if length == 0 {
            return String::new();
        }
        let bytes = unsafe { std::slice::from_raw_parts(offset as *const u8, length) };
        String::from_utf8_lossy(bytes).into_owned()
    }

    /// Publishes a response document. The allocation is handed to the host, which
    /// copies it and then calls `snf_free`; nothing is leaked when an instance
    /// is pooled across calls.
    fn publish_document(document: String) -> u64 {
        let boxed: Box<[u8]> = document.into_bytes().into_boxed_slice();
        let value = pack_offset_and_length(boxed.as_ptr() as usize, boxed.len());
        std::mem::forget(boxed);
        value
    }

    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    fn exported(entry_point: &str, argument: u64) -> u64 {
        let request = unsafe { read_input_document(argument) };
        let document = match invoke_json(
            entry_point,
            &request,
            // ADR-0071: the filesystem is `std::fs` on the preopens the host granted, not a host
            // function. Everything below `invoke_json` is the same core the native tests run.
            &StdFileSystem,
            &HostEventSink,
            &HostRunControl,
        ) {
            Ok(document) => document,
            Err(failure) => failure.to_document(),
        };
        publish_document(document)
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn snf_run(argument: u64) -> u64 {
        exported("snf_run", argument)
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn snf_normalize_input(argument: u64) -> u64 {
        exported("snf_normalize_input", argument)
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn snf_node_def() -> u64 {
        exported("snf_node_def", 0)
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn snf_node_help() -> u64 {
        exported("snf_node_help", 0)
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn snf_plugin_descriptor() -> u64 {
        exported("snf_plugin_descriptor", 0)
    }

    /// Reclaims a buffer handed out by [`publish_document`].
    ///
    /// # Safety
    /// `argument` must be a value this plugin returned from an entry point.
    #[unsafe(no_mangle)]
    #[allow(clippy::cast_possible_truncation)]
    pub unsafe extern "C" fn snf_free(argument: u64) {
        let (offset, length) = unpack_offset_and_length(argument);
        if length == 0 {
            return;
        }
        unsafe {
            let raw: *mut [u8] = std::slice::from_raw_parts_mut(offset as *mut u8, length);
            drop(Box::<[u8]>::from_raw_parts(raw));
        }
    }

    /// Every exported name, checked against the declared list. Test-only so a release
    /// wasm build carries no unused constant.
    #[cfg(test)]
    pub const EXPORTED_NAMES: &[&str] = &[
        "snf_run",
        "snf_normalize_input",
        "snf_node_def",
        "snf_node_help",
        "snf_plugin_descriptor",
        "snf_free",
    ];

    #[cfg(test)]
    mod tests {
        use super::EXPORTED_NAMES;
        use crate::host_surface::PLUGIN_ENTRY_POINTS;

        #[test]
        fn exports_and_the_declared_entry_list_agree() {
            for name in PLUGIN_ENTRY_POINTS {
                assert!(EXPORTED_NAMES.contains(name), "{name} is declared but not exported");
            }
            for name in EXPORTED_NAMES {
                assert!(PLUGIN_ENTRY_POINTS.contains(name), "{name} is exported but not declared");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_system::{ContinueThroughRunControl, NoopEventSink};
    use crate::manifest_limits::MEMORY_MAX_PAGES;
    use crate::memory_file_system::MemoryFileSystem;

    fn invoke(entry_point: &str, request: &str, file_system: &MemoryFileSystem) -> Result<String, InvocationFailure> {
        invoke_json(entry_point, request, file_system, &NoopEventSink, &ContinueThroughRunControl)
    }

    #[test]
    fn snf_run_answers_with_the_node_result_document() {
        let file_system = MemoryFileSystem::new().with_directory("/library/Artist", &[("3. CG", true)]);
        let document = invoke(
            "snf_run",
            r#"{"action":"plan","paths":["/library/Artist"],"mode":"artist"}"#,
            &file_system,
        )
        .expect("invoke");
        let parsed: SnfRunResult = serde_json::from_str(&document).expect("result document");
        assert!(parsed.success);
        assert_eq!(parsed.message, "SNF planned 1 item(s).");
        assert_eq!(parsed.data.expect("data").ready_count, 1);
    }

    #[test]
    fn an_unreadable_request_fails_the_call_instead_of_the_run() {
        let file_system = MemoryFileSystem::new();
        let failure = invoke("snf_run", "{\"paths\":", &file_system).expect_err("must fail");
        assert_eq!(failure.code(), "invalid_request");
        let document = failure.to_document();
        assert!(document.starts_with(r#"{"ok":false,"error":{"code":"invalid_request""#), "{document}");
    }

    #[test]
    fn an_empty_request_is_a_missing_paths_failure_result() {
        let file_system = MemoryFileSystem::new();
        let document = invoke("snf_run", "", &file_system).expect("invoke");
        let parsed: SnfRunResult = serde_json::from_str(&document).expect("result document");
        assert!(!parsed.success);
        assert_eq!(parsed.message, crate::run::MESSAGE_AT_LEAST_ONE_FOLDER);
    }

    #[test]
    fn normalize_and_the_metadata_documents_answer_without_a_filesystem() {
        let file_system = MemoryFileSystem::new();
        let normalized = invoke("snf_normalize_input", r#"{"path":"  D:/a "}"#, &file_system).expect("invoke");
        assert!(normalized.contains(r#""paths":["D:/a"]"#), "{normalized}");
        assert!(normalized.contains(r#""dryRun":true"#));
        let definition = invoke("snf_node_def", "", &file_system).expect("invoke");
        assert!(definition.contains(r#""id":"snf""#));
        let descriptor = invoke("snf_plugin_descriptor", "", &file_system).expect("invoke");
        assert!(descriptor.contains(r#""portedFrom":"@xiranite/node-snf""#));
        assert!(descriptor.contains(&format!("\"memoryMaxPages\":{MEMORY_MAX_PAGES}")));
        let help = invoke("snf_node_help", r#"{}"#, &file_system).expect("invoke");
        assert!(help.contains("Repair numbered folder sequences inside artist folders."));
    }

    #[test]
    fn an_unknown_entry_point_is_reported_not_silently_ignored() {
        let file_system = MemoryFileSystem::new();
        let failure = invoke("snf_delete_everything", "{}", &file_system).expect_err("must fail");
        assert_eq!(failure.code(), "unknown_entry_point");
    }

    #[test]
    fn every_entry_point_name_is_dispatched() {
        for name in crate::host_surface::PLUGIN_ENTRY_POINTS {
            if *name == "snf_free" {
                continue; // the reclaim helper is an export, not a document entry point
            }
            let file_system = MemoryFileSystem::new();
            let outcome = invoke(name, "{}", &file_system);
            assert!(outcome.is_ok(), "{name} did not dispatch: {outcome:?}");
        }
    }
}
