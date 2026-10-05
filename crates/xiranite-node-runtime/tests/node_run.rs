//! End-to-end proof that the rewrite's whole chain runs: HTTP `/operations` → `xiranite-core`
//! lifecycle → `xiranite-node-runtime` → Extism adapter → `dissolvef.wasm` → real `xiranite.fs.*`
//! calls against a real directory → events and a terminal result.
//!
//! The wasm is a build artifact, not a fixture: run `bun run build:node-wasm dissolvef` first. The
//! test fails loudly when it is missing rather than skipping, because a skipped test is not evidence
//! that the boundary works.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use xiranite_api::{ApiContext, router};
use xiranite_core::{OperationManager, OperationManagerOptions, SystemClock};
use xiranite_node_runtime::NodeRuntime;

const TOKEN: &str = "test-token";

/// The staged plugin directory `scripts/build-node-wasm.ts` writes.
fn staged_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .map(|root| root.join("artifacts").join("plugins"))
        .expect("workspace root is two levels above the crate")
}

/// Builds the tree the node actually plans on, and returns the **library root**: `planArchive`
/// (`core.ts:363-390`) walks every directory deepest-first but `protectFirstLevel` (default true,
/// `interaction.ts`) skips the library's direct children, so the dissolvable folders have to sit one
/// level below an artist folder. Qualifying means: exactly one file, it is an archive, and no child
/// directories (`core.ts:375`).
fn create_library(root: &Path) -> PathBuf {
    let library = root.join("Library");
    let artist = library.join("Artist A");
    let single_archive = artist.join("[001] Set One");
    let single_media = artist.join("[002] Set Two");
    let keep = artist.join("[003] Keep");
    for directory in [&single_archive, &single_media, &keep] {
        std::fs::create_dir_all(directory).expect("fixture directory");
    }
    std::fs::write(single_archive.join("set-one.zip"), b"zip").expect("fixture archive");
    std::fs::write(single_media.join("movie.mp4"), b"mp4").expect("fixture media");
    std::fs::write(keep.join("a.zip"), b"zip").expect("fixture a");
    std::fs::write(keep.join("b.zip"), b"zip").expect("fixture b");
    library
}

async fn ask(app: axum::Router, request: axum::http::Request<axum::body::Body>) -> (u16, Value) {
    let response = app.oneshot(request).await.expect("request");
    let status = response.status().as_u16();
    let bytes = response.into_body().collect().await.expect("body").to_bytes();
    let text = String::from_utf8(bytes.to_vec()).expect("utf-8 body");
    let body = if text.is_empty() { Value::Null } else { serde_json::from_str(&text).expect("json body") };
    (status, body)
}

fn post(path: &str, body: Value) -> axum::http::Request<axum::body::Body> {
    axum::http::Request::builder()
        .method("POST")
        .uri(path)
        .header("x-xiranite-token", TOKEN)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(body.to_string()))
        .expect("request")
}

fn get(path: String) -> axum::http::Request<axum::body::Body> {
    axum::http::Request::builder()
        .method("GET")
        .uri(path)
        .header("x-xiranite-token", TOKEN)
        .body(axum::body::Body::empty())
        .expect("request")
}

/// The host-side wire shape, pinned without a plugin in the way: `xiranite.fs.stat` on a real
/// directory must answer `exists: true`, because the node turns *any* refusal into "path does not
/// exist" (the `platform.ts:70-78` mapping) and that is otherwise undiagnosable from the result alone.
#[test]
fn the_file_capability_answers_stat_and_list_for_a_granted_directory() {
    use xiranite_extism_adapter::{CapabilityAnswer, CapabilityHost};
    use xiranite_node_runtime::{OperationCapabilities, SERVED_CAPABILITIES};
    use xiranite_core::filesystem::FileCapability;

    let temp = tempfile::tempdir().expect("tempdir");
    let library = create_library(temp.path());
    let artist = library.join("Artist A");
    let operations = OperationManager::new(OperationManagerOptions::default());
    let control = operations.start("dissolvef", None, None);
    let capabilities = OperationCapabilities::new(
        operations.clone(),
        control.clone(),
        FileCapability::new([temp.path()]),
        Arc::new(SystemClock),
    );

    let request = json!({ "operationId": control.operation_id(), "path": artist }).to_string();
    let answer = capabilities.capability("xiranite.fs.stat", &request).expect("stat served");
    let CapabilityAnswer::Document(data) = answer else {
        panic!("fs.stat answers a document, got a code: {answer:?}");
    };
    assert_eq!(data["exists"], json!(true), "a granted directory exists: {data}");
    assert_eq!(data["isDirectory"], json!(true));

    let list_request = json!({ "operationId": control.operation_id(), "path": artist }).to_string();
    let listed = capabilities.capability("xiranite.fs.list", &list_request).expect("list served");
    let CapabilityAnswer::Document(entries) = listed else { panic!("fs.list answers a document") };
    let names: Vec<&str> =
        entries.as_array().expect("bare array").iter().filter_map(|e| e["name"].as_str()).collect();
    assert_eq!(names, vec!["[001] Set One", "[002] Set Two", "[003] Keep"], "sorted listing: {entries}");

    // A call for a different operation is refused rather than served, and an undeclared capability is
    // `not_implemented` instead of a trap.
    let wrong_scope = json!({ "operationId": "op-other", "path": artist }).to_string();
    let refusal = capabilities.capability("xiranite.fs.stat", &wrong_scope).expect_err("mismatched id");
    assert_eq!(refusal.code, "operation_mismatch");
    // ADR-0070 put the streamed *write* behind the host's file-operation journal. There is no journal
    // in this core yet, so the settled name must refuse rather than hand out an unjournalable handle.
    let unserved = capabilities.capability("xiranite.fs.write", "{}").expect_err("no journal yet");
    assert_eq!(unserved.code, "not_implemented");
    assert!(SERVED_CAPABILITIES.contains(&"xiranite.fs.stat"));
}

