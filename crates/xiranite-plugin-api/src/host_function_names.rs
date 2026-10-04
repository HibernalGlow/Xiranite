//! Host-function names a plugin may import, per ADR-0068's capability namespaces.
//!
//! These are logical protocol names, not Extism mechanisms: a future WIT adapter maps each capability
//! namespace onto one `interface` (`xiranite.fs`, `xiranite.operation`, `xiranite.scheduler`) without
//! touching this list. ADR-0066 decided the semantics (cooperative checkpoint, host performs the action,
//! calls pass handles instead of bytes); ADR-0068 superseded its flat names with these namespaces, and
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
pub const HOST_FUNCTION_FS_READ: &str = "xiranite.fs.read";
/// Writes one bounded chunk through the host's file-operation journal.
pub const HOST_FUNCTION_FS_WRITE: &str = "xiranite.fs.write";
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

/// The size of the ADR-0068 vocabulary: eleven file calls, three operation calls, one process call,
/// two scheduler calls, plus log, now and path-token resolution.
pub const ADR_DOCUMENTED_HOST_FUNCTION_COUNT: usize = HOST_FUNCTION_NAMES.len();

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
    HOST_FUNCTION_NAMES.len() == 20,
    "the host function set drifted from the ADR-0068 capability vocabulary"
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
        // maps one-to-one, therefore a rename here has to be a Plugin API version bump.
        let adr_0068_names = [
            "xiranite.fs.open",
            "xiranite.fs.read",
            "xiranite.fs.write",
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
}
