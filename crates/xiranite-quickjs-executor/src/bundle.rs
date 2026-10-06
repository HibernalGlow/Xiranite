//! The bundle side of the executor: load a node's JavaScript, resolve one named export from it, and
//! shape the failures that come out of the engine.
//!
//! [`crate::engine`] decides *when* to call a bundle and what its answer means; this module is the
//! part that only exists because the implementation is JavaScript:
//!
//! - two load shapes, because the build produces two (`esbuild --bundle --format=esm` and the
//!   `--format=iife` shape `spikes/quickjs-probe` measured);
//! - the [`getFunction`](../../../../../packages/runtime/src/node-runner.ts) rule from
//!   `packages/runtime/src/node-runner.ts:72-78`, which refuses an export that is absent or not
//!   callable, and this crate's version of it that says *which* of the two happened;
//! - the two shapes every failure at this boundary takes: one that happened while talking to the
//!   engine ([`unwound`], carrying the engine's own diagnostic) and one that did not ([`failed`]).
//!
//! ## The module-vs-script question, and why both arms collect global names
//!
//! An IIFE bundle is *also* legal ES module text, because assigning to `globalThis` is a statement a
//! module may contain. So `Module::declare` accepts it, its namespace has zero exports, and the entry
//! the plan names (`__nodeEntry` in the probe's shape) lives on the global object instead. That is why
//! [`entry`] searches the namespace and then `globalThis`, and why the list of names a bundle
//! publishes is "its own exports plus whatever appeared on `globalThis` while it ran" in both arms —
//! the alternative is an error message that lists QuickJS's own globals and never the bundle's.

use rquickjs::promise::PromiseState;
use rquickjs::{Ctx, Error, Function, Module, Object, Type, Value};
use xiranite_node_registry::NodeRunError;

use crate::jobs;

/// The bound on the module-eval drain, so a top-level await that needs an import stops the launch
/// instead of stopping the host.
const MAX_MODULE_DRAIN_ROUNDS: u32 = 1000;

/// How many of a bundle's own names a "does not export" message lists.
///
/// Enough to find the right spelling in, and short enough that a bundle with a generated global table
/// cannot bury the message.
const MAX_PUBLISHED_NAMES: usize = 24;

/// One bundle's text and the name the engine records it under.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Bundle<'a> {
    /// The name for syntax errors and stack frames; the node id is the honest value, and the dev
    /// harness says `quickjs-run` because there is no node id until a run exists.
    pub(crate) name: &'a str,
    /// The JavaScript text.
    pub(crate) source: &'a str,
}

/// The object a bundle's exports live on, and the names it published.
pub(crate) struct Exports<'js> {
    /// A module namespace for an ES module, `globalThis` for a global script.
    object: Object<'js>,
    /// The names the bundle itself made available: a module's own exports, plus whatever it assigned
    /// on `globalThis`. This is the list a "does not export" message answers with, so it is never the
    /// engine's own globals.
    published: Vec<String>,
}

