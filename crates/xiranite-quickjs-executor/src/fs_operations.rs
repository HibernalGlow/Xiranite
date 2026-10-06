//! The `fs.*` host operations, and the one place the granted [`FileCapability`] is reached from JS.
//!
//! [`crate::host_calls`] owns the vocabulary and the argument discipline; this file owns the file arms.
//! The split is the seam's own: everything here either goes through [`NodeHost`](xiranite_node_registry::NodeHost)
//! — the document pair, the listing, the move/delete family, and the lenient `stat` a refusal must read as
//! "missing" — or through the run's grant ([`MachineAccess::granted`]) for the primitives the seam has no
//! method for. Which arm answers which operation is stated per operation, because the difference is what a
//! `SeamOnly` run refuses.
//!
//! ## Bytes, the rule this file exists to keep
//!
//! `fs.readBytes` answers [`HostAnswer::Bytes`]: a `Uint8Array` on the JavaScript side, from Rust, through
//! [`crate::shims`]’s `__xrh.callBytes` or the pump's byte-shaped settle. `fs.writeBytes` takes its payload
//! the same way (`__xrh.sendBytes`). Nothing here encodes a buffer into the JSON document — the failure mode
//! ADR-0071 retired and AGENTS.md restates: base64 inside JSON doubles the memory of every binary file a
//! node touches and turns a byte offset into a string offset.
//!
//! ## The ceilings
//!
//! Two, and they come from `xiranite-core` rather than from numbers invented here:
//! [`MAX_TEXT_BYTES`](xiranite_core::filesystem::MAX_TEXT_BYTES) for the document pair and
//! [`MAX_BINARY_BYTES`](xiranite_core::filesystem::MAX_BINARY_BYTES) for a buffer. A node that wants more
//! asks for a range, which `fs.readBytes` answers.

use serde_json::{Value, json};
use xiranite_core::filesystem::{CopyOptions, FileCapability, FsCapabilityError};
use xiranite_node_registry::NodeHost;

use crate::host_calls::{CallError, HostAnswer, HostOperation, required_path, required_text, serialize};
use crate::machine::MachineAccess;