/// The handle family over the real wire shape: `fs.open` → `fs.read` → `fs.close` through
/// [`CapabilityHost`], with the chunk base64-decoded back on the far side. This is the boundary a node
/// like smartzip needs — a ZIP central directory at the tail of a file far bigger than the text
/// ceiling — so the ceiling is checked here rather than assumed.
#[test]
fn the_handle_family_streams_a_file_that_the_text_ceiling_refuses() {
    use base64::Engine as _;
    use xiranite_core::file_stream::MAX_CHUNK_BYTES;
    use xiranite_core::filesystem::{FileCapability, MAX_TEXT_BYTES};
    use xiranite_extism_adapter::{CapabilityAnswer, CapabilityHost};
    use xiranite_node_runtime::OperationCapabilities;

    let temp = tempfile::tempdir().expect("tempdir");
    let size = MAX_TEXT_BYTES as usize + 4096;
    let contents: Vec<u8> =
        (0..size).map(|index| u8::try_from(index % 251).unwrap_or_default()).collect();
    let archive = temp.path().join("tail-central-directory.zip");
    std::fs::write(&archive, &contents).expect("fixture write");

    let operations = OperationManager::new(OperationManagerOptions::default());
    let control = operations.start("smartzip", None, None);
    let capabilities = OperationCapabilities::new(
        operations.clone(),
        control.clone(),
        FileCapability::new([temp.path()]),
        Arc::new(SystemClock),
    );
    let id = control.operation_id();

    // Positive control: the document read still refuses this file, so what follows is evidence about
    // the handle family crossing the ceiling, not about the ceiling having moved.
    let documents = FileCapability::new([temp.path()]);
    let refusal = documents
        .read_text(&archive.to_string_lossy())
        .expect_err("the text ceiling must still refuse this file");
    assert_eq!(refusal.code(), "text_too_large");

    let opened = capabilities
        .capability(
            "xiranite.fs.open",
            &json!({ "operationId": id, "path": archive, "mode": "read" }).to_string(),
        )
        .expect("fs.open served");
    let CapabilityAnswer::Document(opened) = opened else { panic!("fs.open answers a document") };
    let handle = opened["handle"].as_u64().expect("a handle id");
    assert_eq!(opened["sizeBytes"].as_u64(), Some(size as u64), "{opened}");

    // The tail, which is what a ZIP central directory reader actually wants.
    let tail_offset = size as u64 - 4096;
    let answer = capabilities
        .capability(
            "xiranite.fs.read",
            &json!({
                "operationId": id, "handle": handle, "offset": tail_offset, "maxBytes": 4096
            })
            .to_string(),
        )
        .expect("fs.read served");
    let CapabilityAnswer::Document(answer) = answer else { panic!("fs.read answers a document") };
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(answer["bytes"].as_str().expect("base64 chunk"))
        .expect("the chunk must decode");
    assert_eq!(decoded, contents[tail_offset as usize..], "the tail must come back byte-exact");

    // Walking the whole file in chunks, which is the loop a plugin writes.
    let mut gathered = Vec::new();
    let mut offset = 0u64;
    while offset < size as u64 {
        let answer = capabilities
            .capability(
                "xiranite.fs.read",
                &json!({
                    "operationId": id, "handle": handle, "offset": offset,
                    "maxBytes": MAX_CHUNK_BYTES
                })
                .to_string(),
            )
            .expect("chunk read served");
        let CapabilityAnswer::Document(document) = answer else { unreachable!("document") };
        let piece = base64::engine::general_purpose::STANDARD
            .decode(document["bytes"].as_str().expect("base64 chunk"))
            .expect("decodable chunk");
        if piece.is_empty() {
            panic!("end of stream before the whole file was read at offset {offset}");
        }
        offset += piece.len() as u64;
        gathered.extend_from_slice(&piece);
    }
    assert_eq!(gathered.len(), size, "chunked reads must cover the file exactly once");
    assert_eq!(gathered, contents);

    // Refusals stay data on this boundary too: an oversized ask, the reserved handle id, and a handle
    // belonging to another operation's table.
    let oversized = capabilities
        .capability(
            "xiranite.fs.read",
            &json!({
                "operationId": id, "handle": handle, "offset": 0u64,
                "maxBytes": MAX_CHUNK_BYTES + 1
            })
            .to_string(),
        )
        .expect_err("one call cannot ask for the rest of the file");
    assert_eq!(oversized.code, "chunk_too_large");
    let reserved = capabilities
        .capability(
            "xiranite.fs.read",
            &json!({ "operationId": id, "handle": 0u64, "offset": 0u64, "maxBytes": 16u32 }).to_string(),
        )
        .expect_err("0 is the reserved no-handle value");
    assert_eq!(reserved.code, "invalid_handle");
    let foreign = capabilities
        .capability(
            "xiranite.fs.read",
            &json!({ "operationId": id, "handle": handle + 1000, "offset": 0u64, "maxBytes": 16u32 })
                .to_string(),
        )
        .expect_err("an id this host never minted");
    assert_eq!(foreign.code, "not_found");

    capabilities
        .capability("xiranite.fs.close", &json!({ "operationId": id, "handle": handle }).to_string())
        .expect("close served");
    let reopened = capabilities
        .capability(
            "xiranite.fs.read",
            &json!({ "operationId": id, "handle": handle, "offset": 0u64, "maxBytes": 16u32 }).to_string(),
        )
        .expect_err("the handle was closed");
    assert_eq!(reopened.code, "not_found");
}

