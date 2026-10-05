//! The shared table harness for ClassQ's parity tests.
//!
//! Why a harness instead of twenty `#[test]` bodies: the node's behaviour is a *set of rules* — filters, ordering,
//! defaulting, gating — and a rule is only proven by a table whose rows differ in exactly one input. The harness
//! gives each row a JSON Pointer probe list plus a **negative control**: the same probe re-run against one deliberate
//! mutation, which must answer differently. A control whose mutated row answers the same as the real one is not
//! discriminating, and `assert_control` says so out loud.
//!
//! An empty table is refused too (`assert_table_is_not_empty`), because a file that lost its rows would otherwise
//! report green.
//!
//! `#![allow(dead_code)]`: one module shared by several test binaries, each using a subset of it. Cargo compiles the
//! whole module into every binary, so the unused half would warn.
#![allow(dead_code)]

use serde_json::Value;

use xiranite_plugin_classq::in_memory_runtime::{
    CollectingClassqEventSink, MemoryFileSystem, ScriptedClassqRunControl,
};
use xiranite_plugin_classq::plugin_entry::run_classq_request;

/// One directory of the fixture: its path plus `(name, is_directory)` in listing order.
#[derive(Debug, Clone)]
pub struct DirSpec {
    /// The directory path.
    pub path: String,
    /// Its entries, in the order a listing returns them.
    pub entries: Vec<(String, bool)>,
    /// Entries that are neither file nor directory (`core.ts:152` drops those).
    pub others: Vec<String>,
}

/// A directory tree: the same shape `core.test.ts:7-12` spelled as `dirs`.
#[derive(Debug, Default, Clone)]
pub struct Tree {
    /// The directories.
    pub dirs: Vec<DirSpec>,
    /// Paths that exist as loose files and appear in no listing — `options.existing`, used to plant a wait target.
    pub existing: Vec<String>,
    /// Directories whose listing fails.
    pub unreadable: Vec<String>,
    /// Sources whose transfer fails.
    pub untransferable: Vec<String>,
}

impl Tree {
    /// An empty tree.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// `dirs[path] = entries`, where the second element of each pair is "is a directory".
    #[must_use]
    pub fn dir(mut self, path: &str, entries: &[(&str, bool)]) -> Self {
        self.dirs.push(DirSpec {
            path: path.to_owned(),
            entries: entries.iter().map(|(name, dir)| ((*name).to_owned(), *dir)).collect(),
            others: Vec::new(),
        });
        self
    }

    /// Adds a neither-file-nor-directory entry to a directory that already exists in the fixture.
    #[must_use]
    pub fn other_entry(mut self, path: &str, name: &str) -> Self {
        if let Some(dir) = self.dirs.iter_mut().find(|dir| dir.path == path) {
            dir.others.push(name.to_owned());
        }
        self
    }

    /// Plants a file that exists but is in no listing (`core.test.ts:54`).
    #[must_use]
    pub fn existing_file(mut self, path: &str) -> Self {
        self.existing.push(path.to_owned());
        self
    }

    /// Makes one listing fail.
    #[must_use]
    pub fn unreadable(mut self, path: &str) -> Self {
        self.unreadable.push(path.to_owned());
        self
    }

    /// Makes one transfer fail.
    #[must_use]
    pub fn untransferable(mut self, source: &str) -> Self {
        self.untransferable.push(source.to_owned());
        self
    }

    /// The in-memory filesystem the row runs on.
    #[must_use]
    pub fn build(&self) -> MemoryFileSystem {
        let mut file_system = MemoryFileSystem::new();
        for dir in &self.dirs {
            let entries: Vec<(&str, bool)> =
                dir.entries.iter().map(|(name, is_dir)| (name.as_str(), *is_dir)).collect();
            file_system = file_system.with_directory(&dir.path, &entries);
            for other in &dir.others {
                file_system = file_system.with_other_entry(&dir.path, other);
            }
        }
        for path in &self.existing {
            file_system = file_system.with_existing_file(path);
        }
        for path in &self.unreadable {
            file_system = file_system.with_unreadable_directory(path);
        }
        for source in &self.untransferable {
            file_system = file_system.with_untransferable_source(source);
        }
        file_system
    }

    /// `core.test.ts`'s `{ "/root": [...] }` literal, as one call.
    #[must_use]
    pub fn from_fixture(dirs: &[(&str, &[(&str, bool)])]) -> Self {
        let mut tree = Self::new();
        for (path, entries) in dirs {
            tree = tree.dir(path, entries);
        }
        tree
    }
}

/// A `(JSON Pointer, expected JSON literal)` pair, the unit of assertion.
pub type Probe<'a> = (&'a str, &'static str);

