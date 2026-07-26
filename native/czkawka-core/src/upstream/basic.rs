use czkawka_core::common::tool_data::CommonData;
use czkawka_core::helpers::messages::MessageLimit;
use czkawka_core::tools::big_file::{BigFile, BigFileParameters, SearchMode};
use czkawka_core::tools::empty_files::EmptyFiles;
use czkawka_core::tools::empty_files::EmptyFilesParameters;
use czkawka_core::tools::empty_folder::EmptyFolder;
use czkawka_core::tools::invalid_symlinks::InvalidSymlinks;
use czkawka_core::tools::temporary::Temporary;
use czkawka_core::tools::temporary::TemporaryParameters;

use super::common::{extension_list, initialize_cache_path, search_with_control};
use crate::{BasicEntry, BasicScanOptions, BasicScanResult, BasicTool, CzkawkaError, ScanControl};

pub(crate) fn scan_basic_files(options: BasicScanOptions) -> Result<BasicScanResult, CzkawkaError> {
    scan_basic_files_controlled(options, &ScanControl::detached())
}

pub(crate) fn scan_basic_files_controlled(
    options: BasicScanOptions,
    control: &ScanControl,
) -> Result<BasicScanResult, CzkawkaError> {
    initialize_cache_path();
    if options.included_directories.is_empty() {
        return Err(CzkawkaError::InvalidOption(
            "included_directories cannot be empty".into(),
        ));
    }
    match options.tool {
        BasicTool::BigFiles => {
            let mode = if options.biggest_first {
                SearchMode::BiggestFiles
            } else {
                SearchMode::SmallestFiles
            };
            let mut tool = BigFile::new(BigFileParameters::new(options.number_of_files, mode));
            configure_tool(&mut tool, &options);
            search_with_control(&mut tool, control);
            let entries = tool
                .get_big_files()
                .iter()
                .map(|entry| BasicEntry {
                    path: entry.path.clone(),
                    size: entry.size,
                    modified_date: entry.modified_date,
                    secondary_path: None,
                    detail: None,
                })
                .collect();
            Ok(basic_result(&tool, entries))
        }
        BasicTool::EmptyFiles => {
            let mut tool = EmptyFiles::new(EmptyFilesParameters::default());
            configure_tool(&mut tool, &options);
            search_with_control(&mut tool, control);
            let entries = tool
                .get_empty_files()
                .iter()
                .map(|entry| BasicEntry {
                    path: entry.path.clone(),
                    size: entry.size,
                    modified_date: entry.modified_date,
                    secondary_path: None,
                    detail: None,
                })
                .collect();
            Ok(basic_result(&tool, entries))
        }
        BasicTool::EmptyFolders => {
            let mut tool = EmptyFolder::new();
            configure_tool(&mut tool, &options);
            search_with_control(&mut tool, control);
            let entries = tool
                .get_empty_folder_list()
                .values()
                .map(|entry| BasicEntry {
                    path: entry.path.clone(),
                    size: 0,
                    modified_date: entry.modified_date,
                    secondary_path: None,
                    detail: None,
                })
                .collect();
            Ok(basic_result(&tool, entries))
        }
        BasicTool::TemporaryFiles => {
            let mut tool = Temporary::new(TemporaryParameters::new());
            configure_tool(&mut tool, &options);
            search_with_control(&mut tool, control);
            let entries = tool
                .get_temporary_files()
                .iter()
                .map(|entry| BasicEntry {
                    path: entry.path.clone(),
                    size: entry.size,
                    modified_date: entry.modified_date,
                    secondary_path: None,
                    detail: None,
                })
                .collect();
            Ok(basic_result(&tool, entries))
        }
        BasicTool::InvalidSymlinks => {
            let mut tool = InvalidSymlinks::new();
            configure_tool(&mut tool, &options);
            search_with_control(&mut tool, control);
            let entries = tool
                .get_invalid_symlinks()
                .iter()
                .map(|entry| BasicEntry {
                    path: entry.path.clone(),
                    size: entry.size,
                    modified_date: entry.modified_date,
                    secondary_path: Some(entry.symlink_info.destination_path.clone()),
                    detail: Some(entry.symlink_info.type_of_error.to_string()),
                })
                .collect();
            Ok(basic_result(&tool, entries))
        }
    }
}

fn configure_tool<T: CommonData>(tool: &mut T, options: &BasicScanOptions) {
    tool.set_included_paths(options.included_directories.clone());
    if !options.reference_directories.is_empty() {
        tool.set_reference_paths(options.reference_directories.clone());
    }
    tool.set_excluded_paths(options.excluded_directories.clone());
    tool.set_excluded_items(options.excluded_items.clone());
    tool.set_allowed_extensions(extension_list(&options.allowed_extensions));
    tool.set_excluded_extensions(extension_list(&options.excluded_extensions));
    tool.set_recursive_search(options.recursive);
    tool.set_minimal_file_size(options.minimum_file_size);
    tool.set_maximal_file_size(options.maximum_file_size);
    tool.set_use_cache(options.use_cache);
    tool.set_save_also_as_json(options.save_also_as_json);
    tool.set_delete_outdated_cache(options.delete_outdated_cache);
}

fn basic_result<T: CommonData>(tool: &T, mut entries: Vec<BasicEntry>) -> BasicScanResult {
    entries.sort_unstable_by(|left, right| left.path.cmp(&right.path));
    BasicScanResult {
        entries,
        messages: tool
            .get_text_messages()
            .create_messages_text(MessageLimit::NoLimit),
        stopped: tool.get_stopped_search(),
    }
}
