//! The host's view of every node it can run, so `xiranite help` and `xiranite help <node>` exist as one command.
//!
//! Each node's own dictionary advertises the shared entry (`xiranite help marku` is literally one of `marku`'s
//! published examples), and before the rewrite that page came from importing the node's TypeScript. Here it comes
//! from the published definition files, so the host needs to find them: `<root>/node-definitions/*.json` are the
//! drafted definitions and `<root>/plugins/*/definition.json` the ones a plugin actually ships. Where both exist
//! the plugin copy wins, because that is the artifact a user installed.
//!
//! Nothing here chooses which nodes to show or how the tree is laid out — a host passes the roots it resolved and
//! renders what comes back.

use std::fmt;
use std::path::{Path, PathBuf};

use xiranite_plugin_api::node_definition::NodeDefinition;

use crate::help::render_help;
use crate::wire::{DefinitionReadError, parse_definition};

/// A node the host can run, by the id its definition publishes.
#[derive(Debug, Clone, PartialEq)]
pub struct CatalogEntry {
    /// `nodeId`, the same key the HTTP surface and the plugin manifest use.
    pub node_id: String,
    /// Where the definition was read from, so an error can name the file the user can open.
    pub path: PathBuf,
    /// The parsed definition.
    pub definition: NodeDefinition,
    /// Whether this copy came from an installed plugin rather than a drafted definition file.
    pub published: bool,
}

/// Why a catalog could not be built.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CatalogError {
    /// The scan found no definitions at all. Surfaced instead of returning an empty catalog, because a host that
    /// renders "no nodes" for a wrong root is indistinguishable from a host with nothing installed.
    EmptyScan { roots: Vec<PathBuf> },
    /// A definition file could not be read.
    Unreadable { path: PathBuf, reason: String },
    /// A definition file exists but does not describe a node.
    Invalid { path: PathBuf, message: String },
    /// No node publishes that id.
    UnknownNode { node_id: String, known: Vec<String> },
}

impl fmt::Display for CatalogError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyScan { roots } => write!(formatter, "no definition.json found under {}", roots.iter().map(|root| root.display().to_string()).collect::<Vec<String>>().join(" or ")),
            Self::Unreadable { path, reason } => write!(formatter, "{} cannot be read: {reason}", path.display()),
            Self::Invalid { path, message } => write!(formatter, "{} is not a valid definition: {message}", path.display()),
            Self::UnknownNode { node_id, known } => write!(formatter, "no node publishes {node_id:?}; known nodes: {}", known.join(", ")),
        }
    }
}

impl std::error::Error for CatalogError {}

/// Every node the host can show help for, in id order.
#[derive(Debug, Clone, PartialEq)]
pub struct Catalog {
    entries: Vec<CatalogEntry>,
}

impl Catalog {
    /// Read the definitions under a repo root: `node-definitions/*.json` then `plugins/*/definition.json`.
    ///
    /// The plugin copy replaces the drafted one for the same id rather than being listed twice, so a host cannot
    /// show two different flag sets for one node.
    /// # Errors
    ///
    /// Returns [`CatalogError`] when nothing is found, or when a file found cannot be read or parsed.
    pub fn discover(repo_root: &Path) -> Result<Self, CatalogError> {
        let drafts = definition_files(&repo_root.join("node-definitions"), false)?;
        let published = definition_files(&repo_root.join("plugins"), true)?;
        Self::from_files(repo_root, [drafts, published].concat())
    }

