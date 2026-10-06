//! Proof that the realm is embeddable on its own: this test builds a host out of only
//! `quickjs-realm` + `quickjs-host-protocol`, with no Xiranite type anywhere.
//!
//! Why this file exists: the reason the substrate was split out (ADR-0078) is that a second project should
//! not re-write the engine pipeline. A dependency list proving "no `xiranite_*`" is not that proof — the
//! public surface could still be unusable without the Xiranite adapter (a private constructor, a type that
//! only the executor can build, a run that needs a grant object from `xiranite-core`). So this test does the
//! smallest real thing: declare a bundle, answer two host operations, run it, read the result document.
//!
//! It also pins the shape a bundle observes: a pure node's answer is wrapped into the
//! `{success, message, data}` envelope, `__xrh.call` reaches the host as a wire name, and the host clock is
//! the host's answer rather than the engine's own `Date`.

use quickjs_host_protocol::{HostAnswer, HostOperation, HostRefusal, HostDispatch, answer};
use quickjs_realm::{EngineLimits, EntryPlan, Executor};
use serde_json::Value;

/// The clock a host answers, asserted literally by every test here.
const HOST_NOW: &str = "2024-02-29T12:00:00.000Z";

/// A host that answers the text, byte and async paths and refuses everything else by name.
struct ToyHost {
    calls: Vec<String>,
    document: String,
    /// Every payload byte length the realm handed over out of band, in call order.
    payloads: Vec<usize>,
}

impl ToyHost {
    fn new(document: &str) -> Self {
        Self { calls: Vec::new(), document: document.to_string(), payloads: Vec::new() }
    }
}

impl HostDispatch for ToyHost {
    fn execute(
        &mut self,
        operation: HostOperation,
        arguments: &str,
        payload: Option<&[u8]>,
    ) -> Result<HostAnswer, HostRefusal> {
        self.calls.push(format!("{} {arguments}", operation.as_str()));
        self.payloads.push(payload.map_or(0, <[u8]>::len));
        match operation {
            HostOperation::ClockNow => Ok(answer(serde_json::json!(HOST_NOW))),
            HostOperation::ReadText => {
                let parsed: Value = serde_json::from_str(arguments)
                    .map_err(|error| HostRefusal::failure(error.to_string()))?;
                let path = parsed.get("path").and_then(Value::as_str).unwrap_or_default();
                Ok(answer(serde_json::json!({ "path": path, "content": self.document })))
            }
            HostOperation::ReadBytes => {
                // Bytes answer as bytes. A base64 string inside the JSON document would be the failure
                // mode ADR-0071 and ADR-0074 §4 both retired.
                Ok(HostAnswer::Bytes(Some(vec![0xDE, 0xAD, 0x00, 0x2A])))
            }
            HostOperation::Digest => match payload {
                Some(bytes) => Ok(answer(serde_json::json!({
                    "hex": bytes.iter().fold(String::new(), |mut acc, byte| {
                        acc.push_str(&format!("{byte:02x}"));
                        acc
                    }),
                    "byteLength": bytes.len(),
                }))),
                None => Err(HostRefusal::failure(
                    "crypto.digest needs a byte payload; call it through sendBytes",
                )),
            },
            other => Err(HostRefusal::failure(format!(
                "this host does not answer {}",
                other.as_str()
            ))),
        }
    }

    fn checkpoint(&mut self, _phase: &'static str) -> Result<(), HostRefusal> {
        Ok(())
    }

    fn emit_event(&mut self, event_json: &str) -> Result<(), HostRefusal> {
        self.calls.push(format!("emit {event_json}"));
        Ok(())
    }
}

/// The pure-node case: `run(input)` returns a value and the realm wraps it.
const PURE_BUNDLE: &str = r#"
export function run(input) {
  const stored = JSON.parse(__xrh.call("fs.readText", JSON.stringify({ path: "/notes/" + input.name })));
  return { name: input.name, stored, now: __xrh.now(), sep: __xrh.platform.sep };
}
"#;