#[tokio::test]
async fn dissolvef_plan_runs_a_real_wasm_plugin_over_the_operations_protocol() {
    let staged = staged_root();
    assert!(
        staged.join("dissolvef").join("dissolvef.wasm").is_file(),
        "`{}` has no staged dissolvef plugin; run `bun run build:node-wasm dissolvef` first",
        staged.display()
    );

    let temp = tempfile::tempdir().expect("tempdir");
    let library = create_library(temp.path());
    let history_dir = temp.path().join("data");

    let registry = Arc::new(
        xiranite_node_runtime::NodeRegistry::load(&staged)
            .unwrap_or_else(|error| panic!("loading staged plugins from {}: {error}", staged.display())),
    );
    let runtime = NodeRuntime::new(
        Arc::clone(&registry),
        Arc::new(SystemClock),
        vec![temp.path().to_path_buf()],
        history_dir,
    );

    let operations = OperationManager::new(OperationManagerOptions::default());
    let app = router(Arc::new(ApiContext::new(
        operations.clone(),
        TOKEN,
        "test-instance",
        Arc::new(runtime),
    )));

    let (status, body) = ask(
        app.clone(),
        post(
            "/nodes/dissolvef/operations",
            json!({ "input": { "action": "plan", "path": library.to_string_lossy(), "preview": true } }),
        ),
    )
    .await;
    assert_eq!(status, 200, "the run request is accepted with the queued record: {body}");
    let operation_id =
        body["operation"]["operationId"].as_str().expect("operation id").to_owned();

    // The completion watcher, not a poll: it resolves exactly when `finish()` writes a terminal phase.
    let mut watcher = operations.completion_watcher(&operation_id).expect("watcher for a live operation");
    watcher.changed().await.expect("the run reports a terminal result");

    let (status, record) = ask(app.clone(), get(format!("/node-operations/{operation_id}"))).await;
    assert_eq!(status, 200, "the operation is still registered: {record}");
    let operation = &record["operation"];
    assert_eq!(
        operation["phase"].as_str(),
        Some("completed"),
        "a plan run over a grant it owns must complete, got {record}"
    );
    assert_eq!(operation["result"]["success"].as_bool(), Some(true), "the plugin reported success: {record}");

    // `plan` reports no progress lines: `core.ts:170-185` returns the plan before `executePlan`, and
    // `onEvent` is only called from the write loop (`core.ts:494`, `core.ts:514`) and the undo loop
    // (`core.ts:569`, `core.ts:599`). Asserting the empty stream is what pins that behaviour instead
    // of inventing one; the events themselves are covered by the execute test below.
    let (status, events) = ask(app.clone(), get(format!("/node-operations/{operation_id}/events"))).await;
    assert_eq!(status, 200, "the event stream is readable: {events}");
    assert_eq!(events["events"].as_array().expect("events array").len(), 0, "a plan run emits nothing");

    let data = &operation["result"]["data"];
    // The numbers below are what this fixture produces (measured, then pinned): two single-file
    // folders planned as media moves, the artist folder itself refused by the similarity gate, and
    // the two-archive folder left out of the plan entirely.
    assert_eq!(data["errorCount"].as_u64(), Some(0), "the scan reported no errors: {data}");
    assert_eq!(data["successCount"].as_u64(), Some(0), "a plan run applies nothing: {data}");
    assert_eq!(data["mediaCount"].as_u64(), Some(2), "both single-file folders were planned: {data}");
    assert_eq!(data["totalCount"].as_u64(), Some(5), "two moves, two delete_dir, one skipped: {data}");
    assert_eq!(data["skippedCount"].as_u64(), Some(1), "the similarity gate skipped one: {data}");
    let skipped = data["plan"]
        .as_array()
        .expect("plan array")
        .iter()
        .find(|item| item["status"] == json!("skipped"))
        .expect("a skipped row");
    assert_eq!(skipped["reason"].as_str(), Some("similarity_below_threshold"), "{data}");
}

