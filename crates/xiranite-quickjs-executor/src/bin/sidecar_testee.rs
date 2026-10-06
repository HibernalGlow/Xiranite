//! The stand-in engine `src/sidecar.rs` and `src/findz_operations.rs` tests stage as a bare
//! program name.
//!
//! It is not a Findz emulator: it speaks the envelope (`requestVersion`/`requestId`/`method`/
//! `params`) and echoes the request it saw, so a test can assert on **what crossed the pipe**
//! rather than on this binary's opinion about it. The real core's behaviour is covered by Go's
//! own suite (`native/findz-go/serve_test.go`), and the end-to-end run against the real Go
//! executable is recorded in `docs/migration/findz-go-sidecar-roadmap.md` §3.4 — this file only
//! exists so the Rust job does not need a Go toolchain to prove the framing.
//!
//! Modes (first argument, after the staging directory renamed it):
//! - `answer` (default): every line in, one envelope out.
//! - `chatty`: write far more to stderr than a pipe buffer holds, then answer. This is the
//!   deadlock `machine.rs` warns about, so it proves the stderr drain thread is load-bearing.
//! - `stall`: answer the first request, then hold every later one back. The host's timeout arm,
//!   and the shape an engine wedge actually takes — the caller needs a first answer to learn the
//!   child's pid before the run that gets stuck on the second frame.
//! - `die`: read one line, say nothing, exit non-zero. The disconnected-stream arm.

use std::io::{BufRead, BufReader, Write};
use std::sync::atomic::{AtomicU32, Ordering};

/// How many `task.wait` frames this child has answered (`tasker` mode only).
static TASK_WAITS: AtomicU32 = AtomicU32::new(0);

fn main() {
    let mode = std::env::args().nth(1).unwrap_or_else(|| "answer".to_string());
    let stdin = std::io::stdin();
    let mut reader = BufReader::new(stdin.lock());
    let mut out = std::io::stdout();
    let mut line = String::new();
    let mut seen = 0_u32;
    // Set once a request names a root containing "wedged": from then on `task.wait` answers `queued`
    // forever, which is how a test exercises the bound on the host's settle loop rather than trusting
    // the constant. The signal rides on the path because the child's argv is fixed by the holder.
    let mut wedged = false;

    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => return,
            Ok(_) => {}
            Err(_) => return,
        }
        let request = line.trim();
        if request.is_empty() {
            continue;
        }
        seen += 1;
        if request.contains("wedged") {
            wedged = true;
        }

        match mode.as_str() {
            "stall" if seen > 1 => {
                eprintln!("testee #{seen}: holding the request back so the host has to time out");
                std::thread::sleep(std::time::Duration::from_secs(120));
                return;
            }
            "die" => {
                eprintln!("testee: exiting without an answer");
                std::io::stderr().flush().ok();
                std::process::exit(1);
            }
            "chatty" => {
                // Well past a 64 KiB pipe buffer: with no reader this would block the child
                // before it ever reached the answer, and the host's request would time out.
                for chunk in 0..64 {
                    eprintln!("testee: stderr line {chunk} — {}", "x".repeat(900));
                }
            }
            _ => {}
        }

        let echoed = re_echo(request);
        let frame_count = frame_count_of(request);
        // `request_id_of` already returns a quoted JSON string, so this interpolates with `{}`
        // — `{:?}` would wrap it a second time and the test would assert on `""xiranite-1""`.
        // `indexDir` is the child's own reading of the placement variable the host set, so a test
        // can prove the value crossed the process boundary instead of trusting that the setter ran.
        let index_dir = std::env::var("XIRANITE_FINDZ_INDEX_DIR").unwrap_or_default();
        // `pid` is the child's own report of who answered. A test that wants to know whether the
        // host talked to the *same* engine twice must not read that off the host's bookkeeping —
        // the whole point of checking is that the bookkeeping might be the thing that is wrong.
        // `libraryId` is echoed when the request carried one, because the holder starts the run's
        // library watch off `result.libraryId`: without it the watch path would be untestable here.
        let library_id = field_of(request, "libraryId").or_else(|| {
            let params = request.find("\"params\"").map(|at| &request[at..])?;
            field_of(params, "root").map(|root| format!("library-for-{root}"))
        });
        let library_field = match library_id {
            Some(id) => format!(",\"libraryId\":{:?}", id),
            None => String::new(),
        };
        // The stand-in answers a mutation the way `native/findz-go/scanner.go` does: `applyWatcherChanges`
        // only *enqueues* the batch and returns a task record, so a caller cannot treat the reply as
        // "the index is current" — it has to wait on that task. `waitsSeen` counts the `task.wait` frames
        // this child answered, which is how a host test proves the run's watch feed settled the task it
        // created instead of trusting the reply. Before this shape existed, the flush's ordering promise
        // was only ever visible to a hand-run probe against the real engine — which is how the gap got in.
        let (task_fields, waits_seen) = match field_of(request, "method").unwrap_or_default().as_str() {
            "task.wait" => {
                let seen = TASK_WAITS.fetch_add(1, Ordering::SeqCst) + 1;
                let id = field_of(request, "taskId").unwrap_or_default();
                let status = if wedged { "queued" } else { "completed" };
                (format!(",\"id\":{:?},\"status\":\"{status}\"", id), seen)
            }
            "watcher.apply_changes" | "scan.reconcile" | "scan.start" | "analysis.start" => (
                ",\"id\":\"task-echo-1\",\"status\":\"queued\"".to_string(),
                TASK_WAITS.load(Ordering::SeqCst),
            ),
            _ => (String::new(), TASK_WAITS.load(Ordering::SeqCst)),
        };
        let response = format!(
            r#"{{"ok":true,"requestId":{},"result":{{"saw":{},"frame":{},"indexDir":{:?},"pid":{}{}{},"waitsSeen":{}}}}}"#,
            request_id_of(request),
            echoed,
            frame_count,
            index_dir,
            std::process::id(),
            library_field,
            task_fields,
            waits_seen
        );
        if writeln!(out, "{response}").is_err() {
            return;
        }
        out.flush().ok();
    }
}

/// The `requestId` the request carried, as a JSON string, or `null`.
fn request_id_of(request: &str) -> String {
    match field_of(request, "requestId") {
        Some(value) => format!("\"{value}\""),
        None => "null".to_string(),
    }
}

/// The request document, re-emitted so the caller can compare it field by field.
///
/// Passed through as raw JSON text: parsing it here would make the testee a second authority on
/// the envelope, and the point of echoing is to show what the host actually wrote.
fn re_echo(request: &str) -> String {
    // Compact the whitespace so the response stays one line, which is what the host reads.
    request.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn frame_count_of(request: &str) -> u32 {
    request.matches('"').count() as u32
}

/// Reads one string field out of a flat JSON object without a parser.
///
/// Deliberately minimal: the testee must not become a JSON library, and every frame the tests
/// send puts the field it needs near the front.
fn field_of(json: &str, key: &str) -> Option<String> {
    let marker = format!("\"{key}\":\"");
    let start = json.find(&marker)? + marker.len();
    let rest = &json[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}
