//! Power actions as their own host service, deliberately separate from `os`.
//!
//! ## Why a second service name
//!
//! `NodeRequirements::services` gates at service granularity, so a node granted `os` for the clipboard
//! must not be able to sleep or shut down the machine. Splitting the names is the whole reason
//! `power` exists beside `os`: "this node reads the clipboard" and "this node may end the session" are
//! different grants and are not expressible inside one table.
//!
//! ## Refusals are data, because a face has to draw three different pictures
//!
//! `request` answers `{ "ok": true }` when the machine accepted the action, and
//! `{ "ok": false, "code": ..., "message": ... }` when it did not, with `code` one of:
//! `not-supported` (this platform never has this action — grey the row out), `denied` (the OS asked the
//! user for a permission and did not get it — macOS' Automation grant is this shape, and an ad-hoc
//! signed build loses it on every rebuild), `failed` (the mechanism said no this time — logind policy,
//! a blocked session). A thrown error would collapse all three into one message and the user would get
//! "something went wrong" for a problem they can fix in System Settings.

use serde_json::{Value, json};
use xiranite_node_registry::NodeHost;

use crate::host_calls::{CallError, HostAnswer, answer, required_text};
use crate::machine::MachineAccess;
use xiranite_core::power::{self, PowerAction, PowerError};

/// The methods this service answers, spelled once here and published by the service table.
pub(crate) const METHODS: &[&str] = &["info", "request"];

/// Answers one `power` service method.
pub(crate) fn dispatch(
    method: &str,
    arguments: &Value,
    _host: &mut (dyn NodeHost + 'static),
    _machine: &MachineAccess,
) -> Result<HostAnswer, CallError> {
    match method {
        "info" => Ok(answer(info_document())),
        "request" => request(arguments),
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
    })
}

fn request(arguments: &Value) -> Result<HostAnswer, CallError> {
    let name = required_text(arguments, "action")?;
    let action = parse_action(name)?;
    let force = arguments.get("force").and_then(Value::as_bool).unwrap_or(false);
    let support = power::support();
    if !support.allows(action) {
        return Ok(answer(json!({
            "ok": false,
            "code": "not-supported",
            "message": PowerError::NotSupported { action, mechanism: support.mechanism }.to_string(),
        })));
    }
    match power::request_with(&power::SystemShutdownBackend, action, force) {
        Ok(()) => Ok(answer(json!({ "ok": true, "action": action.as_str() }))),
        Err(error @ PowerError::NotSupported { .. }) => {
            Ok(answer(json!({ "ok": false, "code": "not-supported", "message": error.to_string() })))
        }
        Err(error @ PowerError::Denied { .. }) => {
            Ok(answer(json!({ "ok": false, "code": "denied", "message": error.to_string() })))
        }
        Err(error @ PowerError::Failed { .. }) => {
            Ok(answer(json!({ "ok": false, "code": "failed", "message": error.to_string() })))
        }
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
}
