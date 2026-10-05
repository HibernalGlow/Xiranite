//! Power actions as their own host service, deliberately separate from `os`.
//!
//! ## Why a second service name
//!
//! `NodeRequirements::services` gates at service granularity, so a node granted `os` for the clipboard
//! must not be able to sleep or shut down the machine. Splitting the names is the whole reason
//! `power` exists beside `os`: "this node reads the clipboard" and "this node may end the session" are
//! different grants and are not expressible inside one table.
//!
//! ## Refusals are data, because a face has to draw four different pictures
//!
//! `request` answers `{ "ok": true }` when the machine accepted the action, and
//! `{ "ok": false, "code": ..., "message": ... }` when it did not, with `code` one of:
//! `not-supported` (this platform never has this action — grey the row out), `force-not-supported` (the
//! action is here but a forced version of it is not — grey the checkbox out), `denied` (the OS asked the
//! user for a permission and did not get it — macOS' Automation grant is this shape, and an ad-hoc
//! signed build loses it on every rebuild), `failed` (the mechanism said no this time — logind policy,
//! a blocked session). A thrown error would collapse all four into one message and the user would get
//! "something went wrong" for a problem they can fix in System Settings.
//!
//! ## `dryRun` is an arm of this service, and an unknown argument is a refusal
//!
//! `sleept` already ships a control whose own help text is "Simulate the power action without changing
//! system state" (`packages/nodes/sleept/src/i18n.ts:49`), so the host has to have a simulation arm or
//! that control is a lie on the QuickJS path. It is spelled `{ "action": …, "dryRun": true }` and only
//! that way, because **a request argument this service does not read is refused rather than defaulted**:
//! measured here, a probe that sent `dryRun: true` to a host without the arm had the flag ignored and the
//! machine went to sleep anyway — one second of `Software Sleep` in `pmset -g log`. The same discipline
//! rejects a non-boolean `force`, which the previous `and_then(as_bool).unwrap_or(false)` reading turned
//! into a plain unforced request.

use serde_json::{Value, json};
use xiranite_node_registry::NodeHost;

use crate::host_calls::{CallError, HostAnswer, answer, required_text};
use crate::machine::MachineAccess;
use xiranite_core::power::{self, PowerAction, PowerError};

/// The methods this service answers, spelled once here and published by the service table.
pub(crate) const METHODS: &[&str] = &["info", "request"];

/// The argument names `request` reads, so a stray key can be named against a list instead of guessed.
const ARGUMENTS: &[&str] = &["action", "force", "dryRun"];