/// The write path, which is what exercises the rest of the capability set: `xiranite.operation.emit`
/// for progress, `xiranite.fs.move` for the dissolution and `xiranite.fs.read`/`fs.write` for the undo
/// journal. Everything happens inside a temp directory.
#[tokio::test]
async fn dissolvef_execute_moves_the_dissolvable_folders_and_writes_the_undo_journal() {
    let staged = staged_root();
    assert!(
        staged.join("dissolvef").join("dissolvef.wasm").is_file(),
        "`{}` has no staged dissolvef plugin; run `bun run build:node-wasm dissolvef` first",
        staged.display()
    );

    let temp = tempfile::tempdir().expect("tempdir");
    let library = create_library(temp.path());
    let history = temp.path().join("undo").join("dissolvef.undo.json");

    let registry = Arc::new(
        xiranite_node_runtime::NodeRegistry::load(&staged)
            .unwrap_or_else(|error| panic!("loading staged plugins from {}: {error}", staged.display())),
    );
    let runtime = NodeRuntime::new(
        Arc::clone(&registry),
        Arc::new(SystemClock),
        vec![temp.path().to_path_buf()],
        temp.path().join("data"),
    );

    let operations = OperationManager::new(OperationManagerOptions::default());
    let app = router(Arc::new(ApiContext::new(
        operations.clone(),
        TOKEN,
        "test-instance",
        Arc::new(runtime),
    )));

    let (status, body) = ask(
        app.clone(),
        post(
            "/nodes/dissolvef/operations",
            json!({
                "input": {
                    "action": "dissolve",
                    "path": library.to_string_lossy(),
                    "preview": false,
                    "historyPath": history.to_string_lossy(),
                }
            }),
        ),
    )
    .await;
    assert_eq!(status, 200, "the run is accepted: {body}");
    let operation_id = body["operation"]["operationId"].as_str().expect("operation id").to_owned();

    let mut watcher = operations.completion_watcher(&operation_id).expect("watcher");
    watcher.changed().await.expect("a terminal result is reported");

    let (_, record) = ask(app.clone(), get(format!("/node-operations/{operation_id}"))).await;
    let operation = &record["operation"];
    assert_eq!(operation["phase"].as_str(), Some("completed"), "the write run completed: {record}");
    assert_eq!(operation["result"]["success"].as_bool(), Some(true), "the node reported success: {record}");

    // Progress really crossed `xiranite.operation.emit` into the operation's stream.
    let (_, events) = ask(app, get(format!("/node-operations/{operation_id}/events"))).await;
    let lines: Vec<&str> = events["events"]
        .as_array()
        .expect("events array")
        .iter()
        .filter_map(|entry| entry["event"]["message"].as_str())
        .collect();
    assert!(
        lines.contains(&"Dissolve completed."),
        "the write loop's closing line reached the stream, got {lines:?}"
    );

    // The dissolution really touched the disk. `planArchive` moves the archive to
    // `dirname(dir)/archive.name` (`core.ts:386`), i.e. up into the artist folder, and the emptied
    // folder is then removed.
    let artist = library.join("Artist A");
    assert!(artist.join("set-one.zip").is_file(), "the archive moved up into the artist folder: {artist:?}");
    assert!(!artist.join("[001] Set One").exists(), "the dissolved folder was removed");
    assert!(artist.join("[003] Keep").is_dir(), "the two-archive folder was left alone");

    // The undo journal was written through `xiranite.fs.write`, inside the grant.
    let journal = std::fs::read_to_string(&history).expect("the undo journal exists");
    assert!(journal.contains("dissolve-"), "the journal carries a dissolve record: {journal}");
}
