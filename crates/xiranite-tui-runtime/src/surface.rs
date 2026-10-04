//! The workbench sections a definition produces, with the legacy screen's rules copied rather than re-derived.
//!
//! `packages/cli-runtime/src/tui/opentui/app.tsx` builds its section tabs with `visibleSections`, and the rules
//! there are the behaviour a port must keep:
//!
//! - a section lists its `fieldIds` **resolved against the visible fields**, so an id that is hidden right now
//!   or was never declared contributes nothing;
//! - a section with nothing left in it is dropped, which is why the tab strip can appear and disappear while the
//!   user is typing;
//! - every visible field that no section claimed goes into a final overflow section, and its title is the shared
//!   term `Parameters` / `参数设置` from `packages/cli-runtime/src/i18n.ts`;
//! - a field named in two sections appears in both (`assigned` only decides what still needs the overflow).
//!
//! The tab strip is offered only when more than one section survives — the same condition the key bindings use
//! ([`crate::keymap`]), so the strip and the arrows cannot disagree.
//!
//! Visibility itself is **not** decided here. The caller either passes a predicate or uses
//! [`plan_visible_surface`], which asks the single shared evaluator in
//! `xiranite_plugin_api::definition_eval` — a second implementation of the condition algebra inside the TUI is
//! precisely the drift that evaluator exists to prevent.

use xiranite_plugin_api::definition_eval::{self, Values};
use xiranite_plugin_api::node_definition::{FieldDefinition, LocalizedText, NodeDefinition};

/// One surviving section, in the order the definition declares them.
#[derive(Debug, Clone, PartialEq)]
pub struct Section<'a> {
    /// The group id, or [`OVERFLOW_SECTION_ID`] for the auto-appended remainder.
    pub id: &'a str,
    /// The section's title: authored copy for a declared group, the shared term for the overflow one. Owned
    /// because the overflow title comes from this crate rather than from the definition's lifetime.
    pub title: LocalizedText,
    /// Optional authored help line above the fields.
    pub description: Option<&'a LocalizedText>,
    /// The fields this section shows, in the group's own order.
    pub fields: Vec<&'a FieldDefinition>,
}

/// The whole form area of a workbench screen.
#[derive(Debug, Clone, PartialEq)]
pub struct Surface<'a> {
    /// Sections in render order; the caller draws a tab strip when it holds more than one.
    pub sections: Vec<Section<'a>>,
    /// The action selector field, which is a tab strip and never a row inside one.
    pub action_selector: Option<&'a FieldDefinition>,
    /// Whether the node declared anything to show in the status area.
    pub has_dashboard: bool,
    /// Whether the node declared result columns, i.e. whether a results table belongs on screen.
    pub has_result_table: bool,
}

/// The id of the auto-appended remainder section.
pub const OVERFLOW_SECTION_ID: &str = "other";

/// The shared term used as the overflow section's title.
#[must_use]
pub fn overflow_title() -> LocalizedText {
    LocalizedText::new("参数设置", "Parameters")
}

/// More than one section means a tab strip, which is also when the arrow keys cycle it.
#[must_use]
pub fn shows_tab_strip(surface: &Surface<'_>) -> bool {
    surface.sections.len() > 1
}

