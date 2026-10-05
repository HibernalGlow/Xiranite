//! The locked, durable write of host-owned documents (`crates/xiranite-core/src/config_store.rs`).
//!
//! Every guard here has the pair that proves the guard is what stops it: a write on the same path that must
//! succeed, or a lock that must *not* be broken. A lock implementation that refuses everything passes the
//! refusal assertions and is useless, so the positive arms are not optional.

use std::path::PathBuf;
use std::sync::Arc;

use xiranite_core::config_store::{
    ConfigError, ConfigStore, LockPolicy, Transaction, lock_path,
};
use xiranite_core::filesystem::FileCapability;
use xiranite_core::support::{Clock, ManualClock, SystemClock};

struct TempRoot {
    root: PathBuf,
}

impl TempRoot {
    fn new(label: &str) -> Self {
        let built = std::env::temp_dir().join(format!(
            "xiranite-config-store-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock ahead of epoch")
                .as_nanos()
        ));
        std::fs::create_dir_all(&built).expect("fixture dir");
        // macOS keeps the temp tree behind a symlink (`/var` → `/private/var`), and the store reports the
        // canonical path it resolved. Comparing a literal `/var/...` against it would fail on the spelling
        // of the path while the guard under test behaved correctly, so the fixture canonicalizes too.
        let root = built.canonicalize().expect("canonical fixture root");
        Self { root }
    }

    fn path(&self) -> String {
        self.root.to_string_lossy().into_owned()
    }

    fn file(&self, name: &str) -> String {
        self.root.join(name).to_string_lossy().into_owned()
    }

    /// The directory listing as names, so "no temp or lock left behind" is checked against the disk.
    fn names(&self) -> Vec<String> {
        let mut entries: Vec<String> = std::fs::read_dir(&self.root)
            .expect("read fixture dir")
            .map(|entry| entry.expect("entry").file_name().to_string_lossy().into_owned())
            .collect();
        entries.sort();
        entries
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn store_in(root: &TempRoot) -> ConfigStore {
    ConfigStore::new(FileCapability::new([std::path::Path::new(&root.path())]), Arc::new(SystemClock))
}

fn store_with_clock(root: &TempRoot, clock: Arc<ManualClock>, policy: LockPolicy) -> ConfigStore {
    ConfigStore::with_policy(
        FileCapability::new([std::path::Path::new(&root.path())]),
        clock,
        policy,
    )
}

fn epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock ahead of epoch")
        .as_millis()
        .try_into()
        .expect("epoch millis fits u64")
}

/// A foreign holder's lock, written the way a second process would write it.
fn plant_lock(target: &str, token: &str) -> PathBuf {
    let lock = lock_path(std::path::Path::new(target));
    std::fs::write(&lock, token).expect("plant lock");
    lock
}

#[test]
fn a_replaced_document_leaves_no_temp_file_and_no_lock_behind() {
    let root = TempRoot::new("replace");
    let config = root.file("xiranite.config.toml");
    let store = store_in(&root);

    store
        .write_atomic(&config, "[nodes.trename]\nmode = \"scan\"\n")
        .expect("first write into a fresh directory");
    store.write_atomic(&config, "[nodes.trename]\nmode = \"plan\"\n").expect("second write");

    assert_eq!(
        store.read(&config).expect("read").as_deref(),
        Some("[nodes.trename]\nmode = \"plan\"\n"),
        "the replace must land"
    );
    assert_eq!(root.names(), vec!["xiranite.config.toml".to_string()], "only the document remains");
}

