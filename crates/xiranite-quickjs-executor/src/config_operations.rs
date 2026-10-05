//! The config store as a host service (ADR-0074 §1/§2, `docs/migration/…/quickjs-substrate-evaluation.md` §15.6/§15.8).
//!
//! ## Why the realm needs this at all
//!
//! `packages/config/src/node.ts` wrote the shared `xiranite.config.toml` through npm `proper-lockfile` and
//! `write-file-atomic`. Neither survives the realm: `graceful-fs` (pulled in by the lock) opens by assigning
//! properties onto the `fs` module, and the realm's `fs` shim has no writable properties, so a bundle that
//! reached the write path failed at load with `no setter for property` — measured on `linku` (§15.8), not
//! theorised. A cross-process lock is also exactly the kind of answer a sandbox must not give itself: the
//! witness lives on disk, and the host is the party that can be trusted to keep it honest.
//!
//! ## Why a service and not operations
//!
//! [`crate::host_services`] states the rule: the machine vocabulary is what `node:fs` needs and every node
//! may ask for; one document's lock protocol is a domain service. So the realm calls
//! `service.invoke { service: "config", method: "…" }` and the machine surface stays at the eleven `fs.*`
//! arms it already had.
//!
//! ## What the caller still owns
//!
//! Everything that is *meaning*: TOML parsing, the zod schema, the `[nodes.<id>]` merge, the hint text. The
//! host moves bytes and holds the lock, and never looks inside the document. That is what keeps one
//! implementation of the config semantics while there is exactly one implementation of the lock.
//!
//! ## The transaction token is a string, not a handle
//!
//! [`xiranite_core::config_store`] proves a holder by the content of the lock file, so `beginUpdate` can hand
//! the realm a plain string and `commitUpdate` can be answered by any later call — including after the realm
//! parked, or after the host restarted. No session table, therefore nothing to leak when a bundle forgets to
//! finish its transaction; a leftover lock is broken once it is older than the stale window.

use serde_json::{Value, json};
use std::sync::Arc;
use xiranite_core::config_store::{ConfigError, ConfigStore, LockPolicy};
use xiranite_core::filesystem::FileCapability;
use xiranite_core::support::SystemClock;
use xiranite_node_registry::NodeHost;

use crate::host_calls::{CallError, HostAnswer, answer, required_text};
use crate::machine::MachineAccess;

/// The methods this service answers. **The published set**, not a copy: `host_services` registers this
/// slice directly, so a method added to the dispatch below cannot be left out of the gate's list.
///
/// That drift was live for one revision — the table published five names while the dispatch answered
/// seven, and the realm's first `held` call was refused as unknown.
pub(crate) const METHODS: [&str; 7] = [
    "read",
    "exists",
    "writeAtomic",
    "beginUpdate",
    "commitUpdate",
    "abortUpdate",
    "held",
];

/// The default waiting budget. `retries: 50` with the same growth the TypeScript used, so a caller that
/// passes nothing gets the behaviour it had before the move.
const DEFAULT_RETRIES: u32 = 50;