/// Build the form area from a definition, given which fields are currently visible.
#[must_use]
pub fn plan_surface<'a>(definition: &'a NodeDefinition, is_visible: impl Fn(&'a FieldDefinition) -> bool) -> Surface<'a> {
    let visible: Vec<&'a FieldDefinition> = definition.fields.iter().filter(|field| is_visible(field)).collect();
    let visible_by_id = |id: &str| visible.iter().copied().find(|field| field.id == id);

    let mut claimed: Vec<&'a str> = Vec::new();
    let mut sections: Vec<Section<'a>> = Vec::new();

    for group in &definition.groups {
        let fields: Vec<&'a FieldDefinition> = group.field_ids.iter().filter_map(|id| visible_by_id(id)).collect();
        if fields.is_empty() {
            // Empty sections are dropped, so an id nobody can see costs the group its tab.
            continue;
        }
        for field in &fields {
            if !claimed.contains(&field.id.as_str()) {
                claimed.push(field.id.as_str());
            }
        }
        sections.push(Section {
            id: group.id.as_str(),
            title: group.title.clone(),
            description: group.description.as_ref(),
            fields,
        });
    }

    let remaining: Vec<&'a FieldDefinition> = visible.into_iter().filter(|field| !claimed.contains(&field.id.as_str())).collect();
    if !remaining.is_empty() {
        sections.push(Section {
            id: OVERFLOW_SECTION_ID,
            title: overflow_title(),
            description: None,
            fields: remaining,
        });
    }

    Surface {
        action_selector: definition.fields.iter().find(|field| field.is_action_selector),
        has_dashboard: definition.dashboard.is_some(),
        has_result_table: definition.result_table.as_ref().is_some_and(|table| !table.columns.is_empty()),
        sections,
    }
}

/// The form area for a definition and the answers so far, with visibility evaluated by the shared evaluator.
///
/// This is what a node\'s `tui.rs` calls: it never sees a condition, only the sections that survive them.
#[must_use]
pub fn plan_visible_surface<'a>(definition: &'a NodeDefinition, values: &Values) -> Surface<'a> {
    plan_surface(definition, |field| definition_eval::is_visible(field, values))
}

#[cfg(test)]
mod tests {
    use super::{OVERFLOW_SECTION_ID, plan_surface, plan_visible_surface, shows_tab_strip};
    use xiranite_plugin_api::definition_eval::Values;
    use xiranite_plugin_api::node_definition::{
        Condition, DangerGate, DEFINITION_VERSION_V1, FieldDefinition, FieldGroup, FieldKind, InputBinding,
        LocalizedText, NodeAction, NodeDefinition, Predicate, ResultColumn, ResultTableSpec, Scalar, Test,
        Transform,
    };
    use xiranite_plugin_api::identifiers::PluginId;

    fn text(zh: &str, en: &str) -> LocalizedText {
        LocalizedText::new(zh, en)
    }

    fn field(id: &str) -> FieldDefinition {
        FieldDefinition {
            default: Some(Scalar::Text(String::new())),
            description: None,
            id: id.to_owned(),
            is_action_selector: false,
            kind: FieldKind::Text,
            label: text(id, id),
            lines: None,
            options: Vec::new(),
            placeholder: None,
            range: None,
            rules: Vec::new(),
            visible: Condition::Single(Predicate::holds(Test::Always)),
        }
    }

    fn group(id: &str, field_ids: &[&str]) -> FieldGroup {
        FieldGroup {
            id: id.to_owned(),
            title: text(id, id),
            description: None,
            field_ids: field_ids.iter().map(|value| (*value).to_owned()).collect(),
        }
    }

    fn definition(fields: Vec<FieldDefinition>, groups: Vec<FieldGroup>) -> NodeDefinition {
        NodeDefinition {
            actions: vec![NodeAction { id: "run".to_owned(), label: text("执行", "Run") }],
            danger: DangerGate::None,
            danger_prompt: None,
            danger_prompt_export: None,
            dashboard: None,
            definition_version: DEFINITION_VERSION_V1,
            description: text("一个节点", "A node."),
            fields,
            groups,
            input_bindings: vec![InputBinding {
                field_id: "a".to_owned(),
                slot: "a".to_owned(),
                transform: Transform::Identity,
                default_export: None,
            }],
            node_id: PluginId::try_new("probe").expect("identifier"),
            preview_export: None,
            publishes_output_path: false,
            reports_progress: false,
            result_export: None,
            result_table: None,
            title: text("探针", "Probe"),
        }
    }

    fn all_visible() -> impl Fn(&FieldDefinition) -> bool {
        |_| true
    }

    #[test]
    fn a_group_with_nothing_to_show_loses_its_tab_and_the_strip_with_it() {
        let node = definition(
            vec![field("a"), field("b")],
            vec![group("paths", &["a"]), group("advanced", &["b"])],
        );
        let surface = plan_surface(&node, all_visible());
        assert_eq!(surface.sections.iter().map(|section| section.id).collect::<Vec<_>>(), vec!["paths", "advanced"]);
        assert!(shows_tab_strip(&surface));

        // Hide `b`: the advanced tab disappears and one tab is left, which is no longer a strip.
        let hiding = |field: &FieldDefinition| field.id != "b";
        let shrunk = plan_surface(&node, hiding);
        assert_eq!(shrunk.sections.iter().map(|section| section.id).collect::<Vec<_>>(), vec!["paths"]);
        assert!(!shows_tab_strip(&shrunk), "one section must not render a tab strip");
    }