/// Loads the bundle and returns the object its exports live on.
///
/// An ES module is tried first, because that is what `esbuild --bundle --format=esm` produces and it
/// is the only shape where `getFunction(module, name)` means what it meant in the TypeScript runner.
/// A bundle that does not compile as a module is then evaluated as a global script — the
/// `--format=iife` shape the probe ran — whose "exports" are whatever it put on `globalThis`.
///
/// `before` is the global name snapshot taken before the bundle text ran; see [`global_names`].
pub(crate) fn resolve<'js>(
    ctx: &Ctx<'js>,
    bundle: Bundle<'_>,
    before: &[String],
) -> Result<Exports<'js>, NodeRunError> {
    match Module::declare(ctx.clone(), bundle.name, bundle.source).and_then(Module::eval) {
        Ok((module, promise)) => {
            // Top-level await resolves through the job queue. A module still pending after a bounded
            // drain is waiting on something an embedded host cannot import, so say so.
            let mut rounds = 0u32;
            while promise.state() == PromiseState::Pending && rounds < MAX_MODULE_DRAIN_ROUNDS {
                if !ctx.execute_pending_job() {
                    break;
                }
                rounds += 1;
            }
            if promise.state() == PromiseState::Rejected {
                let reason = promise
                    .result::<Value>()
                    .and_then(Result::ok)
                    .map(|value| jobs::exception_text(&value))
                    .unwrap_or_else(|| String::from("the module evaluation rejected"));
                return Err(NodeRunError {
                    message: format!(
                        "the bundle {:?} rejected while evaluating: {reason}",
                        bundle.name
                    ),
                });
            }
            let namespace = module
                .namespace()
                .map_err(|error| unwound(ctx, "the bundle's exports could not be read", &error))?;
            let mut published = owned_names(&namespace);
            published.extend(new_global_names(ctx, before));
            Ok(Exports { object: namespace, published: publishable(published) })
        }
        Err(module_error) => {
            // Read the pending module diagnostic before re-evaluating, or the script arm's own
            // exception would be indistinguishable from it.
            let module_text = jobs::exception_text(&ctx.catch());
            let _ = module_error;
            match ctx.eval::<(), _>(bundle.source) {
                Ok(()) => Ok(Exports {
                    object: ctx.globals(),
                    published: publishable(new_global_names(ctx, before)),
                }),
                Err(_) => {
                    let script_text = jobs::exception_text(&ctx.catch());
                    Err(NodeRunError {
                        message: format!(
                            "the bundle {:?} is neither an ES module ({module_text}) nor a global \
                             script ({script_text})",
                            bundle.name
                        ),
                    })
                }
            }
        }
    }
}

/// The global names present right now, so the ones a bundle adds can be told from the engine's.
pub(crate) fn global_names(ctx: &Ctx<'_>) -> Vec<String> {
    ctx.globals().keys::<String>().filter_map(Result::ok).collect()
}

/// The global names that were not there before the bundle ran, minus this crate's own glue.
fn new_global_names(ctx: &Ctx<'_>, before: &[String]) -> Vec<String> {
    global_names(ctx)
        .into_iter()
        .filter(|name| !is_glue_name(name) && !before.iter().any(|seen| seen == name))
        .collect()
}

/// One object's own enumerable names, minus this crate's own glue.
fn owned_names(object: &Object<'_>) -> Vec<String> {
    object.keys::<String>().filter_map(Result::ok).filter(|name| !is_glue_name(name)).collect()
}

/// Sorted, de-duplicated and capped, because this list exists to be read inside an error message.
fn publishable(mut names: Vec<String>) -> Vec<String> {
    names.sort();
    names.dedup();
    names.truncate(MAX_PUBLISHED_NAMES);
    names
}

/// The glue's own globals (`__xrh`, `__xrInvoke`, …) are never a bundle's export.
fn is_glue_name(name: &str) -> bool {
    name.starts_with("__xr")
}

/// What one property read answered.
enum Found<'js> {
    /// Present and callable.
    Callable(Function<'js>),
    /// Present, but not something `getFunction` would accept.
    Present(Value<'js>),
    /// Absent, or bound to `undefined`, which a module namespace reports the same way.
    Absent,
}

/// One property, classified. `node-runner.ts:72-78` is the model: absent *and* non-function are both
/// "Missing function export" there, and the two messages here keep them apart because an operator
/// reading "as a string, not as a function" is looking at a different bug than one reading "does not
/// export".
fn lookup<'js>(object: &Object<'js>, name: &str) -> Found<'js> {
    let Ok(value) = object.get::<_, Value<'js>>(name) else { return Found::Absent };
    if value.is_undefined() {
        return Found::Absent;
    }
    match value.as_function() {
        Some(function) => Found::Callable(function.clone()),
        None => Found::Present(value),
    }
}