/// The crux pair: a live lock blocks, a leftover lock from a dead holder does not.
#[test]
fn a_fresh_lock_blocks_a_second_writer_while_a_stale_one_is_broken() {
    let root = TempRoot::new("stale");
    let config = root.file("xiranite.config.toml");
    std::fs::write(&config, "before\n").expect("seed document");
    let policy = LockPolicy { stale_ms: 30_000, retries: 0, ..LockPolicy::default() };

    // The clock starts at the lock's own mtime, not at "now" read before the file was written: the
    // difference between those two is milliseconds, and an assertion one millisecond past the window would
    // otherwise be decided by fixture timing rather than by the stale rule.
    let lock = plant_lock(&config, "999999-1");
    let clock = Arc::new(ManualClock::new(mtime_ms(&lock)));
    let store = store_with_clock(&root, Arc::clone(&clock), policy);

    // Arm one: a lock created now is somebody's, and breaking it would be a double write.
    let error = store
        .write_atomic(&config, "after\n")
        .expect_err("a fresh lock must hold the writer out");
    assert_eq!(error, ConfigError::Locked { path: config.clone() }, "{error}");
    assert_eq!(std::fs::read_to_string(&config).expect("read"), "before\n", "a refusal writes nothing");
    assert!(lock.exists(), "a blocked caller must leave the holder's lock alone");

    // Arm two: the same lock, aged exactly to the stale window, is crash residue and must be broken.
    clock.advance(policy.stale_ms);
    store
        .write_atomic(&config, "after\n")
        .expect("a lock at the stale window belongs to nobody");
    assert_eq!(std::fs::read_to_string(&config).expect("read"), "after\n");
    assert!(!lock.exists(), "the broken lock is gone, not left behind for the next caller");
}

/// One path's modification time in epoch milliseconds.
fn mtime_ms(path: &std::path::Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .expect("the lock has a modification time")
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock ahead of epoch")
        .as_millis()
        .try_into()
        .expect("epoch millis fits u64")
}

#[test]
fn a_lock_stolen_mid_transaction_refuses_the_write_and_survives_it() {
    let root = TempRoot::new("compromised");
    let config = root.file("xiranite.config.toml");
    std::fs::write(&config, "original\n").expect("seed document");
    let store = store_in(&root);

    let Transaction { token, .. } = store.begin(&config).expect("begin holds the lock");
    store.commit(&config, &token, "committed\n").expect("the holder's commit lands");
    assert_eq!(std::fs::read_to_string(&config).expect("read"), "committed\n", "the replace lands");

    // Now the failure arm, on a second transaction whose lock is taken from under it.
    let Transaction { token, .. } = store.begin(&config).expect("begin again");
    let lock = plant_lock(&config, "888888-1");
    let error = store
        .commit(&config, &token, "late\n")
        .expect_err("a stolen lock must stop the write");
    assert_eq!(error, ConfigError::Compromised { path: config.clone() }, "{error}");
    assert_eq!(
        std::fs::read_to_string(&config).expect("read"),
        "committed\n",
        "nothing may be written once the lock is not ours"
    );
    assert_eq!(std::fs::read_to_string(&lock).expect("read lock"), "888888-1", "we do not delete theirs");
}

/// The token is proven by what is on disk, not by host memory: a made-up token writes nothing, and a token
/// stops working the moment its lock is gone.
#[test]
fn a_token_only_writes_while_its_lock_is_on_disk() {
    let root = TempRoot::new("tokens");
    let config = root.file("xiranite.config.toml");
    std::fs::write(&config, "original\n").expect("seed document");
    let store = store_in(&root);

    assert_eq!(
        store.commit(&config, "someone-elses-token", "late\n").map_err(|error| error.code()),
        Err("compromised"),
        "a token with no matching lock file cannot write"
    );
    assert_eq!(std::fs::read_to_string(&config).expect("read"), "original\n", "a refusal writes nothing");

    let Transaction { token, contents, .. } = store.begin(&config).expect("begin");
    assert_eq!(contents.as_deref(), Some("original\n"), "begin reads under the lock");
    store.abort(&config, &token).expect("abort releases what this holder owns");
    assert_eq!(std::fs::read_to_string(&config).expect("read"), "original\n", "abort leaves the document");
    assert_eq!(root.names(), vec!["xiranite.config.toml".to_string()], "abort leaves no lock");
    assert_eq!(
        store.commit(&config, &token, "late\n").map_err(|error| error.code()),
        Err("compromised"),
        "a spent token is not a licence to write again"
    );
    assert_eq!(std::fs::read_to_string(&config).expect("read"), "original\n");
    // Aborting a transaction whose lock is already gone is success: there is nothing left to release.
    store.abort(&config, &token).expect("a second abort is a no-op, not an error");
}

