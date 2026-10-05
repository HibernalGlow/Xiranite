//! The contract `sleept`'s last lift step depends on, measured from inside a bundle.
//!
//! The switch itself moves six power modes and two machine reads out of `packages/nodes/sleept/src/platform.ts`
//! onto host services, and it can only land together with the faces going through `/operations` and the node
//! being registered (see `docs/migration/sleept-host-lift-handoff.md`). What it must not do is discover the
//! shapes at that moment: this file pins, from a realm run, what each answer looks like — so the TS side can be
//! written against evidence rather than against a guess about a JSON key.
//!
//! Every request here carries `dryRun: true`, and the one refusal that must exist without a rehearsal
//! (`hibernate` on macOS) is asserted as a *code*, not attempted. Nothing in this file can sleep, shut down, or
//! blank anything.

mod support;

use serde_json::Value;
use support::Harness;
use xiranite_core::filesystem::FileCapability;
use xiranite_core::power;
use xiranite_node_registry::{BuiltInNode, NodeDescriptor, RootAccess, RootRequirement};
use xiranite_quickjs_executor::{JsNode, JsNodeSpec, RealmRun};

/// Asks the three services the switched node will use, in the spelling `platform.ts` will use, and hands the
/// whole transcript back as the node's result document so the Rust side can assert on it.
static CONTRACT_BUNDLE: &str = r#"
function invoke(service, method, args) {
  return JSON.parse(__xrh.call("service.invoke", JSON.stringify({ service, method, args })));
}
export function run(input) {
  const cpu = invoke("os", "cpu.usage", {});
  const net = invoke("os", "net.counters", {});
  // The node's own vocabulary is the product's: `restart` is what its faces say, `reboot` is what the host
  // answers, so the mapping the switch has to preserve is asserted here rather than discovered later.
  const modes = invoke("power", "info", {});
  const byMode = {};
  for (const pair of input.modes) {
    byMode[pair[0]] = invoke("power", "request", { action: pair[1], dryRun: true });
  }
  const unknown = (() => {
    try {
      return { thrown: false, answer: invoke("power", "request", { action: "sleep", dryRun: true, extra: 1 }) };
    } catch (error) {
      return { thrown: true, message: String(error && error.message ? error.message : error) };
    }
  })();
  return {
    cpu,
    net,
    machineActions: modes.actions,
    sessionActions: (modes.sessionActions || []).map((entry) => entry.action),
    byMode,
    unknown,
  };
}
"#;

const fn budget_bytes() -> usize {
    8_388_608
}

static CONTRACT_SPEC: JsNodeSpec = JsNodeSpec::pure(
    NodeDescriptor::new("quickjs-sleept-contract", "0.1.0", 1)
        .with_roots(&[RootRequirement { role: "workspace", access: RootAccess::ReadWrite }])
        .with_services(&["os", "power"])
        .budget(budget_bytes(), 1),
    CONTRACT_BUNDLE,
    "run",
    "sleept service contract answered",
);
static CONTRACT_NODE: JsNode = JsNode::new(&CONTRACT_SPEC);
static CONTRACT_RUNNABLE: &'static dyn BuiltInNode = &CONTRACT_NODE;

xiranite_node_registry::register_node!(CONTRACT_SPEC.descriptor);
xiranite_node_registry::register_node!(CONTRACT_RUNNABLE);

/// The node's mode spellings paired with what the switched `platform.ts` will send for each.
const MODE_MAP: [(&str, &str); 6] = [
    ("sleep", "sleep"),
    ("hibernate", "hibernate"),
    ("shutdown", "shutdown"),
    ("restart", "reboot"),
    ("display-sleep", "display-sleep"),
    ("screensaver", "screensaver"),
];

