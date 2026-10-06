//! Stages the per-node TypeScript bundles into `OUT_DIR` so the registry can link them.
//!
//! `crates/xiranite-quickjs-executor/src/node.rs:29-35` records ADR-0074 §6: the host binary carries
//! every linked bundle, so a scripted node's bundle is `include_str!`-ed, not read off disk at run time.
//! The bundle itself is a build product (`bun run build:node-bundles` → `artifacts/node-bundles/`, which
//! is gitignored), so copying it here is what makes `cargo build` depend on that step *and* say so out
//! loud when it has not run. `rerun-if-changed` per bundle keeps the dev loop at "edit core.ts → rebuild
//! bundle → rebuild host" instead of relinking on every touch.
//!
//! A missing bundle is a hard error, never an empty string: an empty bundle would link, register the id,
//! and fail at the first operation with a JavaScript syntax error.

use std::path::{Path, PathBuf};
use std::{env, fs};

/// The nodes whose bundle this host still links by hand instead of through the generated table in
/// `crates/xiranite-scripted-nodes/src/registration.rs`.
///
/// Empty as of 2026-10-06. `dissolvef` left first: its grants (workspace read-write root, recursive walk,
/// the 16 MiB ceiling) are carried by `docs/xiranite-target-node-manifest.json` and emitted by
/// `scripts/embed-node-bundles.ts`, so keeping it here registered the same id twice and the host refused to
/// start (`two built-in nodes register id "dissolvef"`). `kisaki` followed the same night, once the analyzer
/// could name the programs at its `proc.exec` call site (`runOrThrow(platform === "darwin" ? "open" :
/// "xdg-open", …)`) and the manifest carried the czkawka/trash service names — the two things that made its
/// descriptor un-spellable by a table.
///
/// The array and the loop stay because a node in here is the escape hatch for one the table cannot spell, and
/// because `scripts/audit-face-execution-path.ts` reads this line as its hand-linked half of the ledger
/// (`registeredInRust`). Deleting the file means changing that gate, which is a different task's live edit.
const NODE_BUNDLES: &[&str] = &[];

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let repo_root = manifest.parent().and_then(Path::parent).unwrap_or_else(|| {
        panic!("{} is not under a repository directory", manifest.display())
    });
    let bundles_dir = repo_root.join("artifacts").join("node-bundles");
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));

    for id in NODE_BUNDLES {
        let source = bundles_dir.join(format!("{id}.js"));
        println!("cargo:rerun-if-changed={}", source.display());
        if !source.is_file() {
            panic!(
                "no host bundle for node {id:?} at {} — run `bun run build:node-bundles` before \
                 `cargo build` (the bundle is a build product; an empty one would link and fail later).",
                source.display()
            );
        }
        let bytes = fs::read(&source).unwrap_or_else(|error| {
            panic!("the host bundle {} could not be read: {error}", source.display())
        });
        if bytes.is_empty() {
            panic!("the host bundle {} is empty; the bundle build went wrong", source.display());
        }
        let destination = out_dir.join(format!("{id}.js"));
        fs::write(&destination, &bytes).unwrap_or_else(|error| {
            panic!("{} could not be written: {error}", destination.display())
        });
        eprintln!(
            "xiranite-builtin-host: staged bundle {id}.js ({} bytes)",
            bytes.len()
        );
    }
}
