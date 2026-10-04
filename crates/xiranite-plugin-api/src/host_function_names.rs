//! Host-function names a plugin may import, per ADR-0068's capability namespaces.
//!
//! These are logical protocol names, not Extism mechanisms: a future WIT adapter maps each capability
//! namespace onto one `interface` (`xiranite.fs`, `xiranite.operation`, `xiranite.scheduler`) without
//! touching this list. ADR-0066 decided the semantics (cooperative checkpoint, host performs the action,
//! calls pass handles instead of bytes); ADR-0068 superseded its flat names with these namespaces, and
//! ADR-0070 added the bounded text-document pair `xiranite.fs.read_text`/`.write_text` so that
//! `xiranite.fs.read` carries handle chunks the way ADR-0068's own table described it. On top of that,
//! `xiranite.log`, `xiranite.now`, `xiranite.process.run`, `xiranite.scheduler.release`, the extra
//! `xiranite.fs.*` entries and path-token resolution are the set the ported plugins actually measured a
//! need for.
//!
//! Renaming an entry here is a Plugin API version bump, not a refactor: `pluginApiVersion` in every
//! manifest is what makes an old plugin's incompatibility legible instead of mysterious.

/// Namespace every Xiranite host function lives in.
pub const HOST_FUNCTION_NAMESPACE: &str = "xiranite";

/// Opens an authorized path and returns a host-assigned handle.
pub const HOST_FUNCTION_FS_OPEN: &str = "xiranite.fs.open";
/// Reads one bounded chunk from an open handle.
///
/// The ADR-0068 table named this call for handles, and the host served a whole text document under it
/// until ADR-0070 moved that document pair to [`HOST_FUNCTION_FS_READ_TEXT`]/[`HOST_FUNCTION_FS_WRITE_TEXT`]
/// so this name means what its own table entry says.
pub const HOST_FUNCTION_FS_READ: &str = "xiranite.fs.read";
/// Writes one bounded chunk through the host's file-operation journal.
///
/// Settled but not served yet: the journal that keeps a streamed write undoable does not exist in
/// `xiranite-core`, so the host refuses this with `not_implemented` rather than opening an unjournalable
/// write path.
pub const HOST_FUNCTION_FS_WRITE: &str = "xiranite.fs.write";
/// Reads one bounded text document by path (ADR-0070). Undo histories and record files are its
/// consumers; the ceiling is `xiranite_core::filesystem::MAX_TEXT_BYTES`.
pub const HOST_FUNCTION_FS_READ_TEXT: &str = "xiranite.fs.read_text";
/// Writes one bounded text document by path (ADR-0070), creating the parent directory as the host does.
pub const HOST_FUNCTION_FS_WRITE_TEXT: &str = "xiranite.fs.write_text";
/// Releases a handle; the host, not the plugin, decides when bytes are dropped.
pub const HOST_FUNCTION_FS_CLOSE: &str = "xiranite.fs.close";
/// Sizes one path without copying its bytes into the plugin.
pub const HOST_FUNCTION_FS_STAT: &str = "xiranite.fs.stat";
/// Enumerates one directory for queue planning.
pub const HOST_FUNCTION_FS_LIST: &str = "xiranite.fs.list";
/// Moves one authorized path onto another authorized path.
pub const HOST_FUNCTION_FS_MOVE: &str = "xiranite.fs.move";
/// Copies without streaming bytes through plugin linear memory.
pub const HOST_FUNCTION_FS_COPY: &str = "xiranite.fs.copy";
/// Deletes through the host's file-operation journal so the operation stays undoable.
pub const HOST_FUNCTION_FS_DELETE: &str = "xiranite.fs.delete";
/// Creates a directory the operation will write into.
pub const HOST_FUNCTION_FS_ENSURE_DIR: &str = "xiranite.fs.ensure_dir";
/// Restores timestamps the plugin read before a move.
pub const HOST_FUNCTION_FS_SET_TIMES: &str = "xiranite.fs.set_times";

