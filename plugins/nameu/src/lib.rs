//! NameU domain logic, ported from `packages/nodes/nameu/src/core.ts`.
//!
//! The plugin plans archive and folder renames. Since ADR-0071 the file half of that reaches the
//! machine through `std::fs` on the WASI preopens the host grants from the manifest's
//! `allowed_paths` ([`std_fs_runtime`]); what still crosses the boundary as a host call is the
//! operation event stream, the cooperative checkpoint ([`plan::NameuRuntime::checkpoint`],
//! ADR-0066), and nothing else.

#[cfg(test)]
mod in_memory_runtime;
mod contract;
mod name_rules;
mod path;
mod plan;
pub mod std_fs_runtime;
mod text;
mod undo;

#[cfg(feature = "wasm")]
pub mod plugin;

pub use contract::{
    DEFAULT_ARCHIVE_EXTENSIONS, DEFAULT_EXCLUDE_KEYWORDS, DEFAULT_FORBIDDEN_ARTIST_KEYWORDS,
    NameuAction, NameuCheckpointReply, NameuCheckpointRequest, NameuCheckpointStatus, NameuData,
    NameuDirEntry, NameuInput, NameuItemKind, NameuMode, NameuNameRules, NameuPathInfo,
    NameuPlanItem, NameuPlanStatus, NameuResult, NameuRunEvent, NameuRunEventKind,
    NormalizedNameuInput, normalize_nameu_input,
};
pub use name_rules::{normalize_archive_name, normalize_folder_name};
pub use path::{basename_of, dirname_of, join_paths};
pub use plan::{NameuRuntime, NameuRuntimeError, NameuRuntimeResult, build_nameu_plan, run_nameu};
pub use std_fs_runtime::StdFilesystem;
pub use undo::{NameuUndoPlan, NameuUndoPlanItem, build_nameu_undo_plan};
