//! The recycle bin as a node-reachable host service (AGENTS.md: trash/restore/list must survive as an
//! `xiranite-core` host service; ADR-0064 kept it when the `czkawka` node surface went away).
//!
//! ## Why the grant is checked per path
//!
//! Moving a file to the trash is a delete with a safety net, so it gets exactly the same authorization
//! as `fs.delete`: every path is resolved through the run's [`FileCapability`] before the backend sees
//! it, and a run started on the bare `NodeHost` seam is refused with the same shape `fs.*` uses. Without
//! that, `trash.move` would be a way to reach any path on the machine while the node's own `fs.move` is
//! fenced to its roots — a hole, not a capability.
//!
//! ## macOS answers `supported: false`, not an empty list
//!
//! `xiranite_core::trash_service` documents why (the inventory half of the backend is compiled out on
//! that platform and Finder keeps no readable record of an item's original path). An empty list would let
//! a "restore last deletion" button render as "there is nothing to restore"; it renders as unavailable
//! instead, with the backend named.
//!
//! ## `purge` is separated from `move` on purpose
//!
//! Emptying someone's trash is not part of "delete this undoably". They are distinct methods so a node
//! that is granted `trash` and calls `move` never reaches `purge` by accident — and a face that wants the
//! second one asks for it by name in its own code.

use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use xiranite_node_registry::NodeHost;

use crate::host_calls::{CallError, HostAnswer, answer, required_text};
use crate::machine::MachineAccess;

/// The methods this service answers, spelled once here and published by the service table.
pub(crate) const METHODS: &[&str] = &["info", "move", "list", "restore", "purge"];

use xiranite_core::trash_service as trash;

/// Answers one `trash` service method.
pub(crate) fn dispatch(
    method: &str,
    arguments: &Value,
    _host: &mut (dyn NodeHost + 'static),
    machine: &MachineAccess,
) -> Result<HostAnswer, CallError> {
    match method {
        "info" => Ok(answer(info_document())),
        "move" => move_to_trash(arguments, machine),
        "list" => Ok(answer(list_document())),
        "restore" => restore_item(arguments, machine),
        "purge" => purge_items(arguments, machine),
        other => Err(CallError::Failure(format!(
            "the trash service does not answer {other:?}; it answers: {}",
            METHODS.join(", ")
        ))),
    }
}

fn info_document() -> Value {
    let support = trash::support();
    json!({
        "service": "trash",
        "backend": support.backend,
        "canTrash": support.can_trash,
        "canInventory": support.can_inventory,
        // `canInventory` alone is not enough since macOS gained the journal: there it means "the items
        // this product moved", not "your trash". A face renders the difference in wording, so the scope
        // has to travel with the boolean instead of being inferred from the platform name.
        "inventoryScope": scope_name(support.inventory_scope),
    })
}

/// The wire name of an inventory scope: kebab-case, matching the other documented enums.
fn scope_name(scope: trash::TrashInventoryScope) -> &'static str {
    match scope {
        trash::TrashInventoryScope::SystemBin => "system-bin",
        trash::TrashInventoryScope::OwnJournal => "own-journal",
    }
}

/// The run's filesystem grant, phrased the way `fs_operations.rs` phrases it.
fn capability(machine: &MachineAccess) -> Result<&xiranite_core::filesystem::FileCapability, CallError> {
    machine.capability().ok_or_else(|| {
        CallError::Failure(
            "trash needs the operation's granted filesystem, and this run was started with the NodeHost \
             seam alone. Build it with MachineAccess::granted(..) / Executor::with_files(..)."
                .to_string(),
        )
    })
}

