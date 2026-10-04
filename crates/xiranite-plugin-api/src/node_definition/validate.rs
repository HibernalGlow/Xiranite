//! Self-consistency checks for a published definition.
//!
//! These live apart from the types because they are the *rules*, and the rules are what the TypeScript gate
//! (`packages/node-definitions/src/contract.ts`) has to agree with item by item: a face only reads the
//! types, while a loader runs this before handing them out.

use std::collections::BTreeSet;

use super::{
    DangerGate, DefinitionError, FieldDefinition, FieldKind, LocalizedText, NodeDefinition, Rule, Scalar, ValueSource,
};

impl NodeDefinition {
    /// Check the invariants a face relies on.
    ///
    /// Every variant of [`DefinitionError`] is reachable from a real authoring mistake, and the checks
    /// are ordered so the first report is the one an author can act on.
    pub fn validate(&self) -> Result<(), DefinitionError> {
        if self.actions.is_empty() {
            return Err(DefinitionError::NoActions);
        }
        let mut action_ids: BTreeSet<String> = BTreeSet::new();
        for action in &self.actions {
            if !action_ids.insert(action.id.clone()) {
                return Err(DefinitionError::DuplicateActionId { action_id: action.id.clone() });
            }
        }

        let mut declared: BTreeSet<String> = BTreeSet::new();
        let mut selectors: Vec<&FieldDefinition> = Vec::new();
        for field in &self.fields {
            if !declared.insert(field.id.clone()) {
                return Err(DefinitionError::DuplicateFieldId { field_id: field.id.clone() });
            }
            if field.kind.carries_options() && field.options.is_empty() {
                return Err(DefinitionError::SelectWithoutOptions { field_id: field.id.clone() });
            }
            if !field.kind.carries_range() && field.range.is_some() {
                return Err(DefinitionError::RangeOnNonNumberField { field_id: field.id.clone() });
            }
            if let Some(range) = &field.range
                && let (Some(min), Some(max)) = (range.min, range.max)
                && min > max
            {
                return Err(DefinitionError::InvertedRange { field_id: field.id.clone() });
            }
            if let Some(default) = &field.default {
                let matches_kind = match field.kind {
                    FieldKind::Number => matches!(default, Scalar::Number(_)),
                    FieldKind::Boolean => matches!(default, Scalar::Boolean(_)),
                    _ => matches!(default, Scalar::Text(_)),
                };
                if !matches_kind {
                    return Err(DefinitionError::DefaultKindMismatch { field_id: field.id.clone() });
                }
            }
            for guarded in &field.rules {
                if let Some(message) = &guarded.message
                    && message.has_blank_side()
                {
                    return Err(DefinitionError::IncompleteLocalization {
                        owner: format!("field.{}.rule.message", field.id),
                    });
                }
                if let Rule::Custom { export_name } = &guarded.rule
                    && export_name.trim().is_empty()
                {
                    return Err(DefinitionError::MissingExportName);
                }
            }
            if field.is_action_selector {
                selectors.push(field);
            }
        }

        // Action selector, if declared, must offer exactly the declared actions.
        for selector in &selectors {
            let option_ids: BTreeSet<String> = selector
                .options
                .iter()
                .map(|option| option.value.display_text())
                .collect();
            if option_ids != action_ids {
                return Err(DefinitionError::ActionSelectorMismatch { field_id: selector.id.clone() });
            }
        }

        for field in &self.fields {
            if let Err(reason) = field.visible.reject_empty() {
                return Err(DefinitionError::EmptyCondition { owner: format!("{}.visible: {reason}", field.id) });
            }
            let mut referenced = BTreeSet::new();
            field.visible.referenced_fields(&mut referenced);
            for (index, guarded) in field.rules.iter().enumerate() {
                if let Some(when) = &guarded.when {
                    when.referenced_fields(&mut referenced);
                    if let Err(reason) = when.reject_empty() {
                        return Err(DefinitionError::EmptyCondition {
                            owner: format!("{}.rules[{index}].when: {reason}", field.id),
                        });
                    }
                }
                // An `anyFilled` rule reads other fields, so its references are checked like a condition's.
                if let Rule::AnyFilled { field_ids } = &guarded.rule {
                    referenced.extend(field_ids.iter().cloned());
                }
            }
            for reference in referenced {
                if !declared.contains(&reference) {
                    return Err(DefinitionError::UnknownFieldReference { referenced: reference });
                }
            }
        }

        for group in &self.groups {
            for field_id in &group.field_ids {
                if !declared.contains(field_id) {
                    return Err(DefinitionError::UnknownFieldReference { referenced: field_id.clone() });
                }
            }
        }

        for binding in &self.input_bindings {
            if !declared.contains(&binding.field_id) {
                return Err(DefinitionError::BindingReferencesUnknownField { field_id: binding.field_id.clone() });
            }
            if binding.default_export.as_deref().is_some_and(|name| name.trim().is_empty()) {
                return Err(DefinitionError::MissingExportName);
            }
        }

        let mut danger_fields = BTreeSet::new();
        match &self.danger {
            DangerGate::None => {}
            DangerGate::ActionIn { action_field, dangerous } => {
                danger_fields.insert(action_field.clone());
                for action in dangerous {
                    if !action_ids.contains(action) {
                        return Err(DefinitionError::UnknownActionReference { referenced: action.clone() });
                    }
                }
            }
            DangerGate::FieldFlag { field_id, .. } => {
                danger_fields.insert(field_id.clone());
            }
            DangerGate::All(predicates) | DangerGate::Any(predicates) => {
                if predicates.is_empty() {
                    return Err(DefinitionError::EmptyCondition { owner: "danger".to_owned() });
                }
                for predicate in predicates {
                    if let Some(field_id) = predicate.referenced_field() {
                        danger_fields.insert(field_id);
                    }
                }
            }
            DangerGate::PluginExport { export_name } => {
                if export_name.trim().is_empty() {
                    return Err(DefinitionError::MissingExportName);
                }
            }
        }
        for field_id in danger_fields {
            if !declared.contains(&field_id) {
                return Err(DefinitionError::DangerReferencesUnknownField { field_id });
            }
        }

        if let Some(dashboard) = &self.dashboard {
            let mut sources = vec![&dashboard.primary];
            sources.extend(dashboard.secondary.iter());
            for metric in &dashboard.metrics {
                sources.push(&metric.source);
            }
            for source in sources {
                let mut referenced = BTreeSet::new();
                source.referenced_fields(&mut referenced);
                for field_id in referenced {
                    if !declared.contains(&field_id) {
                        return Err(DefinitionError::UnknownFieldReference { referenced: field_id });
                    }
                }
            }
        }
        if let Some(table) = &self.result_table {
            let mut ids: BTreeSet<String> = BTreeSet::new();
            for column in &table.columns {
                if !ids.insert(column.id.clone()) {
                    return Err(DefinitionError::DuplicateColumnId { column_id: column.id.clone() });
                }
            }
            if table.columns.is_empty() {
                return Err(DefinitionError::EmptyResultTable);
            }
        }

        for export in self.preview_export.iter().chain(self.result_export.iter()) {
            if export.trim().is_empty() {
                return Err(DefinitionError::MissingExportName);
            }
        }

        if self.danger_prompt.is_some() && self.danger_prompt_export.is_some() {
            return Err(DefinitionError::ContradictoryDangerPrompt);
        }
        if self.danger_prompt_export.as_deref().is_some_and(|name| name.trim().is_empty()) {
            return Err(DefinitionError::MissingExportName);
        }

        if let Some(help) = &self.help
            && help.workflows.is_empty()
            && help.commands.is_empty()
        {
            return Err(DefinitionError::EmptyHelp);
        }
        if let Some(owner) = self.unlocalized_owners().into_iter().next() {
            return Err(DefinitionError::IncompleteLocalization { owner });
        }

        Ok(())
    }