    /// Build a catalog from an explicit list of definition files, for hosts that resolve paths themselves.
    /// # Errors
    ///
    /// See [`Catalog::discover`].
    pub fn from_files(repo_root: &Path, paths: Vec<PathBuf>) -> Result<Self, CatalogError> {
        let mut entries: Vec<CatalogEntry> = Vec::new();
        for path in paths {
            let text = std::fs::read_to_string(&path).map_err(|error| CatalogError::Unreadable { path: path.clone(), reason: error.to_string() })?;
            let definition = parse_definition(&text).map_err(|error: DefinitionReadError| CatalogError::Invalid { path: path.clone(), message: error.to_string() })?;
            if let Some(existing) = entries.iter_mut().find(|entry| entry.node_id == definition.node_id.to_string()) {
                // An installed plugin outranks a drafted file, and equal kinds are a duplicate to refuse rather
                // than silently drop.
                if existing.published {
                    continue;
                }
                *existing = CatalogEntry { node_id: definition.node_id.to_string(), path, definition, published: false };
                continue;
            }
            let published = path.file_name().is_some_and(|name| name == "definition.json");
            entries.push(CatalogEntry { node_id: definition.node_id.to_string(), path, definition, published });
        }
        if entries.is_empty() {
            return Err(CatalogError::EmptyScan { roots: vec![repo_root.join("node-definitions"), repo_root.join("plugins")] });
        }
        entries.sort_by(|left, right| left.node_id.cmp(&right.node_id));
        Ok(Self { entries })
    }

    /// Every node id, in the order the catalog lists them.
    #[must_use]
    pub fn node_ids(&self) -> Vec<&str> {
        self.entries.iter().map(|entry| entry.node_id.as_str()).collect()
    }

    /// The definition for one node id.
    #[must_use]
    pub fn definition(&self, node_id: &str) -> Option<&NodeDefinition> {
        self.entries.iter().find(|entry| entry.node_id == node_id).map(|entry| &entry.definition)
    }

    /// The entries, in id order.
    #[must_use]
    pub fn entries(&self) -> &[CatalogEntry] {
        &self.entries
    }

    /// `xiranite help` with no node named: one line per node, `id — title — description`.
    ///
    /// A node whose definition carries no help block still appears, because it is runnable; the page for it just
    /// stops after the tagline instead of inventing steps.
    #[must_use]
    pub fn render_index(&self, language: &str) -> String {
        let heading = if language == "en" { "Available nodes" } else { "可用节点" };
        let mut lines = vec![heading.to_owned()];
        for entry in &self.entries {
            let source = if entry.published { "" } else { if language == "en" { "  (drafted)" } else { "  (草案)" } };
            lines.push(format!("  {} — {} — {}{source}", entry.node_id, entry.definition.title.resolve(language), entry.definition.description.resolve(language)));
        }
        lines.join("\n")
    }

    /// `xiranite help <node>`: the node's own page, in the session language.
    /// # Errors
    ///
    /// Returns [`CatalogError::UnknownNode`] with the known ids when nothing publishes that name.
    pub fn render_node_help(&self, node_id: &str, language: &str) -> Result<String, CatalogError> {
        let definition = self.definition(node_id).ok_or_else(|| CatalogError::UnknownNode { node_id: node_id.to_owned(), known: self.node_ids().iter().map(|id| (*id).to_owned()).collect() })?;
        let title = format!("{} — {}", definition.node_id, definition.title.resolve(language));
        let page = render_help(definition, language);
        Ok(if page.is_empty() { title } else { format!("{title}\n{page}") })
    }
}

fn definition_files(root: &Path, nested: bool) -> Result<Vec<PathBuf>, CatalogError> {
    let mut paths: Vec<PathBuf> = Vec::new();
    let reading = std::fs::read_dir(root);
    let Ok(directory) = reading else {
        return Ok(paths);
    };
    let mut nodes: Vec<PathBuf> = directory.filter_map(|entry| entry.ok().map(|item| item.path())).collect();
    nodes.sort();
    for path in nodes {
        if nested {
            let definition = path.join("definition.json");
            if definition.is_file() {
                paths.push(definition);
            }
            continue;
        }
        if path.is_file() && path.extension().is_some_and(|extension| extension == "json") {
            paths.push(path);
        }
    }
    Ok(paths)
}