/// Answers one `service.invoke` for `service: "config"`.
pub(crate) fn dispatch(
    method: &str,
    arguments: &Value,
    _host: &mut (dyn NodeHost + 'static),
    machine: &MachineAccess,
) -> Result<HostAnswer, CallError> {
    let files = machine.files("config service")?;
    let store = store_for(files, arguments)?;
    match method {
        "read" => {
            let path = required_text(arguments, "path")?;
            let contents = store.read(path).map_err(refusal)?;
            Ok(answer(json!({ "contents": contents })))
        }
        "exists" => {
            let path = required_text(arguments, "path")?;
            let exists = store.exists(path).map_err(refusal)?;
            Ok(answer(json!({ "exists": exists })))
        }
        "held" => {
            let path = required_text(arguments, "path")?;
            let token = required_text(arguments, "token")?;
            let held = store.held(path, token).map_err(refusal)?;
            Ok(answer(json!({ "held": held })))
        }
        "writeAtomic" => {
            let path = required_text(arguments, "path")?;
            let contents = required_contents(arguments)?;
            store.write_atomic(path, contents).map_err(refusal)?;
            Ok(answer(Value::Null))
        }
        "beginUpdate" => {
            let path = required_text(arguments, "path")?;
            let transaction = store.begin(path).map_err(refusal)?;
            Ok(answer(json!({
                "token": transaction.token,
                "resolvedPath": transaction.path,
                "contents": transaction.contents,
            })))
        }
        "commitUpdate" => {
            let path = required_text(arguments, "path")?;
            let token = required_text(arguments, "token")?;
            let contents = required_contents(arguments)?;
            store.commit(path, token, contents).map_err(refusal)?;
            Ok(answer(Value::Null))
        }
        "abortUpdate" => {
            let path = required_text(arguments, "path")?;
            let token = required_text(arguments, "token")?;
            store.abort(path, token).map_err(refusal)?;
            Ok(answer(Value::Null))
        }
        other => Err(CallError::Failure(format!(
            "the config service does not answer {other:?}; it answers: {}",
            METHODS.join(", ")
        ))),
    }
}

/// Builds the store over this run's grant, honouring the caller's waiting budget.
///
/// `retries` is validated by [`LockPolicy::validate`] inside the store, so a bundle asking for an unbounded
/// wait gets a refusal rather than a parked host thread — the ceiling has one owner, not one per layer.
fn store_for(files: &FileCapability, arguments: &Value) -> Result<ConfigStore, CallError> {
    let retries = match arguments.get("retries") {
        None | Some(Value::Null) => DEFAULT_RETRIES,
        Some(Value::Number(number)) => match number.as_u64() {
            Some(value) => u32::try_from(value).unwrap_or(u32::MAX),
            None => {
                return Err(CallError::Failure(
                    "config service: `retries` must be a non-negative integer".to_string(),
                ));
            }
        },
        Some(_) => {
            return Err(CallError::Failure("config service: `retries` must be a number".to_string()));
        }
    };
    Ok(ConfigStore::with_policy(
        files.clone(),
        Arc::new(SystemClock),
        LockPolicy { retries, ..LockPolicy::default() },
    ))
}

/// The document text argument. An empty string is a legitimate document, so this does not reuse
/// [`required_text`], which refuses blank input by design.
fn required_contents(arguments: &Value) -> Result<&str, CallError> {
    arguments
        .get("contents")
        .and_then(Value::as_str)
        .ok_or_else(|| CallError::Failure("config service needs a string `contents`".to_string()))
}

/// Turns a store refusal into the wire error. The code and message both ride along, matching the rule that
/// an error is data a bundle can branch on (`locked` vs `compromised` vs `permission_denied`).
fn refusal(error: ConfigError) -> CallError {
    CallError::Failure(format!("config service: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct TempDir {
        root: std::path::PathBuf,
    }

    impl TempDir {
        fn new(label: &str) -> Self {
            let built = std::env::temp_dir().join(format!(
                "xiranite-config-ops-{label}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .expect("clock ahead of epoch")
                    .as_nanos()
            ));
            std::fs::create_dir_all(&built).expect("fixture dir");
            Self { root: built.canonicalize().expect("canonical root") }
        }

        fn file(&self, name: &str) -> String {
            self.root.join(name).to_string_lossy().into_owned()
        }

        fn lock_of(&self, name: &str) -> std::path::PathBuf {
            xiranite_core::config_store::lock_path(&self.root.join(name))
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn granted(dir: &TempDir) -> MachineAccess {
        MachineAccess::granted(FileCapability::new([dir.root.as_path()]))
    }

    fn text(answer: &HostAnswer) -> String {
        let HostAnswer::Text(payload) = answer else {
            panic!("the config service only answers documents, got a byte channel");
        };
        payload.clone()
    }

    fn null_host() -> crate::test_host::CountingHost {
        crate::test_host::CountingHost::default()
    }

    #[test]
    fn a_seam_only_run_is_refused_by_naming_the_wiring() {
        let dir = TempDir::new("seam");
        let mut host = null_host();
        let error = dispatch(
            "read",
            &json!({ "path": dir.file("xiranite.config.toml") }),
            &mut host,
            &MachineAccess::seam_only(),
        )
        .expect_err("no grant means no config access");
        assert!(error.message().contains("config service"), "{}", error.message());
        assert!(error.message().contains("MachineAccess::granted"), "{}", error.message());
    }

    #[test]
    fn write_then_read_round_trips_and_leaves_no_lock() {
        let dir = TempDir::new("roundtrip");
        let path = dir.file("xiranite.config.toml");
        let machine = granted(&dir);
        let mut host = null_host();

        dispatch(
            "writeAtomic",
            &json!({ "path": path, "contents": "[nodes.trename]\nmode = \"scan\"\n" }),
            &mut host,
            &machine,
        )
        .expect("inside the grant this writes");

        let answer = dispatch("read", &json!({ "path": path }), &mut host, &machine).expect("read");
        let document: Value = serde_json::from_str(&text(&answer)).expect("read answers JSON");
        assert_eq!(document["contents"], "[nodes.trename]\nmode = \"scan\"\n");
        assert!(!dir.lock_of("xiranite.config.toml").exists(), "a finished write holds nothing");
    }

    #[test]
    fn an_unpublished_method_names_the_published_set() {
        let dir = TempDir::new("method");
        let machine = granted(&dir);
        let mut host = null_host();
        let error = dispatch("update", &json!({ "path": dir.file("a.toml") }), &mut host, &machine)
            .expect_err("there is no `update` method");
        assert!(error.message().contains("does not answer \"update\""), "{}", error.message());
        for method in METHODS {
            assert!(error.message().contains(method), "the refusal must list {method}");
        }
    }

    /// The whole point of moving the lock out of the realm: a commit whose lock is not on disk writes nothing.
    #[test]
    fn a_commit_without_its_lock_writes_nothing_and_says_why() {
        let dir = TempDir::new("compromised");
        let path = dir.file("xiranite.config.toml");
        std::fs::write(&path, "original\n").expect("seed");
        let machine = granted(&dir);
        let mut host = null_host();

        let error = dispatch(
            "commitUpdate",
            &json!({ "path": path, "token": "made-up-1", "contents": "late\n" }),
            &mut host,
            &machine,
        )
        .expect_err("a token with no lock behind it is not a holder");
        assert!(error.message().contains("compromised"), "{}", error.message());
        assert_eq!(std::fs::read_to_string(&path).expect("read"), "original\n", "refusal writes nothing");
    }

    #[test]
    fn a_transaction_spreads_across_separate_calls() {
        let dir = TempDir::new("transaction");
        let path = dir.file("xiranite.config.toml");
        std::fs::write(&path, "[app]\ntheme = \"dark\"\n").expect("seed");
        let machine = granted(&dir);
        let mut host = null_host();

        let begun = dispatch("beginUpdate", &json!({ "path": path }), &mut host, &machine).expect("begin");
        let document: Value = serde_json::from_str(&text(&begun)).expect("begin answers JSON");
        let token = document["token"].as_str().expect("a token").to_string();
        assert_eq!(document["contents"], "[app]\ntheme = \"dark\"\n", "begin reads under the lock");
        assert!(dir.lock_of("xiranite.config.toml").exists(), "the lock is held between calls");

        dispatch(
            "commitUpdate",
            &json!({ "path": path, "token": token, "contents": "[app]\ntheme = \"light\"\n" }),
            &mut host,
            &machine,
        )
        .expect("commit as holder");
        assert_eq!(
            std::fs::read_to_string(&path).expect("read"),
            "[app]\ntheme = \"light\"\n",
            "the realm's own merge landed"
        );
        assert!(!dir.lock_of("xiranite.config.toml").exists(), "commit released it");
    }

    /// The two primitives the realm's transport needs beyond read/write: existence, and the lock probe that
    /// lets a transaction stop instead of producing a lost update.
    #[test]
    fn exists_and_held_answer_both_ways() {
        let dir = TempDir::new("probe");
        let path = dir.file("xiranite.config.toml");
        let missing = dir.file("nowhere.toml");
        let machine = granted(&dir);
        let mut host = null_host();

        let answer = dispatch("exists", &json!({ "path": missing }), &mut host, &machine).expect("exists");
        assert_eq!(
            serde_json::from_str::<Value>(&text(&answer)).expect("JSON")["exists"],
            Value::Bool(false),
            "nothing is there yet"
        );

        dispatch(
            "writeAtomic",
            &json!({ "path": path, "contents": "seed\n" }),
            &mut host,
            &machine,
        )
        .expect("seed write");
        let answer = dispatch("exists", &json!({ "path": path }), &mut host, &machine).expect("exists");
        assert_eq!(
            serde_json::from_str::<Value>(&text(&answer)).expect("JSON")["exists"],
            Value::Bool(true),
            "the positive arm: after a write it exists"
        );

        let begun = dispatch("beginUpdate", &json!({ "path": path }), &mut host, &machine).expect("begin");
        let token = serde_json::from_str::<Value>(&text(&begun)).expect("JSON")["token"]
            .as_str()
            .expect("a token")
            .to_string();

        let answer = dispatch("held", &json!({ "path": path, "token": token }), &mut host, &machine).expect("held");
        assert_eq!(
            serde_json::from_str::<Value>(&text(&answer)).expect("JSON")["held"],
            Value::Bool(true),
            "the holder is held"
        );
        let answer =
            dispatch("held", &json!({ "path": path, "token": "not-the-holder" }), &mut host, &machine).expect("held");
        assert_eq!(
            serde_json::from_str::<Value>(&text(&answer)).expect("JSON")["held"],
            Value::Bool(false),
            "a stranger is not"
        );

        dispatch("abortUpdate", &json!({ "path": path, "token": token }), &mut host, &machine)
            .expect("abort releases it");
        let answer = dispatch("held", &json!({ "path": path, "token": token }), &mut host, &machine).expect("held");
        assert_eq!(
            serde_json::from_str::<Value>(&text(&answer)).expect("JSON")["held"],
            Value::Bool(false),
            "a spent token holds nothing"
        );
    }

    #[test]
    fn a_path_outside_the_grant_is_refused() {
        let inside = TempDir::new("grant-inside");
        let outside = TempDir::new("grant-outside");
        std::fs::write(outside.file("xiranite.config.toml"), "keep me\n").expect("seed outside");
        let machine = granted(&inside);
        let mut host = null_host();

        let error = dispatch(
            "writeAtomic",
            &json!({ "path": outside.file("xiranite.config.toml"), "contents": "overwritten\n" }),
            &mut host,
            &machine,
        )
        .expect_err("the config service does not get to write anywhere");
        assert!(error.message().contains("permission_denied"), "{}", error.message());
        assert_eq!(
            std::fs::read_to_string(outside.file("xiranite.config.toml")).expect("read"),
            "keep me\n",
            "a refusal must not have written"
        );
    }
}