    #[test]
    fn fields_no_group_claimed_fall_into_the_overflow_section() {
        let node = definition(vec![field("a"), field("b"), field("c")], vec![group("paths", &["a", "b"])]);
        let surface = plan_surface(&node, all_visible());
        let ids: Vec<&str> = surface.sections.iter().map(|section| section.id).collect();
        assert_eq!(ids, vec!["paths", OVERFLOW_SECTION_ID]);
        let overflow = surface.sections.last().expect("overflow section");
        assert_eq!(overflow.fields.iter().map(|field| field.id.as_str()).collect::<Vec<_>>(), vec!["c"]);
        assert_eq!(overflow.title, super::overflow_title());

        // No groups at all is the degenerate case: everything is the remainder.
        let ungrouped_node = definition(vec![field("a")], Vec::new());
        let ungrouped = plan_surface(&ungrouped_node, all_visible());
        assert_eq!(ungrouped.sections.len(), 1);
        assert_eq!(ungrouped.sections[0].id, OVERFLOW_SECTION_ID);
    }

    #[test]
    fn a_group_listing_an_unknown_or_hidden_id_contributes_nothing_for_it() {
        let node = definition(vec![field("a")], vec![group("paths", &["a", "ghost"]), group("empty", &["ghost"])]);
        let surface = plan_surface(&node, all_visible());
        assert_eq!(surface.sections.iter().map(|section| section.id).collect::<Vec<_>>(), vec!["paths"]);
        assert_eq!(surface.sections[0].fields.len(), 1, "the unknown id is skipped, not rendered as a blank row");
    }

    #[test]
    fn the_action_selector_is_reported_apart_and_the_result_areas_come_from_the_definition() {
        let mut selector = field("action");
        selector.is_action_selector = true;
        selector.kind = FieldKind::Select;
        let mut node = definition(vec![selector, field("a")], vec![group("paths", &["a"])]);
        node.result_table = Some(ResultTableSpec {
            columns: vec![ResultColumn { id: "path".to_owned(), label: text("路径", "Path"), width: None }],
            empty_message: None,
        });

        let surface = plan_surface(&node, all_visible());
        assert_eq!(surface.action_selector.map(|field| field.id.as_str()), Some("action"));
        assert!(surface.has_result_table);
        assert!(!surface.has_dashboard);

        // An empty result table means there is nothing to draw, even though the node declared one.
        let mut emptied = node.clone();
        emptied.result_table = Some(ResultTableSpec { columns: Vec::new(), empty_message: None });
        assert!(!plan_surface(&emptied, all_visible()).has_result_table);
    }

    #[test]
    fn the_shared_evaluator_is_what_makes_a_tab_appear_and_vanish() {
        // `b` is gated on an action answer, so the sections follow the one evaluator rather than a local rule.
        let mut gated = field("b");
        gated.visible = Condition::Single(Predicate::holds(Test::ActionIs {
            action_field: "action".to_owned(),
            allowed: vec!["advanced".to_owned()],
        }));
        let node = definition(vec![field("a"), gated], vec![group("paths", &["a"]), group("advanced", &["b"])]);

        let plain = plan_visible_surface(&node, &values_with("action", "basic"));
        assert_eq!(plain.sections.iter().map(|section| section.id).collect::<Vec<_>>(), vec!["paths"]);
        assert!(!shows_tab_strip(&plain));

        let expanded = plan_visible_surface(&node, &values_with("action", "advanced"));
        assert_eq!(expanded.sections.iter().map(|section| section.id).collect::<Vec<_>>(), vec!["paths", "advanced"]);
        assert!(shows_tab_strip(&expanded));
    }

    fn values_with(key: &str, value: &str) -> Values {
        let mut values = Values::new();
        values.insert(key.to_owned(), Scalar::Text(value.to_owned()));
        values
    }

}
