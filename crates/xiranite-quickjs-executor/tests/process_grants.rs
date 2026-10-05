//! The external-program grant, end to end: manifest-shaped data → `NodeDescriptor::with_processes` →
//! `proc.exec` in a real QuickJS realm → a real `std::process` spawn.
//!
//! Why this exists as its own test: `docs/xiranite-target-node-manifest.json` now carries `programs` and
//! `scripts/audit-target-node-manifest.ts` refuses a silent `external-process` tier, but nothing proved the
//! **consumer** side reads the grant. The failure mode this rules out is a chain where a correctly filled
//! manifest still cannot run 7-Zip, and every layer blames the next one. Each case below states which answer
//! distinguishes it, because three different refusals that all read as "denied" would prove nothing.
//!
//! The three states, each asserted to be *different from* the others:
//! 1. not granted → the host's allowlist refuses, and nothing is spawned;
//! 2. granted but absent from `PATH` → the spawn itself fails (so the grant really did reach `std::process`);
//! 3. granted and present (`echo`, which exists on both macOS and Windows Git-Bash images) → exit code 0 with
//!    the program's own stdout, i.e. the realm ran an external program.
//!
//! The program is named without a path separator on purpose: `proc_operations.rs:119-131` rejects a name
//! containing `/` or `\`, so the allowlist is a name table, exactly what the manifest column now is.

mod support;

use support::Harness;

use xiranite_node_registry::{
    NodeDescriptor, ProcessGrant, RootAccess, RootRequirement,
};
use xiranite_quickjs_executor::{EntryPlan, Executor};

/// Asks the host to run whatever the request names, and reports either the answer or the refusal text.
///
/// `input` arrives already parsed (`engine.rs:264`), so the bundle reads fields rather than JSON-parsing
/// its own argument — the mistake this file originally made, which QuickJS reported as
/// `unexpected token: 'object'` when handed the string form of `[object Object]`.
const PROCEXEC_BUNDLE: &str = r#"
export function run(input) {
  try {
    const answer = globalThis.__xrh.call("proc.exec", JSON.stringify({
      program: input.program,
      args: input.args || [],
    }));
    return { ran: true, answer: JSON.parse(answer) };
  } catch (error) {
    return { ran: false, refusal: String((error && error.message) || error) };
  }
}
"#;

fn descriptor(id: &'static str, processes: &'static [ProcessGrant]) -> NodeDescriptor {
    NodeDescriptor::new(id, "0.1.0", 1)
        .with_roots(&[RootRequirement { role: "workspace", access: RootAccess::ReadWrite }])
        .with_processes(processes)
        .budget(8 * 1024 * 1024, 1)
}

fn run_exec(
    tag: &str,
    id: &'static str,
    processes: &'static [ProcessGrant],
    program: &str,
    args: &str,
) -> serde_json::Value {
    let harness = Harness::new(tag, id);
    let mut host = harness.host();
    let request = format!(r#"{{"program":"{program}","args":{args}}}"#);
    let document = Executor::new(
        descriptor(id, processes),
        EntryPlan {
            bundle_name: id,
            source: PROCEXEC_BUNDLE,
            run_export: "run",
            create_runtime_export: None,
            pure_message: "unused for a platform-shaped assertion",
        },
    )
    .expect("the descriptor declares a budget")
    .run(&request, &mut host)
    .expect("the run answers a document");
    serde_json::from_str(&document).expect("the envelope is JSON")
}

#[test]
fn a_program_the_registration_does_not_name_is_refused_before_anything_spawns() {
    let granted: &[ProcessGrant] = &[];
    let value = run_exec(
        "grant-none",
        "quickjs-test.grant-none",
        granted,
        "echo",
        r#"["xiranite-not-run"]"#,
    );
    let data = &value["data"];
    assert_eq!(data["ran"], false, "an ungranted program must not run: {value}");
    let refusal = data["refusal"].as_str().unwrap_or_default().to_lowercase();
    assert!(
        refusal.contains("allowlist") || refusal.contains("refused") || refusal.contains("permission"),
        "the refusal must be the host's allowlist answer, got {refusal:?}"
    );
    assert!(
        !refusal.contains("no such file") && !refusal.contains("not found"),
        "an allowlist refusal must not be a failed spawn, or the two states are indistinguishable: {refusal:?}"
    );
}

#[test]
fn a_granted_name_reaches_the_spawn_even_when_the_program_is_absent() {
    let granted: &[ProcessGrant] = &[ProcessGrant {
        program: "xiranite-grant-probe-absent",
        confirm_before_run: false,
    }];
    let value = run_exec(
        "grant-absent",
        "quickjs-test.grant-absent",
        granted,
        "xiranite-grant-probe-absent",
        "[]",
    );
    let data = &value["data"];
    let refusal = data["refusal"].as_str().unwrap_or_default().to_lowercase();
    // The grant is the only difference between this test and the one above, so the answer must be a
    // *different* refusal: the gate let the name through and `Command::output` reported the OS
    // (`proc_operations.rs:159-161`), which is the text "the allowlist did not stop it" rests on.
    assert!(
        !refusal.contains("allowlist"),
        "a granted name must not be refused by the allowlist: {refusal:?}"
    );
    assert_eq!(data["ran"], false, "an absent program cannot have run: {value}");
    assert!(
        refusal.contains("could not start"),
        "the spawn failure must be reported as the spawn's own answer, got {refusal:?}"
    );
    assert!(
        refusal.contains("xiranite-grant-probe-absent"),
        "and it must name the program the realm asked for: {refusal:?}"
    );
}

#[test]
fn a_granted_and_present_program_runs_and_its_stdout_comes_back() {
    let granted: &[ProcessGrant] = &[ProcessGrant {
        program: "echo",
        confirm_before_run: false,
    }];
    let value = run_exec(
        "grant-present",
        "quickjs-test.grant-present",
        granted,
        "echo",
        r#"["xiranite-ran"]"#,
    );
    let data = &value["data"];
    assert_eq!(data["ran"], true, "the realm must have run the program: {value}");
    let answer = &data["answer"];
    assert_eq!(answer["exitCode"], 0, "{answer}");
    assert_eq!(answer["success"], true, "{answer}");
    assert!(
        answer["stdout"].as_str().unwrap_or_default().contains("xiranite-ran"),
        "the program's own output has to come back, got {answer}"
    );
}