/// Answers one `power` service method.
pub(crate) fn dispatch(
    method: &str,
    arguments: &Value,
    _host: &mut (dyn NodeHost + 'static),
    _machine: &MachineAccess,
) -> Result<HostAnswer, CallError> {
    match method {
        "info" => Ok(answer(info_document())),
        "request" => request(arguments, &power::SystemShutdownBackend),
        other => Err(CallError::Failure(format!(
            "the power service does not answer {other:?}; it answers: {}",
            METHODS.join(", ")
        ))),
    }
}

fn info_document() -> Value {
    let support = power::support();
    json!({
        "service": "power",
        "mechanism": support.mechanism,
        "permissionNote": support.permission_note,
        "actions": support.supported_actions().iter().map(|action| action.as_str()).collect::<Vec<_>>(),
        "unsupportedActions": power::ALL_ACTIONS
            .iter()
            .filter(|action| !support.allows(**action))
            .map(|action| action.as_str())
            .collect::<Vec<_>>(),
        // What `force: true` means per action here, so a face can grey the checkbox out instead of
        // offering a control that does nothing (`same-call`) or fails with a kernel error (`unavailable`).
        "forceRoutes": power::ALL_ACTIONS
            .iter()
            .map(|action| (action.as_str().to_string(), json!(support.force_route(*action).as_str())))
            .collect::<serde_json::Map<_, _>>(),
    })
}

/// The live arm: `request` against the mechanism this platform actually has.
fn request(
    arguments: &Value,
    live: &dyn power::PowerBackend,
) -> Result<HostAnswer, CallError> {
    let name = required_text(arguments, "action")?;
    let action = parse_action(name)?;
    reject_stray_arguments(arguments)?;
    let force = flag(arguments, "force")?;
    let dry_run = flag(arguments, "dryRun")?;
    // One policy path for both arms — the gate, the routing and the classification stay the live ones and
    // only the mechanism is swapped, so a simulation cannot drift from what the real request would do.
    let backend: &dyn power::PowerBackend = if dry_run { &power::DryRunBackend } else { live };
    match power::request_with(backend, action, force) {
        Ok(()) => Ok(answer(json!({
            "ok": true,
            "action": action.as_str(),
            "force": force,
            "dryRun": dry_run,
        }))),
        Err(error @ PowerError::NotSupported { .. }) => {
            Ok(answer(json!({ "ok": false, "code": "not-supported", "message": error.to_string() })))
        }
        Err(error @ PowerError::ForceUnsupported { .. }) => {
            Ok(answer(json!({ "ok": false, "code": "force-not-supported", "message": error.to_string() })))
        }
        Err(error @ PowerError::Denied { .. }) => {
            Ok(answer(json!({ "ok": false, "code": "denied", "message": error.to_string() })))
        }
        Err(error @ PowerError::Failed { .. }) => {
            Ok(answer(json!({ "ok": false, "code": "failed", "message": error.to_string() })))
        }
    }
}

/// A key outside [`ARGUMENTS`] is a refusal, because spelling the simulation flag is the only way a caller
/// can say "do not change my machine", and a default would answer that question by changing it.
fn reject_stray_arguments(arguments: &Value) -> Result<(), CallError> {
    if let Value::Object(map) = arguments
        && let Some((key, _)) = map.iter().find(|(key, _)| !ARGUMENTS.contains(&key.as_str()))
    {
        return Err(CallError::Failure(format!(
            "the power service does not read the argument {key:?}; a request may name: {}",
            ARGUMENTS.join(", ")
        )));
    }
    Ok(())
}

/// A boolean argument, refused rather than defaulted when the caller sent something else.
fn flag(arguments: &Value, key: &str) -> Result<bool, CallError> {
    match arguments.get(key) {
        None | Some(Value::Null) => Ok(false),
        Some(Value::Bool(value)) => Ok(*value),
        Some(other) => Err(CallError::Failure(format!(
            "the power service needs `{key}` to be a boolean, and it was {other}"
        ))),
    }
}

fn parse_action(name: &str) -> Result<PowerAction, CallError> {
    power::ALL_ACTIONS
        .into_iter()
        .find(|action| action.as_str() == name)
        .ok_or_else(|| CallError::Failure(format!(
            "unknown power action {name:?}; this host knows: {}",
            power::ALL_ACTIONS.iter().map(|action| action.as_str()).collect::<Vec<_>>().join(", ")
        )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::machine::MachineAccess;

    fn call(method: &str, arguments: Value) -> Result<String, String> {
        let mut host = crate::test_host::CountingHost::new();
        let machine = MachineAccess::seam_only();
        match dispatch(method, &arguments, &mut host, &machine) {
            Ok(HostAnswer::Text(text)) => Ok(text),
            Ok(HostAnswer::Bytes(_)) => Err("the power service never answers bytes".to_string()),
            Err(error) => Err(error.message().to_string()),
        }
    }

    /// The point of the split: this service is the one that may end a session, and `info` is what a face
    /// renders before offering it.
    #[test]
    fn info_partitions_the_actions_without_touching_the_machine() {
        let text = call("info", json!({})).expect("info never runs a mechanism");
        let document: Value = serde_json::from_str(&text).expect("info is JSON");
        let supported = document["actions"].as_array().expect("a list of supported actions");
        let unsupported = document["unsupportedActions"].as_array().expect("a list of the rest");
        assert_eq!(supported.len() + unsupported.len(), power::ALL_ACTIONS.len());
        let support = power::support();
        assert_eq!(document["mechanism"], json!(support.mechanism));
        if cfg!(target_os = "macos") {
            assert!(unsupported.contains(&json!("hibernate")), "macOS has no hibernate upstream");
            assert!(document["permissionNote"].as_str().unwrap().contains("Automation"));
        } else {
            assert!(supported.contains(&json!("hibernate")));
        }
    }

    #[test]
    fn an_unknown_action_is_refused_with_the_names_this_host_knows() {
        let error = call("request", json!({ "action": "defenestrate" })).expect_err("not an action");
        assert!(error.contains("defenestrate"), "{error}");
        for action in power::ALL_ACTIONS {
            assert!(error.contains(action.as_str()), "the refusal must name {action:?}: {error}");
        }
    }

    /// `hibernate` on macOS must be refused by the table before any mechanism runs; on a platform that
    /// supports every action there is no refusal to observe, and the partition test above still pins the
    /// table. The assertion is written against whichever action the running platform lacks, so it does
    /// not quietly become a no-op if a fourth platform gains one.
    #[test]
    fn an_unsupported_action_answers_data_and_never_reaches_the_mechanism() {
        let support = power::support();
        let Some(action) = power::ALL_ACTIONS.into_iter().find(|action| !support.allows(*action)) else {
            return;
        };
        let document: Value = serde_json::from_str(&call("request", json!({ "action": action.as_str() })).unwrap())
            .expect("a refusal is still JSON");
        assert_eq!(document["ok"], json!(false));
        assert_eq!(document["code"], json!("not-supported"));
        assert!(document["message"].as_str().unwrap().contains(action.as_str()), "{document}");
    }

    #[test]
    fn a_missing_action_is_refused() {
        let error = call("request", json!({})).expect_err("nothing named");
        assert!(error.contains("action"), "{error}");
    }

    /// A backend that reports having been reached, so "the mechanism did not run" is a count and not a
    /// reading of the answer. It fails on purpose: a dry run must still answer `ok`, which is only true if
    /// it never got here.
    struct Recorder {
        calls: std::cell::Cell<usize>,
    }

    impl power::PowerBackend for Recorder {
        fn run(&self, _action: PowerAction, _force: bool) -> std::io::Result<()> {
            self.calls.set(self.calls.get() + 1);
            Err(std::io::Error::other("the mechanism was reached"))
        }
    }

    fn answered(arguments: Value, backend: &dyn power::PowerBackend) -> Result<Value, String> {
        match request(&arguments, backend) {
            Ok(HostAnswer::Text(text)) => {
                serde_json::from_str(&text).map_err(|error| format!("answer was not JSON: {error}"))
            }
            Ok(HostAnswer::Bytes(_)) => Err("the power service never answers bytes".to_string()),
            Err(error) => Err(error.message().to_string()),
        }
    }

    /// The arm `sleept`'s own help text promises: same gates, same routing, no state change. The second
    /// half of this test is what makes the first half a measurement — without the live call below, a
    /// backend that always ran would still answer `ok`.
    #[test]
    fn a_dry_run_passes_the_live_gates_without_reaching_a_mechanism() {
        let recorder = Recorder { calls: std::cell::Cell::new(0) };
        let Some(action) = power::support().supported_actions().first().copied() else {
            panic!("every supported platform answers at least one power action");
        };
        let dry = answered(json!({ "action": action.as_str(), "dryRun": true }), &recorder)
            .expect("a supported action simulates");
        assert_eq!(dry["ok"], json!(true), "{dry}");
        assert_eq!(dry["action"], json!(action.as_str()), "{dry}");
        assert_eq!(dry["dryRun"], json!(true), "the answer says which arm ran: {dry}");
        assert_eq!(recorder.calls.get(), 0, "a simulation must never reach a mechanism");

        let live = answered(json!({ "action": action.as_str() }), &recorder).expect("a refusal is still data");
        assert_eq!(live["ok"], json!(false), "{live}");
        assert_eq!(live["code"], json!("failed"), "the recorder always reports reaching it: {live}");
        assert_eq!(recorder.calls.get(), 1, "only the live call reached it");
    }

    /// A stray key is the dangerous case, not a style case: `dryrun` is the spelling `sleept`'s own
    /// interaction uses, and reading it as "no simulation requested" answers a safety question by taking
    /// the action.
    #[test]
    fn an_argument_this_service_does_not_read_is_refused_instead_of_defaulted() {
        let recorder = Recorder { calls: std::cell::Cell::new(0) };
        let error = answered(json!({ "action": "sleep", "dryrun": true }), &recorder)
            .expect_err("lowercase is not the vocabulary");
        assert!(error.contains("dryrun"), "the refusal must name the key it rejected: {error}");
        assert!(error.contains("dryRun"), "and the spelling it does read: {error}");
        assert_eq!(recorder.calls.get(), 0, "a refused argument is refused before any mechanism");

        let error = answered(json!({ "action": "sleep", "force": "yes" }), &recorder)
            .expect_err("a string is not a boolean");
        assert!(error.contains("force"), "{error}");
        assert_eq!(recorder.calls.get(), 0);
    }

    /// `force` is a second axis, and on macOS two of the three session-ending actions have no forced arm
    /// upstream. Without the gate the caller reaches a mechanism that cannot exist here and is told the
    /// machine is missing a file.
    #[test]
    fn a_force_this_platform_has_no_arm_for_is_its_own_answer() {
        let recorder = Recorder { calls: std::cell::Cell::new(0) };
        let support = power::support();
        let Some(action) = power::ALL_ACTIONS.into_iter().find(|action| {
            support.allows(*action) && support.force_route(*action) == power::ForceRoute::Unavailable
        }) else {
            return;
        };
        let document = answered(json!({ "action": action.as_str(), "force": true }), &recorder)
            .expect("a refusal is still data");
        assert_eq!(document["ok"], json!(false), "{document}");
        assert_eq!(document["code"], json!("force-not-supported"), "{document}");
        assert_eq!(recorder.calls.get(), 0, "the unforced arm must not run either: {document}");

        // The same action without the flag is a different answer, so this is a gate on `force` alone.
        let document = answered(json!({ "action": action.as_str() }), &recorder).expect("live is data too");
        assert_eq!(document["code"], json!("failed"), "this recorder always reaches the mechanism");
        assert_eq!(recorder.calls.get(), 1);
    }

    /// A face greys out the checkbox from this document, so the route of every action has to be in it.
    #[test]
    fn info_publishes_a_force_route_for_every_action() {
        let document: Value =
            serde_json::from_str(&call("info", json!({})).expect("info never runs a mechanism"))
                .expect("info is JSON");
        let routes = document["forceRoutes"].as_object().expect("a route per action");
        assert_eq!(routes.len(), power::ALL_ACTIONS.len());
        let support = power::support();
        for action in power::ALL_ACTIONS {
            assert_eq!(
                routes[action.as_str()],
                json!(support.force_route(action).as_str()),
                "{action:?} must be published as the table states"
            );
        }
        if cfg!(target_os = "macos") {
            assert_eq!(routes["logout"], json!("distinct"), "macOS forces logout through loginwindow");
            assert_eq!(routes["shutdown"], json!("unavailable"), "upstream's macOS force_shutdown is not_implemented");
            assert_eq!(routes["sleep"], json!("same-call"));
        }
    }
}