    /// Owners whose authored copy has an empty side, in reading order.
    ///
    /// Every node writes both languages inline (`label: zh ? "扫描" : "Scan"`), so a blank side is a
    /// transcription mistake made while moving a node's vocabulary into a definition file, and it only
    /// shows up for users of that language.
    #[must_use]
    pub fn unlocalized_owners(&self) -> Vec<String> {
        let mut problems = Vec::new();
        let mut check = |owner: String, text: &LocalizedText| {
            if text.has_blank_side() {
                problems.push(owner);
            }
        };
        check("title".to_owned(), &self.title);
        check("description".to_owned(), &self.description);
        for action in &self.actions {
            check(format!("action.{}", action.id), &action.label);
        }
        for field in &self.fields {
            check(format!("field.{}.label", field.id), &field.label);
            if let Some(description) = &field.description {
                check(format!("field.{}.description", field.id), description);
            }
            if let Some(placeholder) = &field.placeholder {
                check(format!("field.{}.placeholder", field.id), placeholder);
            }
            for option in &field.options {
                check(format!("field.{}.option.{}", field.id, option.value.display_text()), &option.label);
                if let Some(hint) = &option.hint {
                    check(format!("field.{}.option.{}.hint", field.id, option.value.display_text()), hint);
                }
            }
        }
        for group in &self.groups {
            check(format!("group.{}.title", group.id), &group.title);
            if let Some(description) = &group.description {
                check(format!("group.{}.description", group.id), description);
            }
        }
        if let Some(dashboard) = &self.dashboard {
            check("dashboard.title".to_owned(), &dashboard.title);
            if let Some(description) = &dashboard.description {
                check("dashboard.description".to_owned(), description);
            }
            for (index, metric) in dashboard.metrics.iter().enumerate() {
                check(format!("dashboard.metrics[{index}].label"), &metric.label);
            }
            let mut sources = vec![("dashboard.primary".to_owned(), &dashboard.primary)];
            if let Some(secondary) = &dashboard.secondary {
                sources.push(("dashboard.secondary".to_owned(), secondary));
            }
            for (index, metric) in dashboard.metrics.iter().enumerate() {
                sources.push((format!("dashboard.metrics[{index}].value"), &metric.source));
            }
            for (owner, source) in sources {
                match source {
                    ValueSource::Literal(text) | ValueSource::FirstNonEmpty { fallback_text: text, .. } => {
                        check(owner, text);
                    }
                    ValueSource::Field { .. } | ValueSource::ActionLabel => {}
                }
            }
        }
        if let Some(table) = &self.result_table {
            for column in &table.columns {
                check(format!("resultTable.column.{}", column.id), &column.label);
            }
            if let Some(empty_message) = &table.empty_message {
                check("resultTable.emptyMessage".to_owned(), empty_message);
            }
        }
        if let Some(prompt) = &self.danger_prompt {
            check("dangerPrompt.title".to_owned(), &prompt.title);
            check("dangerPrompt.body".to_owned(), &prompt.body);
            check("dangerPrompt.confirmLabel".to_owned(), &prompt.confirm_label);
        }
        if let Some(help) = &self.help {
            problems.extend(help.localization_problems());
        }
        problems
    }
}