#[test]
fn a_path_outside_the_grant_is_refused_and_writes_nothing() {
    let root = TempRoot::new("grant");
    let outside = TempRoot::new("grant-outside");
    let escape = outside.file("xiranite.config.toml");
    std::fs::write(&escape, "do not touch me\n").expect("seed outside file");
    let inside = root.file("xiranite.config.toml");
    let store = store_in(&root);

    let error = store
        .write_atomic(&escape, "overwritten\n")
        .expect_err("the config root is not a licence to write anywhere");
    assert_eq!(error.code(), "permission_denied", "{error}");
    assert_eq!(
        std::fs::read_to_string(&escape).expect("read outside"),
        "do not touch me\n",
        "a refusal must not have written"
    );
    // Positive control on the same store: the grant is not simply refusing everything.
    store.write_atomic(&inside, "fine\n").expect("inside the grant this works");
    assert_eq!(std::fs::read_to_string(&inside).expect("read inside"), "fine\n");
}

/// Eight concurrent readers-writers over one document: if the lock were decorative, updates would vanish.
#[test]
fn concurrent_writers_serialize_and_no_update_is_lost() {
    let root = TempRoot::new("concurrent");
    let config = root.file("state.json");
    std::fs::write(&config, r#"{"count":0}"#).expect("seed document");
    let store = Arc::new(store_in(&root));

    std::thread::scope(|scope| {
        for _ in 0..8 {
            let store = Arc::clone(&store);
            let path = config.clone();
            scope.spawn(move || {
                for _ in 0..4 {
                    // One read-modify-write, exactly the shape `updateAtomicJsonFile` had in TypeScript.
                    let transaction = store.begin(&path).expect("begin");
                    let current: u32 = transaction
                        .contents
                        .as_deref()
                        .and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok())
                        .and_then(|value| value.get("count")?.as_u64().map(|count| count as u32))
                        .unwrap_or(0);
                    store
                        .commit(&path, &transaction.token, &format!(r#"{{"count":{}}}"#, current + 1))
                        .expect("commit");
                }
            });
        }
    });

    let text = std::fs::read_to_string(&config).expect("read final");
    let value: serde_json::Value = serde_json::from_str(&text).expect("final document is JSON");
    assert_eq!(value["count"].as_u64(), Some(32), "32 increments, none lost: {text}");
    assert_eq!(root.names(), vec!["state.json".to_string()], "no lock or temp left behind");
}

#[test]
fn a_policy_that_would_wait_forever_or_never_recover_is_refused() {
    let root = TempRoot::new("policy");
    let config = root.file("xiranite.config.toml");
    let store = store_with_clock(
        &root,
        Arc::new(ManualClock::new(epoch_ms())),
        LockPolicy { stale_ms: 30_000, retries: 101, ..LockPolicy::default() },
    );

    assert_eq!(
        store.write_atomic(&config, "x\n").map_err(|error| error.code()).map(|()| ""),
        Err("invalid_policy"),
        "retries above the ceiling must be refused before any waiting happens"
    );
    let zero_stale = LockPolicy { stale_ms: 0, retries: 1, ..LockPolicy::default() };
    assert_eq!(
        zero_stale.validate().map_err(|error| error.code()),
        Err("invalid_policy"),
        "a zero stale window would displace a live holder"
    );
    let inverted = LockPolicy { stale_ms: 1_000, retries: 1, min_delay_ms: 500, max_delay_ms: 100 };
    assert_eq!(
        inverted.validate().map_err(|error| error.code()),
        Err("invalid_policy"),
        "a backoff whose floor is above its ceiling is a bug, not a policy"
    );

    // The clock type the stores accept is the same one the operation manager injects.
    let clock: Arc<dyn Clock> = Arc::new(SystemClock);
    let _ = ConfigStore::new(FileCapability::denied(), clock);
}
