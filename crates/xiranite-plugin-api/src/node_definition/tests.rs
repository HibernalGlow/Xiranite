// Split out of node_definition.rs to keep each file under the maintained source-size limit (AGENTS.md).

    use super::*;

    /// Both sides get the same text, which is enough for a fixture; the localization guard only checks
    /// that neither side is blank.
    fn t(text: &str) -> LocalizedText {
        LocalizedText::new(text, text)
    }

    fn action(id: &str) -> NodeAction {
        NodeAction { id: id.to_owned(), label: t(id), help_key: format!("action.{id}") }
    }

    fn selector(actions: &[&str]) -> FieldDefinition {
        FieldDefinition {
            id: "action".to_owned(),
            label: t("Action"),
            description: None,
            kind: FieldKind::Select,
            is_action_selector: true,
            options: actions
                .iter()
                .map(|id| FieldOption {
                    value: Scalar::Text((*id).to_owned()),
                    label: t(*id),
                    hint: None,
                    disabled: false,
                })
                .collect(),
            placeholder: None,
            lines: None,
            range: None,
            default: Some(Scalar::Text("scan".to_owned())),
            visible: Condition::Always,
            rules: vec![GuardedRule::always(Rule::OneOfDeclaredOptions)],
        }
    }

    /// The trename shape: `scan` / `import` / `validate` / `rename` / `undo` / `history`, a paths list
    /// visible only for `scan`, a `maxLines` number with the non-negative integer rule, and a live
    /// rename that must be confirmed.
    fn trename_like() -> NodeDefinition {
        let actions = ["scan", "import", "validate", "rename", "undo", "history"];
        NodeDefinition {
            definition_version: DEFINITION_VERSION_V1,
            node_id: PluginId::try_new("trename").expect("valid id"),
            title: t("Trename"),
            description: t("中文路径转英文"),
            actions: actions.iter().map(|id| action(id)).collect(),
            fields: vec![
                selector(&actions),
                FieldDefinition {
                    id: "paths".to_owned(),
                    label: t("Folders"),
                    description: Some(t("One folder per line")),
                    kind: FieldKind::PathList,
                    is_action_selector: false,
                    options: Vec::new(),
                    placeholder: None,
                    lines: Some(4),
                    range: None,
                    default: Some(Scalar::Text(String::new())),
                    visible: Condition::ActionIs {
                        action_field: "action".to_owned(),
                        allowed: vec!["scan".to_owned()],
                    },
                    rules: vec![GuardedRule::always(Rule::AtLeastLines { minimum: 1 })],
                },
                FieldDefinition {
                    id: "maxLines".to_owned(),
                    label: t("Lines per segment"),
                    description: None,
                    kind: FieldKind::Number,
                    is_action_selector: false,
                    options: Vec::new(),
                    placeholder: None,
                    lines: None,
                    range: Some(FieldRange { min: Some(0.0), max: None, step: 100.0 }),
                    default: Some(Scalar::Number(0.0)),
                    visible: Condition::ActionIs {
                        action_field: "action".to_owned(),
                        allowed: vec!["scan".to_owned()],
                    },
                    rules: vec![GuardedRule::always(Rule::IntegerAtLeast { minimum: 0 })],
                },
                FieldDefinition {
                    id: "dryRun".to_owned(),
                    label: t("Dry run"),
                    description: Some(t("Turning this off moves files")),
                    kind: FieldKind::Boolean,
                    is_action_selector: false,
                    options: Vec::new(),
                    placeholder: None,
                    lines: None,
                    range: None,
                    default: Some(Scalar::Boolean(true)),
                    visible: Condition::ActionIs {
                        action_field: "action".to_owned(),
                        allowed: vec!["rename".to_owned()],
                    },
                    rules: Vec::new(),
                },
                FieldDefinition {
                    id: "undoPath".to_owned(),
                    label: t("Undo store"),
                    description: None,
                    kind: FieldKind::Text,
                    is_action_selector: false,
                    options: Vec::new(),
                    placeholder: None,
                    lines: None,
                    range: None,
                    default: Some(Scalar::Text(String::new())),
                    visible: Condition::Any(vec![
                        Condition::ActionIs {
                            action_field: "action".to_owned(),
                            allowed: vec!["undo".to_owned()],
                        },
                        Condition::ActionIs {
                            action_field: "action".to_owned(),
                            allowed: vec!["history".to_owned()],
                        },
                    ]),
                    rules: Vec::new(),
                },
            ],
            groups: vec![
                FieldGroup {
                    id: "source".to_owned(),
                    title: t("Source"),
                    description: None,
                    field_ids: vec!["action".to_owned(), "paths".to_owned(), "maxLines".to_owned()],
                },
                FieldGroup {
                    id: "apply".to_owned(),
                    title: t("Apply"),
                    description: None,
                    field_ids: vec!["dryRun".to_owned(), "undoPath".to_owned()],
                },
            ],
            input_bindings: vec![
                InputBinding { field_id: "action".to_owned(), slot: "action".to_owned(), transform: Transform::Trim, default_export: None },
                InputBinding { field_id: "paths".to_owned(), slot: "paths".to_owned(), transform: Transform::Lines, default_export: None },
                InputBinding {
                    field_id: "maxLines".to_owned(),
                    slot: "maxLines".to_owned(),
                    transform: Transform::AsInteger,
                    default_export: None,
                },
                InputBinding { field_id: "dryRun".to_owned(), slot: "dryRun".to_owned(), transform: Transform::Identity, default_export: None },
            ],
            danger: DangerGate::All(vec![
                Condition::ActionIs { action_field: "action".to_owned(), allowed: vec!["rename".to_owned()] },
                Condition::Not(Box::new(Condition::FieldTrue { field_id: "dryRun".to_owned() })),
            ]),
            danger_prompt: Some(DangerPrompt {
                title: t("Confirm live rename"),
                body: t("Files will be moved."),
                confirm_label: t("Move files"),
            }),
            preview_export: Some("preview".to_owned()),
            result_export: Some("result_view".to_owned()),
            reports_progress: true,
            publishes_output_path: false,
        }
    }

    #[test]
    fn a_trename_shaped_definition_is_self_consistent() {
        let definition = trename_like();
        assert_eq!(definition.validate(), Ok(()));
        assert_eq!(definition.action_selector().expect("selector").id, "action");
        let defaults = definition.default_values();
        assert!(defaults.iter().any(|(id, value)| id == "dryRun" && value == &Scalar::Boolean(true)));
        // The scalar display form keeps integers readable in a field summary.
        assert_eq!(Scalar::Number(320.0).display_text(), "320");
        assert_eq!(Scalar::Number(1.5).display_text(), "1.5");
    }

    #[test]
    fn field_kinds_are_the_six_the_typescript_union_lists() {
        let wire: Vec<&str> = FieldKind::ALL.iter().map(FieldKind::as_str).collect();
        assert_eq!(wire, vec!["text", "multiline", "path-list", "number", "select", "boolean"]);
        for label in wire {
            assert_eq!(FieldKind::from_wire(label).map(|kind| kind.as_str()), Some(label));
        }
        assert_eq!(FieldKind::from_wire("dropdown"), None, "a kind the union lacks must not decode");
    }

    #[test]
    fn an_action_selector_must_offer_exactly_the_declared_actions() {
        let mut definition = trename_like();
        definition.actions.retain(|action| action.id != "history");
        assert_eq!(
            definition.validate(),
            Err(DefinitionError::ActionSelectorMismatch { field_id: "action".to_owned() }),
            "dropping an action without dropping its option is a definition bug"
        );
    }

    #[test]
    fn conditions_groups_and_bindings_may_only_read_declared_fields() {
        let mut definition = trename_like();
        definition.fields[1].visible = Condition::FieldTrue { field_id: "ghost".to_owned() };
        assert_eq!(
            definition.validate(),
            Err(DefinitionError::UnknownFieldReference { referenced: "ghost".to_owned() })
        );

        let mut definition = trename_like();
        definition.groups[0].field_ids.push("ghost".to_owned());
        assert_eq!(
            definition.validate(),
            Err(DefinitionError::UnknownFieldReference { referenced: "ghost".to_owned() })
        );

        let mut definition = trename_like();
        definition.input_bindings.push(InputBinding {
            field_id: "ghost".to_owned(),
            slot: "x".to_owned(),
            transform: Transform::Identity,
            default_export: None,
        });
        assert_eq!(
            definition.validate(),
            Err(DefinitionError::BindingReferencesUnknownField { field_id: "ghost".to_owned() })
        );

        let mut definition = trename_like();
        definition.danger = DangerGate::FieldFlag { field_id: "ghost".to_owned(), inverted: false };
        assert_eq!(
            definition.validate(),
            Err(DefinitionError::DangerReferencesUnknownField { field_id: "ghost".to_owned() })
        );
    }

    #[test]
    fn type_and_range_mistakes_are_reported_per_field() {
        let mut definition = trename_like();
        definition.fields[2].default = Some(Scalar::Text("12".to_owned()));
        assert_eq!(
            definition.validate(),
            Err(DefinitionError::DefaultKindMismatch { field_id: "maxLines".to_owned() })
        );

        let mut definition = trename_like();
        definition.fields[2].range = Some(FieldRange { min: Some(90.0), max: Some(10.0), step: 1.0 });
        assert_eq!(definition.validate(), Err(DefinitionError::InvertedRange { field_id: "maxLines".to_owned() }));

        let mut definition = trename_like();
        definition.fields[1].range = Some(FieldRange { min: None, max: None, step: 1.0 });
        assert_eq!(
            definition.validate(),
            Err(DefinitionError::RangeOnNonNumberField { field_id: "paths".to_owned() }),
            "bounds belong to number fields; a path list has `lines`"
        );
    }

    #[test]
    fn escape_hatches_must_name_the_plugin_export() {
        let mut definition = trename_like();
        definition.fields[1].rules.push(GuardedRule::always(Rule::Custom { export_name: "  ".to_owned() }));
        assert_eq!(definition.validate(), Err(DefinitionError::MissingExportName));

        let mut definition = trename_like();
        definition.preview_export = Some(String::new());
        assert_eq!(definition.validate(), Err(DefinitionError::MissingExportName));

        let mut definition = trename_like();
        definition.danger = DangerGate::PluginExport { export_name: "is_dangerous".to_owned() };
        assert_eq!(definition.validate(), Ok(()), "a named export gate is legal");
    }

    #[test]
    fn an_empty_action_list_and_duplicate_ids_are_refused() {
        let mut definition = trename_like();
        definition.actions.clear();
        assert_eq!(definition.validate(), Err(DefinitionError::NoActions));

        let mut definition = trename_like();
        let clone = definition.fields[3].clone();
        definition.fields.push(clone);
        assert_eq!(definition.validate(), Err(DefinitionError::DuplicateFieldId { field_id: "dryRun".to_owned() }));
    }

    #[test]
    fn select_fields_must_offer_something() {
        let mut definition = trename_like();
        definition.fields[0].options.clear();
        assert_eq!(definition.validate(), Err(DefinitionError::SelectWithoutOptions { field_id: "action".to_owned() }));
    }

    /// The rest of the vocabulary — the conditions, rules and gates trename happens not to use — must
    /// also build and validate, otherwise a variant exists only on paper.
    #[test]
    fn the_other_condition_rule_and_gate_variants_validate_too() {
        let actions = ["convert", "apply"];
        let definition = NodeDefinition {
            definition_version: DEFINITION_VERSION_V1,
            node_id: PluginId::try_new("nameu").expect("valid id"),
            title: t("Nameu"),
            description: t("批量命名"),
            actions: actions.iter().map(|id| action(id)).collect(),
            fields: vec![
                selector(&actions),
                FieldDefinition {
                    id: "template".to_owned(),
                    label: t("Template"),
                    description: None,
                    kind: FieldKind::Text,
                    is_action_selector: false,
                    options: Vec::new(),
                    placeholder: Some(t("{n}")),
                    lines: None,
                    range: None,
                    default: Some(Scalar::Text(String::new())),
                    visible: Condition::All(vec![
                        Condition::FieldFilled { field_id: "preview".to_owned() },
                        Condition::Not(Box::new(Condition::FieldEquals {
                            field_id: "action".to_owned(),
                            value: Scalar::Text("apply".to_owned()),
                        })),
                    ]),
                    rules: vec![GuardedRule::always(Rule::Required), GuardedRule::always(Rule::NonBlank)],
                },
                FieldDefinition {
                    id: "limit".to_owned(),
                    label: t("Limit"),
                    description: None,
                    kind: FieldKind::Number,
                    is_action_selector: false,
                    options: Vec::new(),
                    placeholder: None,
                    lines: None,
                    range: Some(FieldRange { min: Some(1.0), max: Some(500.0), step: 1.0 }),
                    default: Some(Scalar::Number(50.0)),
                    visible: Condition::Always,
                    rules: vec![GuardedRule::always(Rule::IntegerInRange)],
                },
                FieldDefinition {
                    id: "preview".to_owned(),
                    label: t("Preview"),
                    description: None,
                    kind: FieldKind::Boolean,
                    is_action_selector: false,
                    options: Vec::new(),
                    placeholder: None,
                    lines: None,
                    range: None,
                    default: Some(Scalar::Boolean(true)),
                    visible: Condition::Always,
                    rules: Vec::new(),
                },
            ],
            groups: Vec::new(),
            input_bindings: vec![
                InputBinding { field_id: "template".to_owned(), slot: "template".to_owned(), transform: Transform::TrimOrOmit, default_export: None },
                InputBinding {
                    field_id: "limit".to_owned(),
                    slot: "limit".to_owned(),
                    transform: Transform::AsInteger,
                    default_export: None,
                },
                InputBinding {
                    field_id: "preview".to_owned(),
                    slot: "preview".to_owned(),
                    transform: Transform::AsBoolean,
                    default_export: None,
                },
            ],
            danger: DangerGate::ActionIn {
                action_field: "action".to_owned(),
                dangerous: vec!["apply".to_owned()],
            },
            danger_prompt: Some(DangerPrompt {
                title: t("Confirm"),
                body: t("Files will be renamed."),
                confirm_label: t("Apply"),
            }),
            preview_export: None,
            result_export: None,
            reports_progress: false,
            publishes_output_path: true,
        };
        assert_eq!(definition.validate(), Ok(()));
        assert_eq!(definition.groups, Vec::new(), "a node may declare no field groups at all");
        assert_eq!(
            definition
                .fields
                .iter()
                .find(|field| field.id == "limit")
                .expect("limit")
                .kind
                .carries_range(),
            true
        );
    }

    #[test]
    fn authored_copy_must_carry_both_languages() {
        let mut definition = trename_like();
        definition.title = LocalizedText::new("", "Trename");
        assert_eq!(
            definition.validate(),
            Err(DefinitionError::IncompleteLocalization { owner: "title".to_owned() }),
            "a blank side would render an empty heading for Chinese users"
        );

        let mut definition = trename_like();
        definition.fields[1].description = Some(LocalizedText::new("每行一个目录", " "));
        assert_eq!(
            definition.validate(),
            Err(DefinitionError::IncompleteLocalization {
                owner: "field.paths.description".to_owned()
            })
        );

        let text = LocalizedText::new("扫描目录", "Folders");
        assert_eq!(text.resolve("zh"), "扫描目录");
        assert_eq!(text.resolve("en"), "Folders");
        assert_eq!(text.resolve("de"), "扫描目录", "only English opts out of the Chinese default");
    }

    #[test]
    fn a_binding_may_name_a_defaulting_export_and_it_cannot_be_blank() {
        let mut definition = trename_like();
        definition.input_bindings[0].default_export = Some("default_action".to_owned());
        assert_eq!(definition.validate(), Ok(()), "a named export is the declared escape hatch");

        let mut definition = trename_like();
        definition.input_bindings[0].default_export = Some(" ".to_owned());
        assert_eq!(definition.validate(), Err(DefinitionError::MissingExportName));
    }

    #[test]
    fn a_rule_may_become_conditional_without_becoming_a_plugin_export() {
        // transq: roots are required for every action except `status`
        // (`packages/nodes/transq/src/interaction.ts:9`).
        let mut definition = trename_like();
        definition.fields[1].visible = Condition::Always;
        definition.fields[1].rules = vec![GuardedRule::only(
            Rule::AtLeastLines { minimum: 1 },
            Condition::Not(Box::new(Condition::ActionIs {
                action_field: "action".to_owned(),
                allowed: vec!["undo".to_owned()],
            })),
        )];
        assert_eq!(definition.validate(), Ok(()));

        let mut definition = trename_like();
        definition.fields[1].rules = vec![GuardedRule::only(
            Rule::Required,
            Condition::FieldTrue { field_id: "ghost".to_owned() },
        )];
        assert_eq!(
            definition.validate(),
            Err(DefinitionError::UnknownFieldReference { referenced: "ghost".to_owned() }),
            "a conditional rule may not read a field the definition does not declare"
        );
    }

    #[test]
    fn duplicate_action_ids_are_refused() {
        let mut definition = trename_like();
        definition.actions.push(action("scan"));
        assert_eq!(definition.validate(), Err(DefinitionError::DuplicateActionId { action_id: "scan".to_owned() }));
    }

    #[test]
    fn a_gate_naming_a_dangerous_action_that_is_not_declared_is_refused() {
        let mut definition = trename_like();
        definition.danger = DangerGate::ActionIn {
            action_field: "action".to_owned(),
            dangerous: vec!["delete-everything".to_owned()],
        };
        assert_eq!(
            definition.validate(),
            Err(DefinitionError::UnknownActionReference { referenced: "delete-everything".to_owned() })
        );
    }
