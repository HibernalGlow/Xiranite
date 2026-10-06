//! Host services a node may reach, and the one generic door they come through.
//!
//! ## Why a service table instead of operations
//!
//! `HostOperation` is the machine's own surface — what a `node:fs`, `node:child_process` or
//! `node:crypto` call needs — and every retained node can ask for it. A duplicate-find engine is not
//! that: it is one node's domain. Spelling it as operations would put `czkawka.scan.duplicates` in the
//! same closed table as `fs.stat`, and the generic `fs` router would have to answer for it (measured,
//! not imagined: adding those arms made `fs_operations.rs`'s `match` non-exhaustive).
//!
//! So the machine surface gains exactly one arm, `service.invoke`, and the domain vocabulary lives
//! with the domain. This table is where a name is bound to the code that answers it.
//!
//! ## The gate is the registration, not the request
//!
//! A node reaches a service only if its `NodeDescriptor` declared it
//! ([`xiranite_node_registry::NodeRequirements::services`]), which is the same rule
//! `proc.exec` follows for external programs: the allowlist is a property of the registration, so a
//! bundle cannot discover an engine by guessing at names. A refusal therefore names what the node
//! *did* declare — an operator reading the log gets the diff, not a mystery.
//!
//! ## What a service may not do
//!
//! A service answers documents. Byte payloads stay on the machine surface (`__xrh.callBytes` /
//! `sendBytes`), because the byte rule (ADR-0074 §4) is about how a buffer crosses the realm boundary
//! and is not something one service should get to re-decide.

use serde_json::Value;
use xiranite_node_registry::NodeHost;

use crate::config_operations;
#[cfg(feature = "czkawka")]
use crate::czkawka_operations;
#[cfg(feature = "findz")]
use crate::findz_operations;
use crate::host_calls::{CallError, HostAnswer, required_text};
use crate::os_operations;
use crate::power_operations;
use crate::trash_operations;
use crate::machine::MachineAccess;

/// One service's entry point: a method name, the caller's arguments, and the run's machine.
type ServiceDispatch =
    fn(&str, &Value, &mut (dyn NodeHost + 'static), &MachineAccess) -> Result<HostAnswer, CallError>;

/// A host service a node can be granted.
#[derive(Debug)]
pub(crate) struct HostService {
    /// The name a bundle puts in `{"service": ...}` and a node puts in its declaration.
    pub name: &'static str,
    /// The methods this service answers. Anything else is a refusal naming the set.
    pub methods: &'static [&'static str],
    dispatch: ServiceDispatch,
}

/// Every engine the host links in, by name.
///
/// The two rows a cargo feature can compile out are marked on the row, not on the table, so
/// `published_services()` reads the set this binary actually dispatches. That is what makes
/// `tests/manifest_services_are_answered.rs` a subtraction judge instead of a source-text scan: a
/// `#[cfg]` that removes a row leaves the line in the file, while the table below loses it.
static SERVICES: &[HostService] = &[
    #[cfg(feature = "czkawka")]
    HostService {
        name: "czkawka",
        // The published set comes from the dispatch module itself: `scan.basic` was answered by the
        // engine for a whole round while this table still advertised four methods, and the realm was
        // refused for a call that worked.
        methods: czkawka_operations::METHODS,
        dispatch: czkawka_operations::dispatch,
    },
    #[cfg(feature = "findz")]
    HostService {
        name: "findz",
        // The Go index core, reached as a child process the run owns (ADR-0077). The published
        // set is `native/findz-go/protocol.go`'s own capability list, and a test in
        // `findz_operations` compares the two against the Go source so the table cannot fall
        // behind the engine — the mistake the czkawka row above records.
        //
        // This row is the whole extent of what a `findz` feature can switch off in Rust: the engine
        // itself is a Go executable staged outside the cargo graph (see the `notify` note in this
        // crate's Cargo.toml and `docs/migration/host-service-feature-gate.md`).
        methods: findz_operations::METHODS,
        dispatch: findz_operations::dispatch,
    },
    HostService {
        name: "config",
        // The published set comes from the dispatch module itself, so it cannot fall behind the arms.
        methods: &config_operations::METHODS,
        dispatch: config_operations::dispatch,
    },
    HostService {
        name: "os",
        // Clipboard text and interface counters, answered by the host so that no node has to shell out to
        // `powershell Get-Clipboard`, `pbpaste`, or `Get-NetAdapterStatistics` any more.
        methods: os_operations::METHODS,
        dispatch: os_operations::dispatch,
    },
    HostService {
        name: "trash",
        // The recycle bin as a host service. `info` answers on every target; on macOS the inventory
        // methods refuse, because that OS keeps no readable record of an item's original path.
        methods: trash_operations::METHODS,
        dispatch: trash_operations::dispatch,
    },
    HostService {
        name: "power",
        // Sleep / hibernate / shutdown / reboot, with the platform ceiling disclosed before the machine
        // is ever asked — `hibernate` is not offered on macOS.
        methods: power_operations::METHODS,
        dispatch: power_operations::dispatch,
    },
];

/// The service names this build actually links, read from the table the host dispatches through.
///
/// This exists so a gate can compare a node's declaration against the binary instead of against a list
/// copied into a script. `scripts/embed-node-bundles.ts` cannot reach it (the `@ast-grep/napi` build in
/// this repo does not support Rust), and reading the source text would keep reporting a service that a
/// cargo feature has compiled out — which is the exact drift the host-side check must catch.
pub fn published_services() -> Vec<&'static str> {
    names(SERVICES)
}

