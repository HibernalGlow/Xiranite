//! The two screen-level power arms reached the way a product bundle reaches them: through
//! `service.invoke`, on a node that declared the `power` service, with the run rehearsal rather than the
//! mechanism.
//!
//! Why this is a separate file from `power_operations.rs`'s own unit tests: those call `dispatch`, so they
//! cannot see the grant. The node that matters here is `sleept`, whose six power actions are the reason the
//! service exists — and its lift turns on a bundle being able to say `display-sleep` and get an answer without
//! a program on its allowlist. Every test below says how it would also pass had nothing run.
//!
//! Nothing here blanks a panel or starts a saver: the live arms are covered by the unit tests that inject a
//! recorder, because "verify the display arm" and "blank the operator's screen" are not the same sentence.

mod support;

use serde_json::Value;
use support::Harness;
use xiranite_core::filesystem::FileCapability;
use xiranite_core::power::{self};
use xiranite_core::power_session::{self, SessionPowerAction};
use xiranite_node_registry::{BuiltInNode, NodeDescriptor, RootAccess, RootRequirement};
use xiranite_quickjs_executor::{JsNode, JsNodeSpec, RealmRun};

/// A scripted node that asks the `power` service everything a face can ask without changing the machine:
/// the capability document, one rehearsal per screen arm, the forced form of one of them, and a name that
/// is not an action at all.
static POWER_BUNDLE: &str = r#"
function invoke(method, args) {
  return JSON.parse(__xrh.call("service.invoke", JSON.stringify({ service: "power", method, args })));
}
export function run() {
  const info = invoke("info", {});
  const unknown = (() => {
    try {
      return { thrown: false, answer: invoke("request", { action: "defenestrate" }) };
    } catch (error) {
      return { thrown: true, message: String(error && error.message ? error.message : error) };
    }
  })();
  return {
    actions: info.actions,
    sessionActions: info.sessionActions,
    displaySleep: invoke("request", { action: "display-sleep", dryRun: true }),
    screensaver: invoke("request", { action: "screensaver", dryRun: true }),
    forcedSaver: invoke("request", { action: "screensaver", force: true }),
    strayKey: (() => {
      try {
        return { thrown: false, answer: invoke("request", { action: "display-sleep", dryrun: true }) };
      } catch (error) {
        return { thrown: true, message: String(error && error.message ? error.message : error) };
      }
    })(),
    unknown,
  };
}
"#;

const fn budget_bytes() -> usize {
    8_388_608
}

static POWER_SPEC: JsNodeSpec = JsNodeSpec::pure(
    NodeDescriptor::new("quickjs-power-session", "0.1.0", 1)
        .with_roots(&[RootRequirement { role: "workspace", access: RootAccess::ReadWrite }])
        .with_services(&["power"])
        .budget(budget_bytes(), 1),
    POWER_BUNDLE,
    "run",
    "power session arms answered",
);
static POWER_NODE: JsNode = JsNode::new(&POWER_SPEC);
static POWER_RUNNABLE: &'static dyn BuiltInNode = &POWER_NODE;

xiranite_node_registry::register_node!(POWER_SPEC.descriptor);
xiranite_node_registry::register_node!(POWER_RUNNABLE);

/// The same bundle on a node that declared nothing: `power` is the grant that may end a session, so the
/// registration is the gate and not the vocabulary.
static UNGRANTED_SPEC: JsNodeSpec = JsNodeSpec::pure(
    NodeDescriptor::new("quickjs-power-session-ungranted", "0.1.0", 1)
        .with_roots(&[RootRequirement { role: "workspace", access: RootAccess::ReadWrite }])
        .budget(budget_bytes(), 1),
    POWER_BUNDLE,
    "run",
    "must never run",
);
static UNGRANTED_NODE: JsNode = JsNode::new(&UNGRANTED_SPEC);
static UNGRANTED_RUNNABLE: &'static dyn BuiltInNode = &UNGRANTED_NODE;

xiranite_node_registry::register_node!(UNGRANTED_SPEC.descriptor);
xiranite_node_registry::register_node!(UNGRANTED_RUNNABLE);

