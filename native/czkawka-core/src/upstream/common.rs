use std::sync::{Once, OnceLock};
use std::thread::JoinHandle;

use crossbeam_channel::{Sender, unbounded};
use czkawka_core::common::config_cache_path::set_config_cache_path;
use czkawka_core::common::progress_data::ProgressData;
use czkawka_core::common::traits::Search;

use crate::{ScanControl, ScanProgress};

pub(crate) fn search_with_control<T: Search>(tool: &mut T, control: &ScanControl) {
    let (progress, forwarder) = start_progress_forwarder(control);
    tool.search(&control.stop, progress.as_ref());
    drop(progress);
    if let Some(handle) = forwarder {
        let _ = handle.join();
    }
}

pub(crate) fn initialize_threads(thread_count: usize) -> usize {
    static THREAD_COUNT: OnceLock<usize> = OnceLock::new();
    *THREAD_COUNT.get_or_init(|| {
        czkawka_core::common::set_number_of_threads(thread_count);
        czkawka_core::common::get_number_of_threads()
    })
}

pub(crate) fn source_version() -> &'static str {
    czkawka_core::CZKAWKA_VERSION
}

pub(crate) fn initialize_cache_path() {
    static INITIALIZE_CACHE_PATH: Once = Once::new();
    INITIALIZE_CACHE_PATH.call_once(|| {
        let _ = set_config_cache_path("xiranite", "xiranite");
    });
}

fn start_progress_forwarder(
    control: &ScanControl,
) -> (Option<Sender<ProgressData>>, Option<JoinHandle<()>>) {
    let Some(target) = control.progress_sender() else {
        return (None, None);
    };
    let (sender, receiver) = unbounded::<ProgressData>();
    let handle = std::thread::spawn(move || {
        while let Ok(progress) = receiver.recv() {
            let _ = target.send(ScanProgress {
                stage: format!("{:?}", progress.sstage),
                stage_index: progress.current_stage_idx,
                stage_count: progress.max_stage_idx.saturating_add(1),
                entries_checked: progress.entries_checked,
                entries_total: progress.entries_to_check,
                bytes_checked: progress.bytes_checked,
                bytes_total: progress.bytes_to_check,
            });
        }
    });
    (Some(sender), Some(handle))
}