/// Runs one `fs.*` operation.
///
/// `payload` is the bytes a `writeBytes` call handed in; every other arm ignores it, and an arm that needs
/// it refuses when it is absent rather than writing an empty file.
pub(crate) fn execute(
    operation: HostOperation,
    arguments: &Value,
    payload: Option<&[u8]>,
    host: &mut (dyn NodeHost + 'static),
    machine: &MachineAccess,
) -> Result<HostAnswer, CallError> {
    match operation {
        HostOperation::Stat => stat(arguments, host, machine),
        HostOperation::List => match machine.capability() {
            // The grant arm reports the dirent kind a link has, which `NodeDirEntry` has no field for.
            Some(files) => Ok(text(list_with_grant(files, required_path(arguments)?)?)),
            None => list_via_host(arguments, host),
        },
        HostOperation::ReadText => {
            let path = required_path(arguments)?;
            // `None` (absent, unreadable or refused) crosses as JSON null, which is the `platform.ts`
            // answer the retained nodes' planners already branch on.
            let content = host.read_text(path).map_err(CallError::from_host)?;
            Ok(text(json!({ "path": path, "content": content })))
        }
        HostOperation::WriteText => {
            let path = required_path(arguments)?;
            let content = required_text(arguments, "content")?;
            host.write_text(path, content).map_err(CallError::from_host)?;
            Ok(text(json!({ "path": path, "written": true, "byteLength": content.len() })))
        }
        HostOperation::EnsureDir => {
            let path = required_path(arguments)?;
            host.ensure_dir(path).map_err(CallError::from_host)?;
            Ok(text(json!({ "path": path, "created": true })))
        }
        HostOperation::Move => {
            let source = required_text(arguments, "source")?;
            let target = required_text(arguments, "target")?;
            host.move_path(source, target).map_err(CallError::from_host)?;
            Ok(text(json!({ "source": source, "target": target, "moved": true })))
        }
        HostOperation::Delete => {
            let path = required_path(arguments)?;
            let recursive = flag(arguments, "recursive");
            host.delete_path(path, recursive).map_err(CallError::from_host)?;
            Ok(text(json!({ "path": path, "deleted": true, "recursive": recursive })))
        }
        HostOperation::Mkdtemp => {
            let prefix = required_text(arguments, "prefix")?;
            let created = grant(machine, operation)?.mkdtemp(prefix)?;
            Ok(text(json!({ "path": created, "created": true })))
        }
        HostOperation::Copy => {
            let source = required_text(arguments, "source")?;
            let target = required_text(arguments, "target")?;
            let options = CopyOptions {
                recursive: flag(arguments, "recursive"),
                force: flag_or(arguments, "force", true),
            };
            grant(machine, operation)?.copy(source, target, options)?;
            Ok(text(json!({
                "source": source,
                "target": target,
                "copied": true,
                "recursive": options.recursive,
            })))
        }
        HostOperation::AppendText => {
            let path = required_path(arguments)?;
            let content = required_text(arguments, "content")?;
            grant(machine, operation)?.append_text(path, content)?;
            Ok(text(json!({ "path": path, "appended": true, "byteLength": content.len() })))
        }
        HostOperation::Utimes => {
            let path = required_path(arguments)?;
            let (atime_ms, mtime_ms) = time_pair(arguments)?;
            grant(machine, operation)?.set_times(path, atime_ms, mtime_ms)?;
            Ok(text(json!({ "path": path, "atimeMs": atime_ms, "mtimeMs": mtime_ms, "set": true })))
        }
        HostOperation::ReadBytes => {
            let path = required_path(arguments)?;
            let offset = argument_u64(arguments, "offset");
            let length = argument_u64(arguments, "length");
            match grant(machine, operation)?.read_bytes(path, offset, length) {
                // `None` stays `None`: an absent file is a `null` in the realm, which is what lets the
                // shim throw the ENOENT Node would have thrown instead of handing back a zero-length buffer.
                Ok(bytes) => Ok(HostAnswer::Bytes(bytes)),
                // The same leniency `read_text` documents: a path the grant will not open answers "no
                // document here" rather than failing the run, so a mis-set root reads as an empty folder and
                // a node's own `catch` behaves the way it did under `platform.ts`.
                Err(FsCapabilityError::PermissionDenied) | Err(FsCapabilityError::NotFound) => {
                    Ok(HostAnswer::Bytes(None))
                }
                Err(error) => Err(CallError::from_core(error)),
            }
        }
        HostOperation::WriteBytes => {
            let path = required_path(arguments)?;
            let append = flag(arguments, "append");
            let bytes = payload.ok_or_else(|| {
                CallError::Failure(String::from(
                    "fs.writeBytes needs a byte payload; call it through __xrh.sendBytes(op, args, bytes)",
                ))
            })?;
            grant(machine, operation)?.write_bytes(path, bytes, append)?;
            Ok(text(json!({
                "path": path,
                "written": true,
                "byteLength": bytes.len(),
                "append": append,
            })))
        }
        HostOperation::Link => {
            let source = required_text(arguments, "source")?;
            let target = required_text(arguments, "target")?;
            grant(machine, operation)?.link(source, target)?;
            Ok(text(json!({ "source": source, "target": target, "linked": true })))
        }
        HostOperation::Symlink => {
            let target = required_text(arguments, "target")?;
            let path = required_path(arguments)?;
            let link_type = arguments.get("type").and_then(Value::as_str).unwrap_or("file");
            if link_type == "junction" {
                // A Windows reparse point that `std` cannot create on any target, so it is refused here
                // instead of quietly making a file link the node will believe is a junction.
                return Err(CallError::Failure(String::from(
                    "fs.symlink type \"junction\" is not answerable by the host filesystem; use \"dir\" or \"file\"",
                )));
            }
            grant(machine, operation)?.symlink(target, path, link_type == "dir")?;
            Ok(text(json!({ "target": target, "path": path, "linked": true, "type": link_type })))
        }
        HostOperation::Readlink => {
            let path = required_path(arguments)?;
            let stored = grant(machine, operation)?.read_link(path)?;
            Ok(text(json!({ "path": path, "target": stored })))
        }
        HostOperation::Realpath => {
            let path = required_path(arguments)?;
            let real = grant(machine, operation)?.real_path(path)?;
            Ok(text(json!({ "path": path, "realPath": real })))
        }
        // Not a file arm; `host_calls::execute` routes these elsewhere.
        HostOperation::ProcExec
        | HostOperation::ProcSpawn
        | HostOperation::ProcPoll
        | HostOperation::ProcWait
        | HostOperation::ProcKill
        | HostOperation::ClockNow
        | HostOperation::ClockSleep
        | HostOperation::RandomUuid
        | HostOperation::RandomBytes
        | HostOperation::Digest
        | HostOperation::OsTmpdir
        | HostOperation::OsHomedir
        | HostOperation::OsCpus
        | HostOperation::ServiceInvoke => Err(CallError::Failure(format!(
            "{} is not a filesystem operation",
            operation.as_str()
        ))),
    }
}

/// `fs.stat`, in the two arms the machine access makes available.
///
/// With a grant the answer is `xiranite-core`'s own [`PathInfo`](xiranite_core::filesystem::PathInfo):
/// kind, size and both times, one metadata read. Without one, the seam's `stat` answers kind and the three
/// byte/time fields go `null` — the same shape `fs.readText` uses for "no document", so a bundle can tell
/// "the host did not say" from "the file is 0 bytes long".
fn stat(
    arguments: &Value,
    host: &mut (dyn NodeHost + 'static),
    machine: &MachineAccess,
) -> Result<HostAnswer, CallError> {
    let path = required_path(arguments)?;
    let follow = flag_or(arguments, "follow", true);
    if let Some(files) = machine.capability() {
        // The same leniency the seam documents: a path outside the grant, unreadable or gone answers
        // `exists: false` rather than failing, because that is what `platform.ts:76`'s `catch` did and what
        // the retained planners branch on. `MachineAccess` cannot log the refusal the way
        // `xiranite-native-host` does, which is the price of that rule and is why the arm is here once
        // rather than in every caller.
        let info = files.stat_at(path, follow).unwrap_or_else(|_| missing_stat(path));
        return Ok(text(json!({
            "path": info.path,
            "exists": info.exists,
            "isFile": info.is_file,
            "isDirectory": info.is_directory,
            "isSymlink": info.is_symlink,
            "sizeBytes": info.size_bytes,
            "mtimeMs": info.mtime_ms,
            "atimeMs": info.atime_ms,
        })));
    }
    let info = host.stat(path).map_err(CallError::from_host)?;
    Ok(text(json!({
        "path": info.path,
        "exists": info.exists,
        "isFile": info.is_file,
        "isDirectory": info.is_directory,
        "isSymlink": Value::Null,
        "sizeBytes": Value::Null,
        "mtimeMs": Value::Null,
        "atimeMs": Value::Null,
        "reason": "the seam-only arm answers kind only; see MachineAccess",
    })))
}

/// `fs.list` through the seam, for a run that has no grant.
fn list_via_host(arguments: &Value, host: &mut (dyn NodeHost + 'static)) -> Result<HostAnswer, CallError> {
    let path = required_path(arguments)?;
    let entries = host.list_dir(path).map_err(CallError::from_host)?;
    let mapped: Vec<Value> = entries
        .iter()
        .map(|entry| {
            json!({
                "name": entry.name,
                "path": entry.path,
                "isFile": entry.is_file,
                "isDirectory": entry.is_directory,
            })
        })
        .collect();
    Ok(text(json!({ "entries": mapped })))
}

/// The wide listing, from the grant: same entries plus `isSymlink`, which is what
/// `readdir(withFileTypes)` means to `linku` and free off the dirent `FileCapability::list` already read.
fn list_with_grant(files: &FileCapability, raw: &str) -> Result<Value, CallError> {
    let entries = files.list(raw).map_err(CallError::from_core)?;
    let mapped: Vec<Value> = entries
        .iter()
        .map(|entry| {
            json!({
                "name": entry.name,
                "path": entry.path,
                "isFile": entry.is_file,
                "isDirectory": entry.is_directory,
                "isSymlink": entry.is_symlink,
            })
        })
        .collect();
    Ok(json!({ "entries": mapped }))
}

/// A `PathInfo` for "nothing you may see", shaped like the core's own missing answer.
fn missing_stat(path: &str) -> xiranite_core::filesystem::PathInfo {
    xiranite_core::filesystem::PathInfo {
        path: path.to_string(),
        exists: false,
        is_file: false,
        is_directory: false,
        is_symlink: false,
        size_bytes: 0,
        atime_ms: 0,
        mtime_ms: 0,
    }
}

/// The grant, or the named refusal that says which wiring would supply it.
fn grant(machine: &MachineAccess, operation: HostOperation) -> Result<&FileCapability, CallError> {
    machine.capability().ok_or_else(|| CallError::Failure(format!(
        "{} needs the operation's granted filesystem, and this run was started with the NodeHost \
         seam alone. Build it with MachineAccess::granted(..) / Executor::with_files(..).",
        operation.as_str()
    )))
}

/// The `atimeMs`/`mtimeMs` pair `fs.utimes` needs, in the order Node's `utimes(path, atime, mtime)` uses.
fn time_pair(arguments: &Value) -> Result<(u64, u64), CallError> {
    let atime = argument_u64(arguments, "atimeMs").ok_or_else(|| {
        CallError::Failure("fs.utimes needs a number `atimeMs`".to_string())
    })?;
    let mtime = argument_u64(arguments, "mtimeMs").ok_or_else(|| {
        CallError::Failure("fs.utimes needs a number `mtimeMs`".to_string())
    })?;
    Ok((atime, mtime))
}

fn argument_u64(arguments: &Value, key: &str) -> Option<u64> {
    arguments.get(key).and_then(Value::as_u64)
}

fn flag(arguments: &Value, key: &str) -> bool {
    arguments.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn flag_or(arguments: &Value, key: &str, fallback: bool) -> bool {
    arguments.get(key).and_then(Value::as_bool).unwrap_or(fallback)
}

fn text(value: Value) -> HostAnswer {
    HostAnswer::Text(serialize(&value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host_calls::HostOperation;
    use crate::test_host::CountingHost;
    use serde_json::Value;

    /// A grant over a directory of this crate's own, so `/tmp` vanishing mid-session cannot turn a
    /// filesystem assertion into a phantom failure.
    struct Temp {
        path: std::path::PathBuf,
    }

    /// Makes every fixture root in this process distinct.
    static SUPERSEQUENCE: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

    impl Temp {
        /// A root unique per call, not just per tag.
        ///
        /// The tag is only the *name* of a case; two cases can legitimately use the same tag, and the
        /// escape test creates a sibling directory outside its own root under the same pid. With a
        /// pid-only name, `Temp::new("outside")` and that sibling were the *same* path, so one test's
        /// `Drop` deleted the other's secret while it was still being read — an intermittent failure of
        /// the test that guards the grant.
        fn new(tag: &str) -> Self {
            let unique = SUPERSEQUENCE.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let path = std::env::temp_dir()
                .join(format!("xiranite-fs-ops-{tag}-{}-{unique}", std::process::id()));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).expect("temp root");
            Self { path: std::fs::canonicalize(path).expect("canonical root") }
        }

        fn child(&self, name: &str) -> String {
            self.path.join(name).to_string_lossy().into_owned()
        }
    }

    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn run(operation: HostOperation, arguments: &str, machine: &MachineAccess) -> Result<String, CallError> {
        let parsed: Value = serde_json::from_str(arguments).expect("test arguments are JSON");
        let mut host = CountingHost::new();
        execute(operation, &parsed, None, &mut host, machine).map(|answer| match answer {
            HostAnswer::Text(text) => text,
            HostAnswer::Bytes(_) => panic!("this arm answers bytes, the test asked for text"),
        })
    }

    fn answer(operation: HostOperation, arguments: &str, machine: &MachineAccess) -> String {
        run(operation, arguments, machine).unwrap_or_else(|error| {
            panic!("{} refused: {}", operation.as_str(), error.message())
        })
    }

    #[test]
    fn a_granted_stat_answers_size_and_both_times_from_one_read() {
        let temp = Temp::new("stat");
        std::fs::write(temp.path.join("a.txt"), "12345").expect("fixture");
        let machine = MachineAccess::granted(FileCapability::new([temp.path.as_path()]));
        let value: Value =
            serde_json::from_str(&answer(HostOperation::Stat, &json!({ "path": temp.child("a.txt") }).to_string(), &machine))
                .expect("stat is JSON");
        assert_eq!(value["exists"], true);
        assert_eq!(value["isFile"], true);
        assert_eq!(value["sizeBytes"], 5, "the field the bundles proved necessary: {value}");
        assert!(
            value["mtimeMs"].as_u64().is_some_and(|ms| ms > 1_700_000_000_000),
            "a real modification time, not a 0: {value}"
        );
        assert!(value["atimeMs"].is_number(), "{value}");
        assert_eq!(value["path"], temp.child("a.txt"), "the caller's spelling survives");
    }

    #[test]
    fn a_path_outside_the_grant_reads_as_missing_and_not_as_a_failure() {
        let temp = Temp::new("outside");
        let machine = MachineAccess::granted(FileCapability::new([temp.path.as_path()]));
        let value: Value = serde_json::from_str(
            &answer(HostOperation::Stat, r#"{"path":"/definitely/not/granted/x.txt"}"#, &machine),
        )
        .expect("stat is JSON");
        assert_eq!(value["exists"], false, "the documented leniency arm");
        // Positive control: the same call on a granted path answers `exists: true`.
        std::fs::write(temp.path.join("here.txt"), "x").expect("fixture");
        let inside: Value = serde_json::from_str(
            &answer(HostOperation::Stat, &json!({ "path": temp.child("here.txt") }).to_string(), &machine),
        )
        .expect("stat is JSON");
        assert_eq!(inside["exists"], true);
    }

    #[test]
    fn a_seam_only_stat_reports_kind_and_leaves_the_bytes_it_cannot_know_null() {
        let machine = MachineAccess::seam_only();
        let value: Value = serde_json::from_str(
            &answer(HostOperation::Stat, r#"{"path":"/work/a.txt"}"#, &machine),
        )
        .expect("stat is JSON");
        assert_eq!(value["exists"], true, "CountingHost answers every path");
        assert!(value["sizeBytes"].is_null(), "the seam cannot know it: {value}");
        assert!(value["mtimeMs"].is_null());
        assert!(value["reason"].is_string(), "and says why in the answer");
    }

    #[test]
    fn mkdtemp_creates_a_directory_inside_the_grant_and_refuses_outside_it() {
        let temp = Temp::new("mkdtemp");
        let machine = MachineAccess::granted(FileCapability::new([temp.path.as_path()]));
        let prefix = temp.child("run-");
        let value: Value = serde_json::from_str(
            &answer(HostOperation::Mkdtemp, &json!({ "prefix": prefix }).to_string(), &machine),
        )
        .expect("mkdtemp is JSON");
        let created = std::path::PathBuf::from(value["path"].as_str().expect("a path"));
        assert!(created.is_dir(), "{created:?} was not created");
        let name = created.file_name().expect("a leaf").to_string_lossy().into_owned();
        assert!(name.starts_with("run-") && name.len() == "run-".len() + 6, "suffix shape: {name}");

        let refused = run(HostOperation::Mkdtemp, r#"{"prefix":"/definitely/not/granted/t-"}"#, &machine);
        assert!(refused.is_err(), "a temp dir outside the grant is a refusal, not a created directory");
    }

    #[test]
    fn two_mkdtemp_calls_at_the_same_prefix_answer_two_different_directories() {
        let temp = Temp::new("mkdtemp-race");
        let machine = MachineAccess::granted(FileCapability::new([temp.path.as_path()]));
        let prefix = temp.child("same-");
        let first = serde_json::from_str::<Value>(&answer(
            HostOperation::Mkdtemp,
            &json!({ "prefix": prefix }).to_string(),
            &machine,
        ))
        .expect("json");
        let second = serde_json::from_str::<Value>(&answer(
            HostOperation::Mkdtemp,
            &json!({ "prefix": prefix }).to_string(),
            &machine,
        ))
        .expect("json");
        assert_ne!(first["path"], second["path"], "the suffix must not repeat within a run");
    }

    #[test]
    fn copy_moves_bytes_and_refuses_a_directory_without_recursive() {
        let temp = Temp::new("copy");
        std::fs::write(temp.path.join("source.txt"), "payload").expect("fixture");
        let machine = MachineAccess::granted(FileCapability::new([temp.path.as_path()]));
        let arguments = json!({ "source": temp.child("source.txt"), "target": temp.child("copy.txt") });
        answer(HostOperation::Copy, &arguments.to_string(), &machine);
        assert_eq!(std::fs::read_to_string(temp.child("copy.txt")).expect("copy"), "payload");
        assert!(std::fs::symlink_metadata(temp.child("source.txt")).is_ok(), "copy keeps the source");

        std::fs::create_dir(temp.child("tree")).expect("tree");
        let directory = json!({ "source": temp.child("tree"), "target": temp.child("tree2") });
        let error = run(HostOperation::Copy, &directory.to_string(), &machine)
            .expect_err("a directory needs recursive");
        assert!(error.message().contains("recursive"), "{}", error.message());
        answer(
            HostOperation::Copy,
            &json!({ "source": temp.child("tree"), "target": temp.child("tree2"), "recursive": true }).to_string(),
            &machine,
        );
        assert!(temp.child("tree2").ends_with("tree2") && std::fs::metadata(temp.child("tree2")).is_ok());
    }

    #[test]
    fn append_text_adds_to_a_document_instead_of_replacing_it() {
        let temp = Temp::new("append");
        std::fs::write(temp.path.join("journal.jsonl"), "{\"line\":1}\n").expect("fixture");
        let machine = MachineAccess::granted(FileCapability::new([temp.path.as_path()]));
        answer(
            HostOperation::AppendText,
            &json!({ "path": temp.child("journal.jsonl"), "content": "{\"line\":2}\n" }).to_string(),
            &machine,
        );
        assert_eq!(
            std::fs::read_to_string(temp.child("journal.jsonl")).expect("append"),
            "{\"line\":1}\n{\"line\":2}\n",
            "the undo-history writer's whole requirement"
        );
    }

    #[test]
    fn read_bytes_gives_the_buffer_a_range_and_absent_reads_as_none() {
        let temp = Temp::new("read-bytes");
        std::fs::write(temp.path.join("blob.bin"), [0u8, 1, 2, 3, 4, 5, 6, 7]).expect("fixture");
        let machine = MachineAccess::granted(FileCapability::new([temp.path.as_path()]));
        let mut host = CountingHost::new();
        let whole = execute(
            HostOperation::ReadBytes,
            &json!({ "path": temp.child("blob.bin") }),
            None,
            &mut host,
            &machine,
        )
        .expect("read");
        match whole {
            HostAnswer::Bytes(Some(bytes)) => assert_eq!(bytes, vec![0u8, 1, 2, 3, 4, 5, 6, 7]),
            other => panic!("a byte answer was expected, got {other:?}"),
        }
        let ranged = execute(
            HostOperation::ReadBytes,
            &json!({ "path": temp.child("blob.bin"), "offset": 2, "length": 3 }),
            None,
            &mut host,
            &machine,
        )
        .expect("range read");
        match ranged {
            HostAnswer::Bytes(Some(bytes)) => assert_eq!(bytes, vec![2, 3, 4], "offset/length are host-side"),
            other => panic!("expected bytes, got {other:?}"),
        }
        let absent = execute(
            HostOperation::ReadBytes,
            &json!({ "path": temp.child("nope.bin") }),
            None,
            &mut host,
            &machine,
        )
        .expect("an absent file is not a failure");
        assert!(matches!(absent, HostAnswer::Bytes(None)), "null is the realm's ENOENT signal");
    }

    #[test]
    fn write_bytes_takes_the_payload_out_of_band_and_append_extends_it() {
        let temp = Temp::new("write-bytes");
        let machine = MachineAccess::granted(FileCapability::new([temp.path.as_path()]));
        let mut host = CountingHost::new();
        let arguments = json!({ "path": temp.child("out.bin") });
        execute(
            HostOperation::WriteBytes,
            &arguments,
            Some(&[9u8, 8, 7]),
            &mut host,
            &machine,
        )
        .expect("write");
        assert_eq!(std::fs::read(temp.child("out.bin")).expect("read back"), vec![9, 8, 7]);
        execute(
            HostOperation::WriteBytes,
            &json!({ "path": temp.child("out.bin"), "append": true }),
            Some(&[6]),
            &mut host,
            &machine,
        )
        .expect("append write");
        assert_eq!(std::fs::read(temp.child("out.bin")).expect("read back"), vec![9, 8, 7, 6]);

        // The refusal arm the shim depends on: no payload is not an empty file.
        let missing = execute(HostOperation::WriteBytes, &arguments, None, &mut host, &machine)
            .expect_err("a writeBytes without a payload is a bug in the caller");
        assert!(missing.message().contains("sendBytes"), "{}", missing.message());
    }

    #[cfg(unix)]
    #[test]
    fn the_link_family_answers_what_linku_asks_for() {
        let temp = Temp::new("links");
        std::fs::write(temp.path.join("target.txt"), "linked bytes").expect("fixture");
        let machine = MachineAccess::granted(FileCapability::new([temp.path.as_path()]));
        answer(
            HostOperation::Link,
            &json!({ "source": temp.child("target.txt"), "target": temp.child("hard.txt") }).to_string(),
            &machine,
        );
        assert_eq!(std::fs::read_to_string(temp.child("hard.txt")).expect("hard link"), "linked bytes");

        answer(
            HostOperation::Symlink,
            &json!({ "target": temp.child("target.txt"), "path": temp.child("soft.txt") }).to_string(),
            &machine,
        );
        let read = answer(HostOperation::Readlink, &json!({ "path": temp.child("soft.txt") }).to_string(), &machine);
        let value: Value = serde_json::from_str(&read).expect("json");
        assert_eq!(value["target"], temp.child("target.txt"), "the stored text, verbatim");

        let real = answer(HostOperation::Realpath, &json!({ "path": temp.child("soft.txt") }).to_string(), &machine);
        let value: Value = serde_json::from_str(&real).expect("json");
        assert_eq!(value["realPath"], temp.child("target.txt"), "and the followed path");

        // A junction is refused rather than faked as a file link.
        let refused = run(
            HostOperation::Symlink,
            &json!({ "target": temp.child("target.txt"), "path": temp.child("j"), "type": "junction" }).to_string(),
            &machine,
        )
        .expect_err("a reparse point is not answerable");
        assert!(refused.message().contains("junction"), "{}", refused.message());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_that_points_out_of_the_grant_is_not_a_second_door() {
        let temp = Temp::new("escape");
        let outside = std::env::temp_dir().join(format!("xiranite-fs-ops-escape-outside-{}", std::process::id()));
        std::fs::create_dir_all(&outside).expect("outside root");
        std::fs::write(&outside, "not yours").ok();
        let secret = outside.join("secret.txt");
        std::fs::write(&secret, "not yours").expect("secret");
        std::os::unix::fs::symlink(&secret, temp.path.join("innocent.bin")).expect("fixture link");

        let machine = MachineAccess::granted(FileCapability::new([temp.path.as_path()]));
        let mut host = CountingHost::new();
        let answer = execute(
            HostOperation::ReadBytes,
            &json!({ "path": temp.child("innocent.bin") }),
            None,
            &mut host,
            &machine,
        )
        .expect("the read is answered, not thrown");
        match answer {
            HostAnswer::Bytes(None) => {} // refused/absent: the grant said no, so the realm sees no file
            HostAnswer::Bytes(Some(bytes)) => panic!(
                "a link out of the grant leaked {} bytes; resolve_open did not hold",
                bytes.len()
            ),
            HostAnswer::Text(_) => panic!("a byte operation answered text"),
        }
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn utimes_restores_the_pair_a_node_read_out_of_stat() {
        let temp = Temp::new("utimes");
        std::fs::write(temp.child("a.txt"), "x").expect("fixture");
        let machine = MachineAccess::granted(FileCapability::new([temp.path.as_path()]));
        // The times a node would have read from `fs.stat`: 2001-09-09 in both fields.
        let atime = 1_000_000_000_000_u64;
        let mtime = 1_000_000_000_500_u64;
        answer(
            HostOperation::Utimes,
            &json!({ "path": temp.child("a.txt"), "atimeMs": atime, "mtimeMs": mtime }).to_string(),
            &machine,
        );
        let value: Value = serde_json::from_str(
            &answer(HostOperation::Stat, &json!({ "path": temp.child("a.txt") }).to_string(), &machine),
        )
        .expect("json");
        assert_eq!(value["mtimeMs"], mtime, "the round trip is the whole point: {value}");
        assert_eq!(value["atimeMs"], atime, "{value}");
    }

    #[test]
    fn a_wide_operation_without_a_grant_names_the_wiring_instead_of_answering_wrong() {
        let machine = MachineAccess::seam_only();
        for operation in [
            HostOperation::Mkdtemp,
            HostOperation::Copy,
            HostOperation::AppendText,
            HostOperation::Utimes,
            HostOperation::ReadBytes,
            HostOperation::Link,
            HostOperation::Realpath,
        ] {
            let error = run(operation, r#"{"path":"/work/a","prefix":"/work/t","target":"/work/a","source":"/work/a","content":"x","atimeMs":1,"mtimeMs":2}"#, &machine)
                .expect_err(&format!("{} must refuse", operation.as_str()));
            assert!(
                error.message().contains("granted filesystem"),
                "{} said: {}",
                operation.as_str(),
                error.message()
            );
        }
    }

    #[test]
    fn a_missing_argument_is_a_refusal_before_the_machine_is_touched() {
        let temp = Temp::new("bad-arguments");
        let machine = MachineAccess::granted(FileCapability::new([temp.path.as_path()]));
        for (operation, arguments) in [
            (HostOperation::Mkdtemp, "{}"),
            (HostOperation::Copy, r#"{"source":"/work/a"}"#),
            (HostOperation::AppendText, r#"{"path":"/work/a"}"#),
            (HostOperation::Utimes, r#"{"path":"/work/a","atimeMs":1}"#),
            (HostOperation::Symlink, r#"{"path":"/work/a"}"#),
        ] {
            let error = run(operation, arguments, &machine)
                .expect_err(&format!("{} must refuse", operation.as_str()));
            assert!(!error.message().is_empty());
        }
        // The mkdtemp refusal must not have made a directory anywhere.
        assert!(std::fs::read_dir(&temp.path).expect("empty").next().is_none(), "a refusal touched the machine");
    }
}