fn granted_run(spec: &'static JsNodeSpec, root: &std::path::Path) -> RealmRun<'static> {
    let granted: Vec<&std::path::Path> = vec![root];
    RealmRun::new(spec.descriptor, spec.plan())
        .expect("the spec declares a budget")
        .with_files(FileCapability::new(granted))
}

fn data_of(harness_tag: &str, node_id: &str, spec: &'static JsNodeSpec) -> Value {
    let harness = Harness::new(harness_tag, node_id);
    let mut host = harness.host();
    let answer = granted_run(spec, harness.root.path())
        .run("{}", &mut host)
        .expect("the run travels as the node's own document");
    let envelope: Value = serde_json::from_str(&answer).expect("the answer is JSON");
    assert_eq!(envelope["success"], true, "{envelope}");
    envelope["data"].clone()
}

#[test]
fn a_bundle_rehearses_both_screen_arms_through_the_service() {
    let data = data_of("power-session-arms", "quickjs-power-session", &POWER_SPEC);
    let support = power::support();

    for (field, action) in [("displaySleep", SessionPowerAction::DisplaySleep), ("screensaver", SessionPowerAction::Screensaver)] {
        let answer = &data[field];
        assert_eq!(answer["ok"], true, "{action:?} rehearsal: {answer}");
        assert_eq!(answer["action"], action.as_str(), "{answer}");
        assert_eq!(answer["dryRun"], true, "the answer says which arm ran: {answer}");
        assert_eq!(answer["session"], true, "a screen arm is not a machine state: {answer}");
    }

    // The positive control on the document the face reads: the arms it lists are this platform's own table,
    // with the mechanism a log line would name.
    let listed = data["sessionActions"].as_array().expect("a list of session arms");
    let expected: Vec<Value> = power_session::supported_session_actions(support.platform)
        .into_iter()
        .map(|action| {
            let plan = power_session::plan_for(support.platform, action).expect("supported means a plan");
            serde_json::json!({ "action": action.as_str(), "mechanism": plan.mechanism })
        })
        .collect();
    assert_eq!(*listed, expected, "info must publish the table the request arm actually uses");
    assert_eq!(listed.len(), 2, "both screen arms are answered on every supported platform: {listed:?}");
}

/// `force` is not a stronger version of these two, and the answer has to say so rather than blank the panel
/// and report success — the mistake the machine states already documented once.
#[test]
fn a_forced_screen_action_is_refused_through_the_service_too() {
    let data = data_of("power-session-force", "quickjs-power-session", &POWER_SPEC);
    let forced = &data["forcedSaver"];
    assert_eq!(forced["ok"], false, "{forced}");
    assert_eq!(forced["code"], "force-not-supported", "{forced}");

    // The same request without the flag is a rehearsal that answers ok, so this is a gate on `force` alone.
    assert_eq!(data["screensaver"]["ok"], true, "{} vs {}", data["screensaver"], forced);
}

#[test]
fn an_unknown_action_names_the_machine_states_and_the_screen_arms_together() {
    let data = data_of("power-session-unknown", "quickjs-power-session", &POWER_SPEC);
    assert_eq!(data["unknown"]["thrown"], true, "the service refuses rather than answering ok: {}", data["unknown"]);
    let message = data["unknown"]["message"].as_str().expect("the refusal carries text");
    for name in power::ALL_ACTIONS {
        assert!(message.contains(name.as_str()), "the refusal must list {name:?}: {message}");
    }
    for name in power_session::ALL_SESSION_ACTIONS {
        assert!(message.contains(name.as_str()), "and the screen arms the node can ask for instead: {message}");
    }
}

/// The safety question is asked by the flag's spelling, so a lowercase `dryrun` is a refusal — read as "no
/// rehearsal requested" it would answer by blanking the display.
#[test]
fn a_stray_argument_on_a_screen_arm_is_refused_not_defaulted() {
    let data = data_of("power-session-stray", "quickjs-power-session", &POWER_SPEC);
    assert_eq!(data["strayKey"]["thrown"], true, "{}", data["strayKey"]);
    let message = data["strayKey"]["message"].as_str().expect("the refusal carries text");
    assert!(message.contains("dryrun"), "the refusal names the key it rejected: {message}");
    assert!(message.contains("dryRun"), "and the spelling it does read: {message}");
}

#[test]
fn a_node_that_declared_no_power_service_is_refused_before_any_mechanism() {
    let harness = Harness::new("power-session-ungranted", "quickjs-power-session-ungranted");
    let mut host = harness.host();
    let answer = granted_run(&UNGRANTED_SPEC, harness.root.path())
        .run("{}", &mut host)
        .expect("the refusal travels as the node's own document");
    let envelope: Value = serde_json::from_str(&answer).expect("the refusal is JSON");
    assert_eq!(envelope["success"], false, "an undeclared service must not be answered: {envelope}");
    let message = envelope["message"].as_str().expect("a refusal carries text");
    assert!(message.contains("power"), "the refusal names the missing declaration: {message}");
}