/// Yield point: waits while the owning operation is paused, hard-stops on cancel.
pub const HOST_FUNCTION_OPERATION_CHECKPOINT: &str = "xiranite.operation.checkpoint";
/// Reports status for the owning operation (phase, counters) without ending it.
pub const HOST_FUNCTION_OPERATION_UPDATE: &str = "xiranite.operation.update";
/// Reports one progress or log event into the operation's event stream.
pub const HOST_FUNCTION_OPERATION_EMIT: &str = "xiranite.operation.emit";

/// Runs one command through the host, which owns argv, cwd and the exit status.
pub const HOST_FUNCTION_PROCESS_RUN: &str = "xiranite.process.run";

/// Requests a CPU, GPU, disk or network admission permit (ADR-0063).
pub const HOST_FUNCTION_SCHEDULER_ACQUIRE: &str = "xiranite.scheduler.acquire";
/// Returns a permit the plugin owns; without it a lease can only expire by timeout.
pub const HOST_FUNCTION_SCHEDULER_RELEASE: &str = "xiranite.scheduler.release";

/// Writes one structured diagnostic line through the host's logger.
pub const HOST_FUNCTION_LOG: &str = "xiranite.log";
/// Host clock, so a plugin never reads a wall clock itself and determinism stays testable.
pub const HOST_FUNCTION_NOW: &str = "xiranite.now";

/// Resolves a path token into the path the host authorized it for.
pub const HOST_FUNCTION_PATH_TOKEN_RESOLVE: &str = "xiranite.path_token.resolve";

/// Every host function name, in capability order. The plugin-side shim, the Extism adapter and the
/// manifest gate all iterate this list rather than re-spelling names.
pub const HOST_FUNCTION_NAMES: &[&str] = &[
    HOST_FUNCTION_FS_OPEN,
    HOST_FUNCTION_FS_READ,
    HOST_FUNCTION_FS_WRITE,
    HOST_FUNCTION_FS_READ_TEXT,
    HOST_FUNCTION_FS_WRITE_TEXT,
    HOST_FUNCTION_FS_CLOSE,
    HOST_FUNCTION_FS_STAT,
    HOST_FUNCTION_FS_LIST,
    HOST_FUNCTION_FS_MOVE,
    HOST_FUNCTION_FS_COPY,
    HOST_FUNCTION_FS_DELETE,
    HOST_FUNCTION_FS_ENSURE_DIR,
    HOST_FUNCTION_FS_SET_TIMES,
    HOST_FUNCTION_OPERATION_CHECKPOINT,
    HOST_FUNCTION_OPERATION_UPDATE,
    HOST_FUNCTION_OPERATION_EMIT,
    HOST_FUNCTION_PROCESS_RUN,
    HOST_FUNCTION_SCHEDULER_ACQUIRE,
    HOST_FUNCTION_SCHEDULER_RELEASE,
    HOST_FUNCTION_LOG,
    HOST_FUNCTION_NOW,
    HOST_FUNCTION_PATH_TOKEN_RESOLVE,
];

/// The size of the ADR-0068 vocabulary as amended by ADR-0070: thirteen file calls, three operation
/// calls, one process call, two scheduler calls, plus log, now and path-token resolution.
pub const ADR_DOCUMENTED_HOST_FUNCTION_COUNT: usize = HOST_FUNCTION_NAMES.len();