fn data() -> Value {
    let harness = Harness::new("sleept-contract", "quickjs-sleept-contract");
    let mut host = harness.host();
    let pairs = MODE_MAP
        .iter()
        .map(|(mode, action)| format!("[{mode:?},{action:?}]"))
        .collect::<Vec<_>>()
        .join(",");
    let answer = RealmRun::new(CONTRACT_SPEC.descriptor, CONTRACT_SPEC.plan())
        .expect("the spec declares a budget")
        .with_files(FileCapability::new(vec![harness.root.path()]))
        .run(&format!(r#"{{"modes":[{pairs}]}}"#), &mut host)
        .expect("the contract run answers a document");
    let envelope: Value = serde_json::from_str(&answer).expect("the answer is JSON");
    assert_eq!(envelope["success"], true, "{envelope}");
    envelope["data"].clone()
}

/// The CPU question the node asks each `status` tick. `os.cpus` (the realm's shim) answers `{count, models}`
/// with no per-cpu `times`, which is the whole reason `cpu.usage` exists — so the answer has to carry a busy
/// figure over a named window, or the node cannot tell "idle" from "not measured".
#[test]
fn cpu_usage_answers_a_busy_figure_over_a_window_the_node_can_check() {
    let data = data();
    let cpu = &data["cpu"];
    let busy = cpu["busyPercent"].as_f64().expect("busyPercent is a number");
    assert!((0.0..=100.0).contains(&busy), "busy percent is a percentage: {cpu}");
    let window = cpu["windowMs"].as_u64().expect("windowMs is the window this figure covers");
    assert!(window > 0, "a zero window reads as idle to a power trigger: {cpu}");
    let per_core = cpu["perCore"].as_array().expect("per-core figures");
    assert!(!per_core.is_empty(), "the machine has at least one core: {cpu}");
    for usage in per_core {
        let usage = usage.as_f64().expect("each core answers a number");
        assert!((0.0..=100.0).contains(&usage), "per-core is a percentage too: {cpu}");
    }
}

/// The traffic question behind `netspeed`. Sorted, unique names is the promise `xiranite-core::network` makes;
/// an empty list is a real possible answer on a quiet container, so the assertion is about shape and ordering,
/// not about this machine having moved bytes.
#[test]
fn net_counters_answers_interfaces_with_the_four_counters_the_node_sums() {
    let data = data();
    let interfaces = data["net"]["interfaces"].as_array().expect("a list per interface");
    let mut names: Vec<&str> = interfaces.iter().map(|entry| entry["name"].as_str().expect("named interface")).collect();
    let sorted = names.clone();
    names.sort_unstable();
    assert_eq!(names, sorted, "the list is sorted so two samples agree on order: {data}");
    names.dedup();
    assert_eq!(names.len(), interfaces.len(), "one entry per interface, or a sum double-counts: {data}");
    for entry in interfaces {
        for counter in ["receivedTotal", "transmittedTotal", "receivedSinceLastSample", "transmittedSinceLastSample"] {
            assert!(entry[counter].is_number(), "{counter} must be a number for the node to difference it: {entry}");
        }
    }
    assert!(data["net"]["truncated"].is_boolean(), "the truncation flag is part of the answer: {data}");
}

/// Every mode the three faces offer has an answer, in the vocabulary the product already uses, and none of
/// them is silently substituted — which is the property `platform.test.ts` pins on the TypeScript side and
/// which the switch must not lose by routing through a host table.
#[test]
fn each_node_mode_maps_to_a_service_answer_that_names_the_same_mode() {
    let data = data();
    let support = power::support();
    let by_mode = data["byMode"].as_object().expect("one answer per mode");
    assert_eq!(by_mode.len(), MODE_MAP.len(), "{by_mode:?}");

    for (mode, action) in MODE_MAP {
        let answer = &by_mode[mode];
        assert_eq!(answer["action"], action, "{mode} must be answered under the name the mapping states: {answer}");
        // The service's two arms carry different fields, and this test states which: an accepted request echoes
        // `force` and `dryRun` because it is a receipt for what was asked, while a refusal answers the action,
        // the code and the mechanism's words. Pinning the asymmetry here is what stops the switched node from
        // reading a field that is only there half the time.
        if support.allows(power::PowerAction::Hibernate) || mode != "hibernate" {
            assert_eq!(answer["ok"], true, "{mode} rehearses clean on this platform: {answer}");
            assert_eq!(answer["dryRun"], true, "a receipt says which arm ran: {answer}");
        } else {
            assert_eq!(answer["code"], "not-supported", "macOS hibernate stays a refusal, not a sleep: {answer}");
            assert!(answer["message"].as_str().expect("the refusal explains itself").contains(action), "{answer}");
        }
    }

    // The document a face renders has to carry the two screen arms beside the machine states, or the switch
    // would have to hard-code what the host just told it.
    let listed = data["sessionActions"].as_array().expect("session arms published by info");
    assert!(listed.iter().any(|entry| entry == "display-sleep"), "{listed:?}");
    assert!(listed.iter().any(|entry| entry == "screensaver"), "{listed:?}");
}

/// The stray-key discipline the node's `dryrun` spelling depends on: an argument the service does not read is
/// refused, so a rehearsal that is silently not a rehearsal cannot happen on the way through the switch.
#[test]
fn an_extra_argument_on_a_rehearsal_is_refused_rather_than_ignored() {
    let data = data();
    assert_eq!(data["unknown"]["thrown"], true, "the refusal is an error, not an ok: {}", data["unknown"]);
    let message = data["unknown"]["message"].as_str().expect("the refusal carries text");
    assert!(message.contains("extra"), "it names the key: {message}");
}