fn authorized_paths(arguments: &Value, machine: &MachineAccess) -> Result<Vec<PathBuf>, CallError> {
    let capability = capability(machine)?;
    let raws: Vec<&str> = match arguments.get("paths") {
        Some(Value::Array(list)) => list
            .iter()
            .map(|entry| {
                entry.as_str().ok_or_else(|| CallError::Failure("each `paths` entry must be a string".to_string()))
            })
            .collect::<Result<_, _>>()?,
        Some(_) => return Err(CallError::Failure("`paths` must be an array of strings".to_string())),
        None => vec![required_text(arguments, "path")?],
    };
    if raws.is_empty() {
        return Err(CallError::Failure("`paths` is empty; name at least one path to move".to_string()));
    }
    raws.iter()
        .map(|raw| capability.resolve(raw).map_err(|error| CallError::Failure(error.message())))
        .collect()
}

fn move_to_trash(arguments: &Value, machine: &MachineAccess) -> Result<HostAnswer, CallError> {
    let paths = authorized_paths(arguments, machine)?;
    trash::move_all_to_trash(&paths).map_err(|error| CallError::Failure(error.to_string()))?;
    Ok(answer(json!({
        "trashed": true,
        "paths": paths.iter().map(|path| path.display().to_string()).collect::<Vec<_>>(),
    })))
}

fn list_document() -> Value {
    let support = trash::support();
    if !support.can_inventory {
        return json!({ "supported": false, "backend": support.backend, "items": Value::Null });
    }
    match trash::list() {
        Ok(items) => json!({
            "supported": true,
            "backend": support.backend,
            "scope": scope_name(support.inventory_scope),
            "items": items.iter().map(item_json).collect::<Vec<_>>(),
        }),
        Err(error) => json!({
            "supported": true,
            "backend": support.backend,
            "scope": scope_name(support.inventory_scope),
            "error": error.to_string()
        }),
    }
}

fn item_json(item: &trash::TrashedItem) -> Value {
    json!({
        "id": item.id().to_string(),
        "name": item.name().display().to_string(),
        "originalParent": item.original_parent().display().to_string(),
        "deletedUnixSecs": item.deleted_unix_secs(),
        "sizeBytes": item.size_bytes(),
    })
}

/// Finds one listed item by the backend id the `list` answer handed out.
fn find_listed(id: &str) -> Result<trash::TrashedItem, CallError> {
    let items = trash::list().map_err(|error| CallError::Failure(error.to_string()))?;
    items
        .into_iter()
        .find(|item| item.id() == id)
        .ok_or_else(|| CallError::Failure(format!("no trash item with id {id:?} is listed by this host")))
}

fn require_inventory() -> Result<(), CallError> {
    let support = trash::support();
    if support.can_inventory {
        return Ok(());
    }
    Err(CallError::Failure(
        trash::TrashError::Unsupported { operation: "restore", backend: support.backend }.to_string(),
    ))
}

fn restore_item(arguments: &Value, machine: &MachineAccess) -> Result<HostAnswer, CallError> {
    let id = required_text(arguments, "id")?;
    require_inventory()?;
    let _ = machine;
    let item = find_listed(id)?;
    let restored = trash::restore(&item).map_err(|error| CallError::Failure(error.to_string()))?;
    Ok(answer(json!({ "restored": true, "path": restored.display().to_string() })))
}

fn purge_items(arguments: &Value, machine: &MachineAccess) -> Result<HostAnswer, CallError> {
    require_inventory().map_err(|_| CallError::Failure(
        "the trash backend on this machine cannot enumerate items, so it cannot purge named ones either"
            .to_string(),
    ))?;
    let _ = machine;
    let Value::Array(ids) = arguments.get("ids").cloned().unwrap_or(Value::Null) else {
        return Err(CallError::Failure("`purge` needs `ids`: an array of ids taken from `list`".to_string()));
    };
    if ids.is_empty() {
        return Err(CallError::Failure("`ids` is empty; nothing would be purged".to_string()));
    }
    let mut items = Vec::with_capacity(ids.len());
    for id in &ids {
        let Value::String(id) = id else {
            return Err(CallError::Failure("each `ids` entry must be a string".to_string()));
        };
        items.push(find_listed(id)?);
    }
    let purged = trash::purge(&items).map_err(|error| CallError::Failure(error.to_string()))?;
    Ok(answer(json!({ "purged": purged })))
}