/// Parses a JSON literal, so a table row can write `"\"wait\""` and `"2"` interchangeably.
#[must_use]
pub fn literal(text: &str) -> Value {
    serde_json::from_str(text).unwrap_or_else(|error| panic!("probe expectation {text:?} is not JSON: {error}"))
}

/// Reads a pointer out of a document, panicking with the document when the path is absent — a missing field is a
/// contract break, not a `None`.
#[must_use]
pub fn probe(doc: &Value, pointer: &str) -> Value {
    doc.pointer(pointer)
        .unwrap_or_else(|| panic!("no {pointer} in the answer document: {doc}"))
        .clone()
}

/// Reads a pointer out of a document, `None` when the path is absent. Used by the control check, where "this field
/// does not exist in the real answer" is itself the discriminating fact.
#[must_use]
pub fn probe_option(doc: &Value, pointer: &str) -> Option<Value> {
    doc.pointer(pointer).cloned()
}

/// Asserts every probe of one row.
pub fn assert_probes(doc: &Value, case_name: &str, probes: &[Probe<'_>]) {
    assert!(!probes.is_empty(), "row {case_name} asserts nothing");
    for (pointer, expected) in probes {
        let actual = probe(doc, pointer);
        let want = literal(expected);
        assert_eq!(actual, want, "row {case_name}: {pointer} answered {actual}, expected {want}\nfull document: {doc}");
    }
}

/// Runs one row and returns the answer document plus the events the run streamed.
///
/// `cancel_on` is `None` for a run that never cancels; `Some(n)` cancels on the nth `checkpoint` call (0-based),
/// which is how a paused-then-cancelled operation is rehearsed without a host.
#[must_use]
pub fn run_row(tree: &Tree, input: &str, cancel_on: Option<usize>) -> (Value, Vec<Value>) {
    let request: Value = serde_json::from_str(input)
        .unwrap_or_else(|error| panic!("row input is not JSON ({error}): {input}"));
    let file_system = tree.build();
    let mut sink = CollectingClassqEventSink::default();
    let mut control = match cancel_on {
        None => ScriptedClassqRunControl::continuing(),
        Some(after) => ScriptedClassqRunControl::cancelling_after(after),
    };
    let document = run_classq_request(&request, &file_system, &mut sink, &mut control);
    let events = sink.events.iter().map(|event| serde_json::to_value(event).expect("event json")).collect();
    (document, events)
}

/// The answer document for a row.
#[must_use]
pub fn run(tree: &Tree, input: &str) -> Value {
    run_row(tree, input, None).0
}

/// A row's negative control: one field of the input or the tree changed, plus the pointer that must answer
/// differently.
#[derive(Debug, Clone)]
pub struct Control<'a> {
    /// Why this mutation is the right foil for the row.
    pub note: &'a str,
    /// The mutated tree, or `None` to keep the row's tree.
    pub tree: Option<Tree>,
    /// The mutated input document.
    pub input: &'a str,
    /// The pointer under test — normally one the row already asserted.
    pub pointer: &'a str,
    /// What the mutated run must answer there.
    pub expected: &'static str,
}

/// "Same tree, different input" — the common control shape.
#[must_use]
pub fn input_control<'a>(note: &'a str, input: &'a str, pointer: &'a str, expected: &'static str) -> Control<'a> {
    Control { note, tree: None, input, pointer, expected }
}

/// "Same input, different tree".
#[must_use]
pub fn tree_control<'a>(
    note: &'a str,
    tree: Tree,
    input: &'a str,
    pointer: &'a str,
    expected: &'static str,
) -> Control<'a> {
    Control { note, tree: Some(tree), input, pointer, expected }
}

/// Runs the control and proves it discriminates: the mutated row answers `expected`, the real row does not.
pub fn assert_control(real: &Value, row_tree: &Tree, control: &Control<'_>) {
    let mutated_tree = control.tree.clone().unwrap_or_else(|| row_tree.clone());
    let expected = literal(control.expected);
    let mutated = run(&mutated_tree, control.input);
    assert_eq!(
        probe_option(&mutated, control.pointer),
        Some(expected.clone()),
        "control {:?} did not produce the expected value at {}: {mutated}",
        control.note,
        control.pointer
    );
    assert_ne!(
        probe_option(real, control.pointer),
        Some(expected),
        "row control {:?} is vacuous: the real run answers the same thing at {}",
        control.note,
        control.pointer
    );
}

/// Refuses an empty table: a file whose rows were deleted would otherwise pass.
pub fn assert_table_is_not_empty(rows: usize, file: &str) {
    assert!(rows > 0, "{file} has no case rows; an empty table proves nothing about the node");
}