/// Reads one export and insists it is callable, the way `getFunction` did.
///
/// The namespace is searched first and `globalThis` second, which is the global-export fallback an
/// `--format=iife` bundle needs (see the module header). A name found in neither is [`not_found`],
/// which lists what the bundle does publish.
pub(crate) fn entry<'js>(
    ctx: &Ctx<'js>,
    exports: &Exports<'js>,
    name: &str,
    bundle: Bundle<'_>,
) -> Result<Function<'js>, NodeRunError> {
    match lookup(&exports.object, name) {
        Found::Callable(function) => return Ok(function),
        Found::Present(value) => return Err(not_callable(name, bundle, &value)),
        Found::Absent => {}
    }
    match lookup(&ctx.globals(), name) {
        Found::Callable(function) => return Ok(function),
        Found::Present(value) => return Err(not_callable(name, bundle, &value)),
        Found::Absent => {}
    }
    Err(not_found(name, bundle, exports))
}

fn not_callable(name: &str, bundle: Bundle<'_>, value: &Value<'_>) -> NodeRunError {
    NodeRunError {
        message: format!(
            "the bundle {:?} exports {name:?} as {}, not as a function",
            bundle.name,
            type_word(value.type_of())
        ),
    }
}

fn not_found(name: &str, bundle: Bundle<'_>, exports: &Exports<'_>) -> NodeRunError {
    NodeRunError {
        message: format!(
            "the bundle {:?} does not export {name:?}; it exports {:?}",
            bundle.name, exports.published
        ),
    }
}

/// A load or resolve failure keeps its own shape; this only appends what was being looked for.
pub(crate) fn note_search(
    error: NodeRunError,
    export_name: &str,
    bundle: Bundle<'_>,
) -> NodeRunError {
    if error.message.contains("does not export") || error.message.contains("is neither") {
        return error;
    }
    NodeRunError {
        message: format!(
            "{} (while resolving {export_name:?} from {:?})",
            error.message, bundle.name
        ),
    }
}

/// The request document as a JS value: parsed by the engine, never string-punched into source.
pub(crate) fn parsed_input<'js>(
    ctx: &Ctx<'js>,
    input: &str,
) -> Result<Value<'js>, NodeRunError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return ctx
            .eval::<Value, _>("({})")
            .map_err(|error| failed("an empty request document could not become an object", &error));
    }
    ctx.json_parse(trimmed)
        .map_err(|error| unwound(ctx, "the request document is not JSON", &error))
}

/// A failure at this boundary that did not come from JavaScript.
pub(crate) fn failed(stage: &'static str, error: &Error) -> NodeRunError {
    NodeRunError { message: format!("{stage}: {error}") }
}

/// A failure at this boundary that came out of the engine, with the engine's own text.
///
/// The detail is read from `ctx.catch()` rather than from the [`rquickjs::Error`], because
/// `Error::Exception` carries no message of its own — the pending exception does. That is also why
/// this takes a `Ctx`: without a catch, an out-of-memory and a missing global are the same string.
pub(crate) fn unwound(ctx: &Ctx<'_>, stage: &str, error: &Error) -> NodeRunError {
    let detail = match error {
        Error::Exception => jobs::exception_text(&ctx.catch()),
        other => other.to_string(),
    };
    NodeRunError { message: format!("{stage}: {detail}") }
}

