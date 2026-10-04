//! Installing a node's `<id>.wasm` and calling its entry point.
//!
//! This is the whole Extism mechanism of the rewrite, deliberately confined to one crate: block
//! handles, the `extism:host/user` namespace, the manifest's memory ceiling, and the calling
//! convention. `crates/xiranite-node-runtime` hands it a [`CapabilityHost`] per operation, so the
//! plugin is compiled once and serves many runs (ADR-0068's lifecycle split).

use std::sync::Arc;

use extism::{
    CompiledPlugin, CurrentPlugin, Error, Function, Manifest, Plugin, UserData, Val, ValType, Wasm,
};
use xiranite_plugin_api::host_function_symbol;

use crate::capabilities::{CapabilityAnswer, CapabilityHost, accepted_document};

/// The Extism namespace a Xiranite capability lands in.
///
/// Extism registers user functions in its own module and takes the symbol verbatim, so the settled
/// logical name flattened to underscores (`xiranite.fs.stat` → `xiranite_fs_stat`, see
/// [`xiranite_plugin_api::host_function_symbol`]) is what a shim's import declaration must spell.
const CAPABILITY_NAMESPACE: &str = extism::EXTISM_USER_MODULE;

/// Everything needed to install one node plugin.
pub struct PluginSetup<'a> {
    /// The bytes of `<id>.wasm`.
    pub wasm: &'a [u8],
    /// The exported entry point, from the node's `manifest.json`.
    ///
    /// The entry takes **no wasm parameters** and returns an `i32` exit code: the official `extism`
    /// Rust host invokes exports with zero arguments (`Plugin::raw_call` passes `&[]`, and
    /// `Plugin::function_exists` only accepts a `(0, i32)` signature), so the legacy block convention
    /// — input via `extism:host/env::input_set`, output via `output_set` — is the one the Rust host can
    /// actually drive. A `#[extism_pdk::plugin_fn]`-style `(u64) -> u64` export is unlinkable here.
    pub entry_point: &'a str,
    /// The `hostFunctions` list from the node's `manifest.json`, as settled logical names.
    pub host_functions: &'a [String],
    /// `memoryMaxPages` from the manifest; the Extism-side half of ADR-0066's two-layer enforcement.
    pub memory_max_pages: Option<u32>,
}

/// How a plugin call ended from the adapter's point of view.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdapterError {
    /// The wasm could not be compiled, or an import could not be resolved — a drifted capability name
    /// or an entry point the module does not export.
    Install { message: String },
    /// The call itself failed: a trap, an `error_set` message or a non-zero exit code.
    Call { message: String },
    /// The plugin's output block was not valid UTF-8, so it was not the JSON document the contract
    /// promises.
    OutputEncoding { message: String },
}

impl std::fmt::Display for AdapterError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Install { message } => write!(formatter, "plugin install failed: {message}"),
            Self::Call { message } => write!(formatter, "plugin call failed: {message}"),
            Self::OutputEncoding { message } => {
                write!(formatter, "plugin output is not UTF-8 JSON: {message}")
            }
        }
    }
}

impl std::error::Error for AdapterError {}

/// One compiled node plugin, reusable across operations.
pub struct CompiledNode {
    compiled: CompiledPlugin,
    entry_point: String,
}

impl CompiledNode {
    /// Compiles the wasm and registers exactly the capabilities the manifest declares.
    ///
    /// A capability name outside the settled vocabulary is an install error rather than a silently
    /// unregistered import: the plugin would then fail at link time with a message that names neither
    /// the manifest nor the adapter.
    pub fn compile(setup: PluginSetup<'_>) -> Result<Self, AdapterError> {
        let mut functions = Vec::with_capacity(setup.host_functions.len());
        for name in setup.host_functions {
            let symbol = host_function_symbol(name).ok_or_else(|| AdapterError::Install {
                message: format!("{name} is not a settled `xiranite.*` capability name"),
            })?;
            let logical = name.clone();
            functions.push(
                Function::new(
                    symbol,
                    [ValType::I64],
                    [ValType::I64],
                    UserData::new(()),
                    move |current, inputs, outputs, _unused| {
                        serve_capability(current, inputs, outputs, &logical, symbol)
                    },
                )
                .with_namespace(CAPABILITY_NAMESPACE),
            );
        }

        let mut manifest = Manifest::new([Wasm::data(setup.wasm.to_vec())]);
        manifest.memory.max_pages = setup.memory_max_pages;

        let compiled = CompiledPlugin::new(
            extism::PluginBuilder::new(manifest).with_functions(functions).with_wasi(false),
        )
        .map_err(|error| AdapterError::Install { message: error.to_string() })?;

        Ok(Self { compiled, entry_point: setup.entry_point.to_owned() })
    }

