// Split out of node_definition.rs to keep each file under the maintained source-size limit (AGENTS.md).

    use super::*;

    /// Both sides get the same text, which is enough for a fixture; the localization guard only checks
    /// that neither side is blank.
    fn always() -> Condition {
        Condition::Single(Predicate::holds(Test::Always))
    }

    fn action_is(allowed: &[&str]) -> Condition {
        Condition::Single(Predicate::holds(Test::ActionIs {
            action_field: "action".to_owned(),
            allowed: allowed.iter().map(|id| (*id).to_owned()).collect(),
        }))
    }

    fn field_true(field_id: &str) -> Condition {
        Condition::Single(Predicate::holds(Test::FieldTrue { field_id: field_id.to_owned() }))
    }

    fn t(text: &str) -> LocalizedText {
        LocalizedText::new(text, text)
    }

    fn action(id: &str) -> NodeAction {
        NodeAction { id: id.to_owned(), label: t(id) }
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
                    label: t(id),
                    hint: None,
                    disabled: false,
                })
                .collect(),
            placeholder: None,
            lines: None,
            range: None,
            default: Some(Scalar::Text("scan".to_owned())),
            visible: always(),
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
                    visible: action_is(&["scan"]),
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
                    range: Some(FieldRange { min: Some(0.0), max: None, step: Some(100.0) }),
                    default: Some(Scalar::Number(0.0)),
                    visible: action_is(&["scan"]),
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
                    visible: action_is(&["rename"]),
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
                        Predicate::holds(Test::ActionIs {
                            action_field: "action".to_owned(),
                            allowed: vec!["undo".to_owned()],
                        }),
                        Predicate::holds(Test::ActionIs {
                            action_field: "action".to_owned(),
                            allowed: vec!["history".to_owned()],
                        }),
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
                Predicate::holds(Test::ActionIs { action_field: "action".to_owned(), allowed: vec!["rename".to_owned()] }),
                Predicate::fails(Test::FieldTrue { field_id: "dryRun".to_owned() }),
            ]),
            danger_prompt_export: None,
            danger_prompt: Some(DangerPrompt {
                title: t("Confirm live rename"),
                body: t("Files will be moved."),
                confirm_label: t("Move files"),
            }),
            preview_export: Some("preview".to_owned()),
            result_export: Some("result_view".to_owned()),
            reports_progress: true,
            publishes_output_path: false,
            dashboard: None,
            result_table: None,
            help: None,
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
        definition.fields[1].visible = field_true("ghost");
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
        definition.fields[2].range = Some(FieldRange { min: Some(90.0), max: Some(10.0), step: Some(1.0) });
        assert_eq!(definition.validate(), Err(DefinitionError::InvertedRange { field_id: "maxLines".to_owned() }));

        let mut definition = trename_like();
        definition.fields[1].range = Some(FieldRange { min: None, max: None, step: Some(1.0) });
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
                        Predicate::holds(Test::FieldFilled { field_id: "preview".to_owned() }),
                        Predicate::fails(Test::FieldEquals {
                            field_id: "action".to_owned(),
                            value: Scalar::Text("apply".to_owned()),
                        }),
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
                    range: Some(FieldRange { min: Some(1.0), max: Some(500.0), step: Some(1.0) }),
                    default: Some(Scalar::Number(50.0)),
                    visible: always(),
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
                    visible: always(),
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
            danger_prompt_export: None,
            danger_prompt: Some(DangerPrompt {
                title: t("Confirm"),
                body: t("Files will be renamed."),
                confirm_label: t("Apply"),
            }),
            preview_export: None,
            result_export: None,
            reports_progress: false,
            publishes_output_path: true,
            dashboard: None,
            result_table: None,
            help: None,
        };
        assert_eq!(definition.validate(), Ok(()));
        assert_eq!(definition.groups, Vec::new(), "a node may declare no field groups at all");
        assert!(
            definition
                .fields
                .iter()
                .find(|field| field.id == "limit")
                .expect("limit")
                .kind
                .carries_range(),
            "a number field carries a range"
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
        definition.fields[1].visible = always();
        definition.fields[1].rules = vec![GuardedRule::only(
            Rule::AtLeastLines { minimum: 1 },
            Condition::Single(Predicate::fails(Test::ActionIs {
                action_field: "action".to_owned(),
                allowed: vec!["undo".to_owned()],
            })),
        )];
        assert_eq!(definition.validate(), Ok(()));

        let mut definition = trename_like();
        definition.fields[1].rules = vec![GuardedRule::only(Rule::Required, field_true("ghost"))];
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

    #[test]
    fn a_declared_dashboard_replaces_the_display_closure() {
        // snf's dashboard is `primary: first(pathsText), secondary: String(mode), metrics: []`
        // (`packages/nodes/snf/src/interaction.ts`), and trename's shows the selected action.
        let mut definition = trename_like();
        definition.dashboard = Some(DashboardSpec {
            title: LocalizedText::new("状态", "Status"),
            description: None,
            primary: ValueSource::ActionLabel,
            secondary: Some(ValueSource::Field { field_id: "paths".to_owned() }),
            metrics: vec![DashboardMetric {
                label: LocalizedText::new("分段行数", "Lines per segment"),
                source: ValueSource::Field { field_id: "maxLines".to_owned() },
            }],
        });
        assert_eq!(definition.validate(), Ok(()));

        let mut definition = trename_like();
        definition.dashboard = Some(DashboardSpec {
            title: LocalizedText::new("状态", "Status"),
            description: None,
            primary: ValueSource::Field { field_id: "ghost".to_owned() },
            secondary: None,
            metrics: Vec::new(),
        });
        assert_eq!(
            definition.validate(),
            Err(DefinitionError::UnknownFieldReference { referenced: "ghost".to_owned() }),
            "the dashboard may only read declared fields"
        );

        let mut definition = trename_like();
        definition.dashboard = Some(DashboardSpec {
            title: LocalizedText::new("状态", "Status"),
            description: None,
            primary: ValueSource::Literal(LocalizedText::new("", "Idle")),
            secondary: None,
            metrics: Vec::new(),
        });
        assert_eq!(
            definition.validate(),
            Err(DefinitionError::IncompleteLocalization { owner: "dashboard.primary".to_owned() }),
            "a literal value is authored copy too"
        );
    }

    #[test]
    fn result_table_columns_are_unique_and_non_empty() {
        let column = |id: &str, width: Option<u32>| ResultColumn {
            id: id.to_owned(),
            label: LocalizedText::new(id, id),
            width,
        };
        let mut definition = trename_like();
        definition.result_table = Some(ResultTableSpec {
            columns: vec![column("path", Some(44)), column("operation", Some(10)), column("status", Some(10))],
            empty_message: Some(LocalizedText::new("无结果", "No results")),
        });
        assert_eq!(definition.validate(), Ok(()));

        let mut definition = trename_like();
        definition.result_table = Some(ResultTableSpec {
            columns: vec![column("path", None), column("path", None)],
            empty_message: None,
        });
        assert_eq!(definition.validate(), Err(DefinitionError::DuplicateColumnId { column_id: "path".to_owned() }));

        let mut definition = trename_like();
        definition.result_table = Some(ResultTableSpec { columns: Vec::new(), empty_message: None });
        assert_eq!(definition.validate(), Err(DefinitionError::EmptyResultTable));
    }

    #[test]
    fn an_or_of_ands_is_declared_not_nested() {
        // marku/migratef need `(action is move|copy and not dry_run) or action is history`.
        // A nested condition tree would be unrepresentable in WIT, so the contract's shape for this is
        // `AnyAll`: one list of conjunctions.
        let mut definition = trename_like();
        definition.fields[1].visible = Condition::AnyAll(vec![
            vec![
                Predicate::holds(Test::ActionIs {
                    action_field: "action".to_owned(),
                    allowed: vec!["scan".to_owned()],
                }),
                Predicate::fails(Test::FieldTrue { field_id: "dryRun".to_owned() }),
            ],
            vec![Predicate::holds(Test::ActionIs {
                action_field: "action".to_owned(),
                allowed: vec!["undo".to_owned()],
            })],
        ]);
        assert_eq!(definition.validate(), Ok(()));

        let mut definition = trename_like();
        definition.fields[1].visible = Condition::AnyAll(vec![vec![Predicate::holds(
            Test::FieldTrue { field_id: "ghost".to_owned() },
        )]]);
        assert_eq!(
            definition.validate(),
            Err(DefinitionError::UnknownFieldReference { referenced: "ghost".to_owned() }),
            "each clause of the normal form is reference-checked like any other"
        );
    }

    #[test]
    fn never_a_test_and_a_float_bound_are_declared_not_faked() {
        // cleanf hides a field with `visibleWhen: () => false`; a negated Always is a different claim.
        let mut definition = trename_like();
        definition.fields[1].visible = Condition::Single(Predicate::holds(Test::Never));
        assert_eq!(definition.validate(), Ok(()));

        // bitv's `positive` guard has a fractional bound, which an integer rule cannot state.
        let mut definition = trename_like();
        definition.fields[2].rules = vec![
            GuardedRule::always(Rule::NumberAtLeast { minimum: 0.5 }),
            GuardedRule::always(Rule::NumberInRange),
        ];
        assert_eq!(definition.validate(), Ok(()));

        // repacku's gate is a disjunction of two flags.
        let mut definition = trename_like();
        definition.danger = DangerGate::Any(vec![
            Predicate::fails(Test::FieldTrue { field_id: "dryRun".to_owned() }),
            Predicate::holds(Test::FieldTrue { field_id: "dryRun".to_owned() }),
        ]);
        assert_eq!(definition.validate(), Ok(()));

        let mut definition = trename_like();
        definition.danger = DangerGate::Any(vec![Predicate::holds(Test::FieldTrue {
            field_id: "ghost".to_owned(),
        })]);
        assert_eq!(
            definition.validate(),
            Err(DefinitionError::DangerReferencesUnknownField { field_id: "ghost".to_owned() })
        );
    }

    #[test]
    fn a_prompt_either_authored_or_computed_never_both() {
        let mut definition = trename_like();
        definition.danger_prompt_export = Some("danger_prompt".to_owned());
        definition.danger_prompt = None;
        assert_eq!(definition.validate(), Ok(()));

        let mut definition = trename_like();
        definition.danger_prompt_export = Some("danger_prompt".to_owned());
        assert_eq!(definition.validate(), Err(DefinitionError::ContradictoryDangerPrompt));

        let mut definition = trename_like();
        definition.danger_prompt_export = Some(" ".to_owned());
        definition.danger_prompt = None;
        assert_eq!(definition.validate(), Err(DefinitionError::MissingExportName));
    }

    #[test]
    fn an_empty_compound_is_refused_because_it_silently_means_always_or_never() {
        let mut definition = trename_like();
        definition.fields[1].visible = Condition::All(Vec::new());
        assert!(matches!(
            definition.validate(),
            Err(DefinitionError::EmptyCondition { owner }) if owner.starts_with("paths.visible")
        ));

        let mut definition = trename_like();
        definition.fields[1].visible = Condition::AnyAll(vec![Vec::new()]);
        assert!(matches!(definition.validate(), Err(DefinitionError::EmptyCondition { .. })));

        let mut definition = trename_like();
        definition.danger = DangerGate::Any(Vec::new());
        assert_eq!(definition.validate(), Err(DefinitionError::EmptyCondition { owner: "danger".to_owned() }));
    }

    #[test]
    fn a_rule_can_carry_the_nodes_own_failure_copy_in_both_languages() {
        let mut definition = trename_like();
        definition.fields[1].rules = vec![GuardedRule {
            rule: Rule::AtLeastLines { minimum: 1 },
            message: Some(LocalizedText::new("请至少输入一个目录。", "Enter at least one folder.")),
            when: None,
        }];
        assert_eq!(definition.validate(), Ok(()));

        let mut definition = trename_like();
        definition.fields[1].rules = vec![GuardedRule {
            rule: Rule::Required,
            message: Some(LocalizedText::new("请填写", " ")),
            when: None,
        }];
        assert_eq!(
            definition.validate(),
            Err(DefinitionError::IncompleteLocalization { owner: "field.paths.rule.message".to_owned() }),
            "the node's own message is authored copy, so it is checked like every other string"
        );
    }

mod help_block {
    use super::*;

    fn list(zh: &[&str], en: &[&str]) -> LocalizedList {
        LocalizedList::new(zh.iter().map(|line| (*line).to_owned()).collect(), en.iter().map(|line| (*line).to_owned()).collect())
    }

    /// The block a real node publishes: one workflow with steps, one command with an example, safety notes.
    fn complete() -> NodeHelpBlock {
        NodeHelpBlock {
            when_to_use: list(&["目录需要整理时"], &["When a folder needs sorting"]),
            workflows: vec![HelpWorkflow {
                title: LocalizedText::new("工作区 UI", "Workspace UI"),
                summary: Some(LocalizedText::new("从节点面板运行。", "Run it from the node surface.")),
                entries: vec![HelpWorkflowEntry { surface: HelpSurface::WorkspaceUi, lines: list(&["打开模块库。"], &["Open the registry."]) }],
            }],
            commands: vec![HelpCommand {
                title: LocalizedText::new("节点 CLI", "Node CLI"),
                command: Some("xiranite sample".to_owned()),
                description: Some(LocalizedText::new("打开引导式运行。", "Open the guided run.")),
                examples: vec![HelpCommandExample {
                    label: Some(LocalizedText::new("引导模式", "Guided mode")),
                    command: "xiranite sample".to_owned(),
                    description: None,
                }],
            }],
            safety: Some(HelpSafety {
                default_mode: Some("preview".to_owned()),
                destructive: LocalizedList::new(Vec::new(), Vec::new()),
                notes: list(&["未确认前不写入。"], &["Nothing is written until you confirm."]),
            }),
        }
    }

    #[test]
    fn a_complete_block_validates_and_the_surfaces_keep_the_dictionaries_spellings() {
        let definition = NodeDefinition { help: Some(complete()), ..trename_like() };
        definition.validate().expect("a block built from the node's own lines is self-consistent");
        let help = definition.help.expect("the block was set");
        assert_eq!(help.localization_problems(), Vec::<String>::new(), "a complete block reports nothing");
        let wires: Vec<&str> = HelpSurface::ALL.iter().map(|surface| surface.as_str()).collect();
        assert_eq!(wires, ["ui", "cli", "tips"], "the wire keys are the help.ts keys the TS gate reads");
    }

    #[test]
    fn half_a_paragraph_is_named_by_its_own_path() {
        // The mistake a translation makes: three Chinese steps for two English ones, which would render two
        // bullets in one language and three in the other.
        let mut help = complete();
        help.workflows[0].entries[0].lines = list(&["一", "二", "三"], &["one", "two"]);
        let definition = NodeDefinition { help: Some(help), ..trename_like() };
        assert_eq!(
            definition.help.as_ref().expect("block").localization_problems(),
            vec!["help.workflows[0].ui".to_owned()],
            "the report names the entry, not the whole block"
        );
        assert_eq!(
            definition.validate().err(),
            Some(DefinitionError::IncompleteLocalization { owner: "help.workflows[0].ui".to_owned() }),
        );
    }

    #[test]
    fn a_blank_line_inside_a_step_is_a_localization_problem() {
        let mut help = complete();
        help.when_to_use = list(&[" "], &["When a folder needs sorting"]);
        let definition = NodeDefinition { help: Some(help), ..trename_like() };
        assert!(definition.help.as_ref().expect("block").localization_problems().contains(&"help.whenToUse".to_owned()));
    }

    #[test]
    fn an_empty_block_is_refused_instead_of_rendering_a_blank_help_card() {
        let empty = NodeHelpBlock {
            when_to_use: LocalizedList::new(Vec::new(), Vec::new()),
            workflows: Vec::new(),
            commands: Vec::new(),
            safety: None,
        };
        let definition = NodeDefinition { help: Some(empty), ..trename_like() };
        assert_eq!(definition.validate().err(), Some(DefinitionError::EmptyHelp));
    }

    #[test]
    fn a_node_without_a_dictionary_still_validates_so_the_debt_stays_shippable() {
        let definition = NodeDefinition { help: None, ..trename_like() };
        definition.validate().expect("the block is optional in the language");
    }
}