/// The import symbol one capability name becomes when it is registered as an Extism user function.
///
/// The rule is part of the contract rather than an adapter detail: a guest declares the import in a
/// `#[link_name]`/`host_fn` block and cannot reach into the adapter to ask, so both sides derive the
/// same text from the manifest's logical name. Dots flatten to underscores because a Rust
/// declaration needs a valid identifier, and the mapping is injective over [`HOST_FUNCTION_NAMES`]
/// (the settled names that already carry an underscore — `fs.read_text`, `fs.write_text`,
/// `fs.set_times` — flatten to forms that no other name collides with). An unknown name resolves to
/// `None`, so a drifted capability fails loudly at the boundary instead of silently landing on some
/// other symbol.
///
/// Every settled name with its flattened import symbol, in [`HOST_FUNCTION_NAMES`] order. The
/// adapter registers these, a plugin shim's `#[link_name]` must match one of them, and
/// `bun run audit:plugin-manifests` compares a manifest against this table.
pub const HOST_FUNCTION_SYMBOLS: &[(&str, &str)] = &[
    ("xiranite.fs.open", "xiranite_fs_open"),
    ("xiranite.fs.read", "xiranite_fs_read"),
    ("xiranite.fs.write", "xiranite_fs_write"),
    ("xiranite.fs.read_text", "xiranite_fs_read_text"),
    ("xiranite.fs.write_text", "xiranite_fs_write_text"),
    ("xiranite.fs.close", "xiranite_fs_close"),
    ("xiranite.fs.stat", "xiranite_fs_stat"),
    ("xiranite.fs.list", "xiranite_fs_list"),
    ("xiranite.fs.move", "xiranite_fs_move"),
    ("xiranite.fs.copy", "xiranite_fs_copy"),
    ("xiranite.fs.delete", "xiranite_fs_delete"),
    ("xiranite.fs.ensure_dir", "xiranite_fs_ensure_dir"),
    ("xiranite.fs.set_times", "xiranite_fs_set_times"),
    ("xiranite.operation.checkpoint", "xiranite_operation_checkpoint"),
    ("xiranite.operation.update", "xiranite_operation_update"),
    ("xiranite.operation.emit", "xiranite_operation_emit"),
    ("xiranite.process.run", "xiranite_process_run"),
    ("xiranite.scheduler.acquire", "xiranite_scheduler_acquire"),
    ("xiranite.scheduler.release", "xiranite_scheduler_release"),
    ("xiranite.log", "xiranite_log"),
    ("xiranite.now", "xiranite_now"),
    ("xiranite.path_token.resolve", "xiranite_path_token_resolve"),
];

/// The import symbol for one logical name, looked up in [`HOST_FUNCTION_SYMBOLS`].
#[must_use]
pub fn host_function_symbol(name: &str) -> Option<&'static str> {
    HOST_FUNCTION_SYMBOLS.iter().find(|(logical, _)| *logical == name).map(|(_, symbol)| *symbol)
}

/// The logical manifest name behind an import symbol.
#[must_use]
pub fn host_function_name_for_symbol(symbol: &str) -> Option<&'static str> {
    HOST_FUNCTION_SYMBOLS.iter().find(|(_, candidate)| *candidate == symbol).map(|(name, _)| *name)
}

const fn has_prefix(value: &str, prefix: &str) -> bool {
    let bytes = value.as_bytes();
    let needle = prefix.as_bytes();
    if bytes.len() < needle.len() {
        return false;
    }
    let mut index = 0usize;
    while index < needle.len() {
        if bytes[index] != needle[index] {
            return false;
        }
        index += 1;
    }
    true
}

const fn every_name_is_namespaced(names: &[&str]) -> bool {
    let mut index = 0usize;
    while index < names.len() {
        if !has_prefix(names[index], "xiranite.") {
            return false;
        }
        index += 1;
    }
    true
}

const _: () = assert!(
    every_name_is_namespaced(HOST_FUNCTION_NAMES),
    "a host function name left the xiranite. namespace"
);

const _: () = assert!(
    HOST_FUNCTION_NAMES.len() == 22,
    "the host function set drifted from the ADR-0068 vocabulary as amended by ADR-0070"
);