    /// The entry point this node was installed with.
    #[must_use]
    pub fn entry_point(&self) -> &str {
        &self.entry_point
    }

    /// Runs one operation: installs a fresh instance, serves its capability calls through `host`, and
    /// returns the plugin's response document.
    ///
    /// `&self` is load-bearing: the compiled module is cached and shared by every operation of that
    /// node, while `Plugin::new_from_compiled` builds the per-run instance (ADR-0068's plugin-lifecycle
    /// / operation-lifecycle split). Extism's `Pool` is the place to reuse instances later; that is a
    /// performance decision and must not change this signature.
    pub fn run(&self, host: Arc<dyn CapabilityHost>, request_json: &str) -> Result<String, AdapterError> {
        let mut plugin = Plugin::new_from_compiled(&self.compiled)
            .map_err(|error| AdapterError::Install { message: error.to_string() })?;
        if !plugin.function_exists(&self.entry_point) {
            return Err(AdapterError::Install {
                message: format!("the module does not export `{}` as a zero-parameter i32 entry point", self.entry_point),
            });
        }

        let output = plugin
            .call_with_host_context::<&str, Vec<u8>, Arc<dyn CapabilityHost>>(&self.entry_point, request_json, host)
            .map_err(|error| AdapterError::Call { message: error.to_string() })?;
        String::from_utf8(output).map_err(|error| AdapterError::OutputEncoding { message: error.to_string() })
    }
}

/// Reads the plugin's request block, serves it through the operation's host context, and answers
/// either with a new block or with the integer the vocabulary says the call returns.
///
/// Both document outcomes are data: an accepted answer is `{ "ok": true, "data": … }`, a refusal is
/// `{ "ok": false, "error": { code, message } }`. Returning `Err` here would trap the wasm frame,
/// which ADR-0068 reserves for genuine adapter failures (a malformed block, a lost host context).
fn serve_capability(
    current: &mut CurrentPlugin,
    inputs: &[Val],
    outputs: &mut [Val],
    logical_name: &str,
    symbol: &str,
) -> Result<(), Error> {
    let offset = inputs
        .first()
        .and_then(Val::i64)
        .ok_or_else(|| Error::msg(format!("{symbol} was called without a request block")))?;
    let offset = u64::try_from(offset)
        .map_err(|_| Error::msg(format!("{symbol} received a negative block offset")))?;

    let handle = current
        .memory_handle(offset)
        .ok_or_else(|| Error::msg(format!("{symbol} request offset is not a live extism block")))?;
    let request = current.memory_str(handle)?.to_owned();

    let host = current
        .host_context::<Arc<dyn CapabilityHost>>()
        .map_err(|_| Error::msg(format!("{symbol} was called outside a plugin run (no operation host context)")))?
        .clone();

    match (host.capability(logical_name, &request), answers_with_code(logical_name)) {
        (Ok(CapabilityAnswer::Document(data)), false) => {
            write_block(current, outputs, accepted_document(data))
        }
        (Ok(CapabilityAnswer::Code(code)), true) => {
            outputs[0] = Val::I64(i64::try_from(code).unwrap_or_default());
            Ok(())
        }
        // A code-answering call cannot carry an envelope: the plugin reads the integer, so a refusal
        // becomes the reserved code, which every shim maps to the safe stop. The only way
        // `xiranite.operation.checkpoint` refuses is that the operation is gone or already terminal,
        // so cancelling the run is the truth rather than a fallback.
        (Err(_refusal), true) => {
            outputs[0] = Val::I64(0);
            Ok(())
        }
        (Err(refusal), false) => write_block(current, outputs, refusal.to_document()),
        // The host answered in the other shape than its own vocabulary says: a bug in the host, not
        // in the plugin, so it is reported instead of silently re-encoded.
        (Ok(_), _) => Err(Error::msg(format!(
            "{logical_name} answered in the wrong shape for its signature"
        ))),
    }
}

/// Writes one answer document into a fresh block and hands the plugin its offset.
fn write_block(
    current: &mut CurrentPlugin,
    outputs: &mut [Val],
    document: String,
) -> Result<(), Error> {
    let answer = current.memory_new(document)?;
    outputs[0] = Val::I64(answer.offset() as i64);
    Ok(())
}

/// The capabilities whose wasm result is an integer rather than a block handle.
///
/// ADR-0066 puts a checkpoint on every item boundary of a batch plugin, so wrapping a three-value
/// enum in an allocated block per item would be the hottest allocation in the run. The rest of the
/// vocabulary answers with a document.
fn answers_with_code(name: &str) -> bool {
    matches!(name, "xiranite.operation.checkpoint")
}