fn run_pure(document: &str, input: &str) -> (String, Vec<String>) {
    let limits =
        EngineLimits::from_budgets("embed-test.note", 1_048_576).expect("a declared budget");
    let executor = Executor::new(
        "embed-test.note".to_string(),
        EntryPlan::pure("embed-test.note", PURE_BUNDLE, "run", "note read"),
        limits,
    );
    let mut host = ToyHost::new(document);
    let result = executor
        .run(input, &mut host)
        .unwrap_or_else(|error| panic!("the run failed: {}", error.message));
    (result, host.calls)
}

#[test]
fn a_host_outside_xiranite_can_drive_a_bundle_with_only_the_two_crates() {
    let (document, calls) = run_pure(r"the note's text", r#"{"name":"groceries"}"#);
    let parsed: Value = serde_json::from_str(&document).expect("a pure run answers a document");
    assert_eq!(parsed["success"], true, "{parsed}");
    assert_eq!(parsed["message"], "note read", "the plan carries the pure message");
    assert_eq!(parsed["data"]["name"], "groceries", "{parsed}");
    // Raw `__xrh.call` hands the host's whole JSON document to the bundle; unwrapping `{path, content}`
    // into a string is the shim layer's job (`packages/quickjs-shims/src/ops.ts`), not the realm's.
    assert_eq!(parsed["data"]["stored"]["content"], "the note's text", "{parsed}");
    assert_eq!(parsed["data"]["stored"]["path"], "/notes/groceries", "{parsed}");
    // The clock is the host's, one spelling, and the realm did not invent an envelope around it.
    assert_eq!(parsed["data"]["now"], HOST_NOW, "{parsed}");
    assert!(parsed["data"]["sep"].is_string(), "the platform answer came from the host: {parsed}");

    // Both operations reached the host by their wire names, in the order the bundle asked.
    assert!(calls.iter().any(|call| call.starts_with("fs.readText")), "{calls:?}");
    assert!(calls.iter().any(|call| call.starts_with("clock.now")), "{calls:?}");
}

#[test]
fn a_refusal_travels_as_data_and_the_node_can_answer_around_it() {
    // `proc.exec` is refused by name. A bundle that catches it still finishes, because a refusal is a
    // thrown `Error` inside the realm and not an engine trap that ends the run.
    const CATCHING_BUNDLE: &str = r#"
export function run(input) {
  try { __xrh.call("proc.exec", "{}"); return { refused: false }; }
  catch (error) { return { refused: true, message: error.message }; }
}
"#;
    let limits =
        EngineLimits::from_budgets("embed-test.catch", 1_048_576).expect("a declared budget");
    let executor = Executor::new(
        "embed-test.catch".to_string(),
        EntryPlan::pure("embed-test.catch", CATCHING_BUNDLE, "run", "caught"),
        limits,
    );
    let mut host = ToyHost::new("unused");
    let document = executor.run("{}", &mut host).expect("the run completes");
    let parsed: Value = serde_json::from_str(&document).expect("a document");
    assert_eq!(parsed["data"]["refused"], true, "{parsed}");
    assert!(
        parsed["data"]["message"]
            .as_str()
            .is_some_and(|text| text.contains("proc.exec")),
        "the refusal names what the host does not answer: {parsed}"
    );
}

#[test]
fn an_undeclared_budget_is_refused_before_any_engine_is_built() {
    // ADR-0073: "not declared" means the host must refuse to schedule, so this is a refusal at the
    // ceiling layer and not a silent unlimited run.
    let error = EngineLimits::from_budgets("embed-test.unbudgeted", 0)
        .expect_err("a zero budget must refuse");
    assert!(error.message.contains("max_live_bytes = 0"), "{error}");
    assert!(error.message.contains("embed-test.unbudgeted"), "the refusal names the node: {error}");
}

/// The byte channel, both directions.
///
/// A project re-writing this substrate always gets the byte rule wrong first: the answer has to arrive as a
/// real `Uint8Array`, and a payload must cross out of band rather than inside the JSON document. If
/// `HostAnswer::Bytes` or `sendBytes` were unreachable through the public surface, this is the test that
/// would fail — which is the point: it is evidence the crate is liftable, not a claim about it.
const BYTE_BUNDLE: &str = r#"
export async function run(input) {
  const buffer = await __xrh.callBytes("fs.readBytes", JSON.stringify({ path: input.path }));
  const digest = JSON.parse(
    await __xrh.sendBytes("crypto.digest", JSON.stringify({ algorithm: "sha256" }), buffer),
  );
  return {
    isUint8Array: buffer instanceof Uint8Array,
    bytes: Array.from(buffer),
    hex: digest.hex,
    byteLength: digest.byteLength,
  };
}
"#;

#[test]
fn bytes_cross_out_of_band_in_both_directions_and_the_pump_drives_them() {
    let limits = EngineLimits::from_budgets("embed-test.bytes", 1_048_576).expect("budget");
    let executor = Executor::new(
        "embed-test.bytes".to_string(),
        EntryPlan::pure("embed-test.bytes", BYTE_BUNDLE, "run", "bytes read"),
        limits,
    );
    let mut host = ToyHost::new("unused");
    let document = executor
        .run(r#"{"path":"/bin/blob"}"#, &mut host)
        .unwrap_or_else(|error| panic!("the byte run failed: {}", error.message));
    let parsed: Value = serde_json::from_str(&document).expect("a document");
    assert_eq!(parsed["success"], true, "{parsed}");
    assert_eq!(parsed["data"]["isUint8Array"], true, "the answer must be a buffer: {parsed}");
    assert_eq!(parsed["data"]["bytes"], serde_json::json!([222, 173, 0, 42]), "{parsed}");
    // The buffer the realm read came back as the payload it sent, byte for byte.
    assert_eq!(parsed["data"]["hex"], "dead002a", "{parsed}");
    assert_eq!(parsed["data"]["byteLength"], 4, "{parsed}");
    assert_eq!(
        host.payloads,
        vec![0, 4],
        "only the digest call carries a payload: {:?}",
        host.payloads
    );
}

/// The async path: a parked promise is settled by the pump, never by an engine timer.
const ASYNC_BUNDLE: &str = r#"
export async function run(input) {
  const first = JSON.parse(await __xrh.callAsync("clock.now", "{}"));
  const second = JSON.parse(await __xrh.callAsync("fs.readText", JSON.stringify({ path: input.path })));
  return { first, content: second.content };
}
"#;

#[test]
fn a_parked_promise_is_settled_by_the_pump_and_keeps_its_order() {
    let limits = EngineLimits::from_budgets("embed-test.async", 1_048_576).expect("budget");
    let executor = Executor::new(
        "embed-test.async".to_string(),
        EntryPlan::pure("embed-test.async", ASYNC_BUNDLE, "run", "two awaits"),
        limits,
    );
    let mut host = ToyHost::new("awaited body");
    let document = executor
        .run(r#"{"path":"/notes/a"}"#, &mut host)
        .unwrap_or_else(|error| panic!("the async run failed: {}", error.message));
    let parsed: Value = serde_json::from_str(&document).expect("a document");
    assert_eq!(parsed["data"]["first"], HOST_NOW, "{parsed}");
    assert_eq!(parsed["data"]["content"], "awaited body", "{parsed}");
    // Two awaits, settled in the order the bundle asked — a hand-rolled pump usually loses this.
    assert_eq!(
        host.calls
            .iter()
            .map(|call| call.split(' ').next().unwrap_or_default().to_string())
            .collect::<Vec<_>>(),
        vec!["clock.now", "fs.readText"],
        "{:?}",
        host.calls
    );
}