const _: () = assert!(
    HOST_FUNCTION_SYMBOLS.len() == HOST_FUNCTION_NAMES.len(),
    "a host function symbol was added or dropped without its logical name"
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_name_is_unique_and_namespaced() {
        let mut seen: Vec<&str> = Vec::new();
        for name in HOST_FUNCTION_NAMES.iter().copied() {
            assert!(name.starts_with("xiranite."), "{name} left the namespace");
            assert!(!seen.contains(&name), "duplicate host function name {name}");
            seen.push(name);
        }
        assert_eq!(seen.len(), ADR_DOCUMENTED_HOST_FUNCTION_COUNT);
    }

    #[test]
    fn capability_namespaces_cover_the_vocabulary() {
        // Spelled out a second time on purpose: ADR-0068 assigns these namespaces so a WIT `interface`
        // maps one-to-one, therefore a rename here has to be a Plugin API version bump. ADR-0070 adds
        // the two text-document entries marked below.
        let adr_0068_names = [
            "xiranite.fs.open",
            "xiranite.fs.read",
            "xiranite.fs.write",
            "xiranite.fs.read_text",
            "xiranite.fs.write_text",
            "xiranite.fs.close",
            "xiranite.fs.stat",
            "xiranite.fs.list",
            "xiranite.fs.move",
            "xiranite.fs.copy",
            "xiranite.fs.delete",
            "xiranite.fs.ensure_dir",
            "xiranite.fs.set_times",
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
        assert_eq!(
            HOST_FUNCTION_NAMES.len(),
            adr_0068_names.len(),
            "the ADR list and the module list disagree in size"
        );
        for name in adr_0068_names {
            assert!(HOST_FUNCTION_NAMES.contains(&name), "ADR-0068 name {name} is missing");
        }
        for name in HOST_FUNCTION_NAMES {
            assert!(adr_0068_names.contains(name), "name {name} is not in ADR-0068");
        }
    }

    #[test]
    fn superseded_flat_names_are_gone() {
        for legacy in [
            "xiranite.checkpoint",
            "xiranite.emit",
            "xiranite.file.open",
            "xiranite.file.read",
            "xiranite.file.list",
            "xiranite.path.token.resolve",
        ] {
            assert!(
                !HOST_FUNCTION_NAMES.contains(&legacy),
                "{legacy} is the pre-ADR-0068 spelling and must not come back"
            );
        }
    }

    #[test]
    fn namespace_constant_prefixes_every_name() {
        for name in HOST_FUNCTION_NAMES {
            assert!(name.starts_with(HOST_FUNCTION_NAMESPACE));
        }
    }

    #[test]
    fn symbols_agree_with_names_in_order_and_are_the_flattening() {
        assert_eq!(
            HOST_FUNCTION_SYMBOLS.len(),
            HOST_FUNCTION_NAMES.len(),
            "the symbol table and the name table drifted apart in size"
        );
        for index in 0..HOST_FUNCTION_NAMES.len() {
            let (name, symbol) = HOST_FUNCTION_SYMBOLS[index];
            assert_eq!(name, HOST_FUNCTION_NAMES[index], "pair {index} left the vocabulary order");
            assert_eq!(
                symbol,
                name.replace('.', "_"),
                "{name} must flatten to its dots-as-underscores symbol, which is what a shim declares"
            );
            assert_eq!(host_function_symbol(name), Some(symbol), "{name} lookup");
            assert_eq!(host_function_name_for_symbol(symbol), Some(name), "{symbol} lookup");
        }
    }

    #[test]
    fn symbol_lookup_is_injective_and_refuses_unknown_names() {
        let mut seen: Vec<&str> = Vec::new();
        for (_, symbol) in HOST_FUNCTION_SYMBOLS {
            assert!(!seen.contains(symbol), "duplicate import symbol {symbol}");
            seen.push(symbol);
        }
        assert_eq!(host_function_symbol("xiranite.file.list"), None, "the pre-ADR-0068 spelling resolves to nothing");
        assert_eq!(host_function_symbol("xiranite_fs_stat"), None, "a symbol is not a logical name");
        assert_eq!(host_function_name_for_symbol("xiranite.emit"), None);
    }
}