/// Answers one `service.invoke`.
pub(crate) fn execute(
    arguments: &Value,
    host: &mut (dyn NodeHost + 'static),
    machine: &MachineAccess,
) -> Result<HostAnswer, CallError> {
    let (service, method, args) = resolve(arguments, machine)?;
    (service.dispatch)(method, &args, host, machine)
}

/// Validates a request against the table and the node's declaration, and returns its argument document.
///
/// Split out because it is the whole policy, and the policy is what a test can pin without starting an
/// engine run: nothing here reaches JavaScript or the engine.
fn resolve<'a>(
    arguments: &'a Value,
    machine: &MachineAccess,
) -> Result<(&'static HostService, &'a str, Value), CallError> {
    let service_name = required_text(arguments, "service")?;
    let method = required_text(arguments, "method")?;
    let service = SERVICES.iter().find(|entry| entry.name == service_name).ok_or_else(|| {
        CallError::Failure(format!(
            "no host service {service_name:?}; this host answers: {}",
            names(SERVICES).join(", ")
        ))
    })?;
    if !machine.declares_service(service_name) {
        return Err(CallError::Failure(format!(
            "this node declared no {service_name:?} service, so {} is refused; it declared: {}",
            method,
            if machine.declared_services().is_empty() {
                "no host services".to_string()
            } else {
                machine.declared_services().join(", ")
            }
        )));
    }
    if !service.methods.contains(&method) {
        return Err(CallError::Failure(format!(
            "the {service_name:?} service does not answer {method:?}; it answers: {}",
            service.methods.join(", ")
        )));
    }
    let args = match arguments.get("args") {
        Some(Value::Object(_)) | Some(Value::Array(_)) => arguments["args"].clone(),
        _ => Value::Object(serde_json::Map::new()),
    };
    Ok((service, method, args))
}

fn names(services: &[HostService]) -> Vec<&'static str> {
    services.iter().map(|service| service.name).collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn request(service: &str, method: &str) -> Value {
        json!({ "service": service, "method": method, "args": {} })
    }

    /// An undeclared engine is refused *before* the engine is reached — the point of the gate.
    #[test]
    fn an_undeclared_service_is_refused_by_naming_what_the_node_did_declare() {
        let machine = MachineAccess::seam_only();
        let error = resolve(&request("czkawka", "info"), &machine).expect_err("nothing was declared");
        assert!(error.message().contains("czkawka"), "{}", error.message());
        assert!(error.message().contains("no host services"), "{}", error.message());
    }

    #[test]
    fn a_declared_service_reaches_its_engine() {
        let machine = MachineAccess::seam_only().with_services(&["czkawka"]);
        let request = request("czkawka", "info");
        let (service, method, _) =
            resolve(&request, &machine).expect("declared, and the table answers it");
        assert_eq!(service.name, "czkawka");
        assert_eq!(method, "info");
    }

    /// The positive control for the two tests above: without this, "declared" and "refused" would be
    /// the same string compare read from different ends.
    #[test]
    fn a_method_the_service_does_not_publish_is_refused_with_the_published_set() {
        let machine = MachineAccess::seam_only().with_services(&["czkawka"]);
        let error =
            resolve(&request("czkawka", "scan.everything"), &machine).expect_err("no such method");
        assert!(error.message().contains("scan.everything"), "{}", error.message());
        for method in ["info", "scan.duplicates", "scan.progress", "scan.cancel"] {
            assert!(error.message().contains(method), "the refusal must list {method}: {}", error.message());
        }
    }

    #[test]
    fn an_unknown_service_names_the_whole_table() {
        let machine = MachineAccess::seam_only().with_services(&["czkawka"]);
        let error = resolve(&request("imaginary", "info"), &machine).expect_err("no such service");
        assert!(error.message().contains("czkawka"), "{}", error.message());
    }

    /// A method on the table must be a method the dispatcher actually reaches.
    ///
    /// This is the check that would have caught `scan.basic`: `resolve` reads the same table it
    /// advertises, so only dispatching proves the two ends agree. `czkawka_operations`'s own tests call
    /// its functions directly and could not see the missing publication either.
    #[test]
    fn every_published_method_reaches_the_dispatcher_that_advertises_it() {
        let machine = MachineAccess::seam_only().with_services(&["czkawka", "config"]);
        let mut host = crate::test_host::CountingHost::new();
        for service in SERVICES {
            for method in service.methods {
                if let Err(error) = (service.dispatch)(method, &json!({}), &mut host, &machine) {
                    assert!(
                        !error.message().contains("does not answer"),
                        "{} publishes {method:?} but its own dispatcher refuses it: {}",
                        service.name,
                        error.message()
                    );
                }
            }
        }
    }
}