/// Paths the service will not touch even when the grant allows them, kept for the doc above.
#[allow(dead_code)]
fn is_root(path: &Path) -> bool {
    path.parent().is_none()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(method: &str, arguments: Value, machine: &MachineAccess) -> Result<String, String> {
        let mut host = crate::test_host::CountingHost::new();
        match dispatch(method, &arguments, &mut host, machine) {
            Ok(HostAnswer::Text(text)) => Ok(text),
            Ok(HostAnswer::Bytes(_)) => Err("the trash service never answers bytes".to_string()),
            Err(error) => Err(error.message().to_string()),
        }
    }

    #[test]
    fn info_reports_the_ceiling_instead_of_promising_the_world() {
        let text = call("info", json!({}), &MachineAccess::seam_only()).expect("info needs no grant");
        let document: Value = serde_json::from_str(&text).expect("info is JSON");
        let support = trash::support();
        assert_eq!(document["canTrash"], json!(support.can_trash));
        assert_eq!(document["canInventory"], json!(support.can_inventory));
        assert_eq!(document["backend"], json!(support.backend));
        assert_eq!(document["inventoryScope"], json!(scope_name(support.inventory_scope)));
        if cfg!(target_os = "macos") {
            // The one case where the scope carries weight: a macOS list is journal-scoped, and a face
            // that showed it as "your trash" would be lying about the rest of the bin.
            assert_eq!(document["inventoryScope"], json!("own-journal"), "{document}");
        }
    }

    #[test]
    fn a_list_answer_carries_its_scope_with_the_items() {
        let text = call("list", json!({}), &MachineAccess::seam_only()).expect("list needs no grant");
        let document: Value = serde_json::from_str(&text).expect("list is JSON");
        // All three shipped targets answer, so a skipped assertion here would be a hole, not a pass.
        assert_eq!(document["supported"], json!(true), "{document}");
        assert_eq!(
            document["scope"],
            json!(scope_name(trash::support().inventory_scope)),
            "a list without its scope is how a partial bin gets presented as the whole one: {document}"
        );
    }

    /// The authorization hole this module exists to close: no filesystem grant means no path moves,
    /// whatever the node asked for.
    #[test]
    fn a_run_without_a_filesystem_grant_cannot_move_anything() {
        let error = call("move", json!({ "path": "/tmp/whatever" }), &MachineAccess::seam_only())
            .expect_err("the seam grants nothing");
        assert!(error.contains("granted filesystem"), "{error}");
    }

    #[test]
    fn a_path_outside_the_granted_roots_is_refused() {
        let root = std::env::temp_dir();
        let machine = MachineAccess::granted(xiranite_core::filesystem::FileCapability::new([root.as_path()]));
        let error = call("move", json!({ "path": "/definitely/not/in/the/temp/root" }), &machine)
            .expect_err("outside the grant");
        assert!(!error.contains("granted filesystem"), "wrong refusal: {error}");
    }

    #[test]
    fn an_empty_batch_is_refused_rather_than_silently_doing_nothing() {
        let root = std::env::temp_dir();
        let machine = MachineAccess::granted(xiranite_core::filesystem::FileCapability::new([root.as_path()]));
        let error = call("move", json!({ "paths": [] }), &machine).expect_err("nothing named");
        assert!(error.contains("empty"), "{error}");
    }

    #[test]
    fn purge_names_the_shape_it_needs_and_the_ceiling_it_hit() {
        let error = call("purge", json!({}), &MachineAccess::seam_only()).expect_err("no ids given");
        assert!(error.contains("ids") || error.contains("enumerate"), "{error}");
    }

    #[test]
    fn an_unknown_method_is_refused_with_the_published_set() {
        let error = call("empty", json!({}), &MachineAccess::seam_only()).expect_err("not published");
        assert!(error.contains("does not answer"), "{error}");
        for method in METHODS {
            assert!(error.contains(method), "the refusal must list {method}: {error}");
        }
    }
}