/// The name of a JS value's type, for a message about the one thing that is not a function.
fn type_word(kind: Type) -> &'static str {
    match kind {
        Type::Undefined => "undefined",
        Type::Null => "null",
        Type::Bool => "a boolean",
        Type::Int | Type::Float => "a number",
        Type::String => "a string",
        Type::Array => "an array",
        Type::Object => "an object",
        Type::Function => "a function",
        _ => "another value",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rquickjs::{Context, Runtime};

    /// The IIFE arm of [`entry`], measured on the engine rather than described: a bundle that is valid
    /// module text but publishes its entry on `globalThis` has to resolve, and a name neither place
    /// defines has to answer with the names the bundle really published.
    #[test]
    fn a_bundle_that_publishes_on_the_global_object_still_resolves_its_entry() {
        let runtime = Runtime::new().expect("runtime");
        let context = Context::full(&runtime).expect("context");
        let bundle = Bundle { name: "unit.iife", source: "globalThis.__unitEntry = () => 7;" };
        context.with(|ctx| {
            let before = global_names(&ctx);
            let exports = resolve(&ctx, bundle, &before).expect("an IIFE is legal module text");
            assert!(
                exports.published.iter().any(|name| name == "__unitEntry"),
                "the published list must carry the bundle's own global: {:?}",
                exports.published
            );
            let resolved =
                entry(&ctx, &exports, "__unitEntry", bundle).expect("the global fallback resolves");
            let answer: i32 = resolved.call(()).expect("callable");
            assert_eq!(answer, 7, "the resolved entry is not the bundle's function");

            // The other arm: a name neither the namespace nor `globalThis` defines is refused with the
            // bundle's own names, and the engine's builtins stay out of the message.
            let missing = match entry(&ctx, &exports, "notInThisBundle", bundle) {
                Ok(_) => panic!("nothing by that name exists, so this must be a refusal"),
                Err(error) => error,
            };
            assert!(missing.message.contains("does not export \"notInThisBundle\""), "{}", missing.message);
            assert!(missing.message.contains("__unitEntry"), "{}", missing.message);
            assert!(!missing.message.contains("Object"), "the engine's globals leaked into the list: {missing}");
            assert!(!missing.message.contains("__xrh"), "the glue leaked into the list: {missing}");
        });
    }

    /// A name that exists but is not callable must not read as "does not export", because the two are
    /// different bugs (a wrong name versus a bundle that exports data where a function was named).
    #[test]
    fn a_non_function_export_is_named_as_what_it_is() {
        let runtime = Runtime::new().expect("runtime");
        let context = Context::full(&runtime).expect("context");
        let bundle = Bundle { name: "unit.notafn", source: "export const run = 42;" };
        context.with(|ctx| {
            let before = global_names(&ctx);
            let exports = resolve(&ctx, bundle, &before).expect("a real module");
            let error = match entry(&ctx, &exports, "run", bundle) {
                Ok(_) => panic!("a number is not a function, so this must be a refusal"),
                Err(error) => error,
            };
            assert!(error.message.contains("as a number, not as a function"), "{}", error.message);
            assert!(!error.message.contains("does not export"), "{}", error.message);
        });
    }

    /// The script arm: a bundle that is *not* legal module text still resolves, and its published list
    /// is the bundle's globals rather than the engine's.
    #[test]
    fn a_global_script_resolves_and_reports_only_its_own_names() {
        let runtime = Runtime::new().expect("runtime");
        let context = Context::full(&runtime).expect("context");
        // `import` at the top level of a script is a syntax error, which is what forces the second arm.
        let bundle = Bundle {
            name: "unit.script",
            source: "import { nothing } from \"nowhere\";\nglobalThis.__scriptEntry = () => 1;",
        };
        context.with(|ctx| {
            let before = global_names(&ctx);
            let message = match resolve(&ctx, bundle, &before) {
                Ok(_) => panic!("a script that needs an import must be refused rather than half-loaded"),
                Err(error) => error.message,
            };
            assert!(message.contains("is neither"), "{message}");

            let plain = Bundle { name: "unit.plain", source: "globalThis.__plain = () => 1;" };
            let exports = resolve(&ctx, plain, &before).expect("assigning to globalThis is module text");
            assert!(entry(&ctx, &exports, "__plain", plain).is_ok(), "the global fallback missed it");
        });
    }

    /// The published list is capped, so a bundle that installs a large global table cannot bury the
    /// message that exists to point at one missing name.
    #[test]
    fn the_published_list_is_capped_and_cleaned() {
        let many: Vec<String> = (0..200).map(|index| format!("name{index}")).collect();
        let capped = publishable(many);
        assert_eq!(capped.len(), MAX_PUBLISHED_NAMES, "the cap did not apply");
        // De-duplicated too, because a name can arrive both as a module export and as a global.
        let duplicated = vec!["run".to_string(), "run".to_string(), "preview".to_string()];
        assert_eq!(publishable(duplicated), vec!["preview".to_string(), "run".to_string()]);
    }
}
