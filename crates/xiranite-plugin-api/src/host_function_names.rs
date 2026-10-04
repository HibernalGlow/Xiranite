//! The nine host-function names a plugin may import (ADR-0068 namespaces, as closed by ADR-0071).
//!
//! These are logical protocol names, not Extism mechanisms: a future WIT adapter maps each capability
//! touching this list. ADR-0066 decided the semantics (cooperative checkpoint, host performs the action);
//! ADR-0068 superseded its flat names with these namespaces; **ADR-0071 removed the whole `xiranite.fs.*`
//! family**, because file IO is not a capability we should invent — the host enables WASI on the plugin and
//! grants per-node preopens, and the guest uses `std::fs` against those roots. What is left here is product
//! semantics plus the two things a sandbox genuinely cannot do for itself: run a registered command, and read
//! a path token it was never given the real path for.
//!
//! `xiranite.process.run` is a **command allowlist**, not a shell: `program` may only name a command the host
//! registered, and the registration point is where a `DangerGate` hangs, so `7za x -y` is a confirmed action
//! while the guest has no way to spawn anything else.
//!
//! Renaming an entry here is a Plugin API version bump, not a refactor: `pluginApiVersion` in every manifest is
//! what makes an old plugin's incompatibility legible instead of mysterious.

/// Namespace every Xiranite host function lives in.
pub const HOST_FUNCTION_NAMESPACE: &str = "xiranite";

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
    HOST_FUNCTION_NAMES.len() == 9,
    "the capability vocabulary is closed at nine names by ADR-0071: file IO moved to WASI preopens, so a new \
     host function here needs an accepted ADR, not a convenience"
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
        // maps one-to-one, therefore a rename here has to be a Plugin API version bump. ADR-0071 closed the
        // list at these nine; a tenth entry needs an ADR.
        let adr_0068_names = [
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
            "xiranite.fs.open",
            "xiranite.fs.read_text",
            "xiranite.fs.write_text",
            "xiranite.fs.ensure_dir",
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
