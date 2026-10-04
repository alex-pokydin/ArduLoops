// On-board log list and download.


fn request_log_list(conn: &dyn MavConnection<MavMessage>, st: &mut LinkState) {
    st.sample.logs.clear();
    st.sample.log_list_expected = None;
    st.sample.log_list_at = wall_time();
    send_msg(
        conn,
        &MavMessage::LOG_REQUEST_LIST(LOG_REQUEST_LIST_DATA {
            start: 0,
            end: u16::MAX,
            target_system: st.target_system,
            target_component: st.target_component,
        }),
    );
}

fn end_log_request(conn: &dyn MavConnection<MavMessage>, st: &LinkState) {
    send_msg(
        conn,
        &MavMessage::LOG_REQUEST_END(LOG_REQUEST_END_DATA {
            target_system: st.target_system,
            target_component: st.target_component,
        }),
    );
}

fn request_log_range(
    conn: &dyn MavConnection<MavMessage>,
    st: &LinkState,
    id: u16,
    ofs: usize,
    count: usize,
) {
    send_msg(
        conn,
        &MavMessage::LOG_REQUEST_DATA(LOG_REQUEST_DATA_DATA {
            ofs: ofs.min(u32::MAX as usize) as u32,
            count: count.min(u32::MAX as usize) as u32,
            id,
            target_system: st.target_system,
            target_component: st.target_component,
        }),
    );
}

fn log_bit_received(bits: &[u64], index: usize) -> bool {
    bits.get(index / 64)
        .is_some_and(|word| (word & (1_u64 << (index % 64))) != 0)
}

fn mark_log_bit(bits: &mut [u64], index: usize) -> bool {
    let Some(word) = bits.get_mut(index / 64) else {
        return false;
    };
    let mask = 1_u64 << (index % 64);
    let was_set = *word & mask != 0;
    *word |= mask;
    !was_set
}

fn update_log_download_report(st: &mut LinkState, error: String) {
    if st.active_log_download.as_ref().is_some_and(|active| active.peek_head > 0) {
        return;
    }
    if let Some(active) = &st.active_log_download {
        st.sample.log_download = Some(LogDownload {
            id: active.id,
            size: active.size as u32,
            received: active
                .received_chunks
                .saturating_mul(LOG_BLOCK)
                .min(active.size) as u32,
            complete: false,
            path: String::new(),
            error,
            updated_at: wall_time(),
        });
    }
}

fn log_chunk_wanted(active: &ActiveLogDownload, chunk: usize) -> bool {
    if active.peek_head == 0 {
        return true;
    }
    let start = chunk * LOG_BLOCK;
    if start < active.peek_head {
        return true;
    }
    if active.peek_tail == 0 {
        return false;
    }
    let tail_at = active.size.saturating_sub(active.peek_tail);
    start < active.size && start + LOG_BLOCK > tail_at
}

fn first_missing_log_chunk(active: &ActiveLogDownload) -> Option<usize> {
    let chunks = active.size.div_ceil(LOG_BLOCK);
    (0..chunks).find(|index| log_chunk_wanted(active, *index) && !log_bit_received(&active.received, *index))
}

fn log_download_complete(active: &ActiveLogDownload) -> bool {
    let chunks = active.size.div_ceil(LOG_BLOCK);
    chunks == 0
        || (0..chunks).all(|index| !log_chunk_wanted(active, index) || log_bit_received(&active.received, index))
}

fn next_log_request(active: &ActiveLogDownload) -> Option<(usize, usize)> {
    let chunk = first_missing_log_chunk(active)?;
    let offset = chunk * LOG_BLOCK;
    let chunks = active.size.div_ceil(LOG_BLOCK);
    let mut end = (offset + LOG_BLOCK).min(active.size);
    let mut next = chunk + 1;
    while next < chunks
        && end - offset < LOG_BLOCK * 512
        && log_chunk_wanted(active, next)
        && !log_bit_received(&active.received, next)
    {
        end = ((next + 1) * LOG_BLOCK).min(active.size);
        next += 1;
    }
    Some((offset, end - offset))
}

fn write_log_bytes(active: &mut ActiveLogDownload, offset: usize, data: &[u8]) {
    if data.is_empty() {
        return;
    }
    if active.peek_head == 0 {
        let end = (offset + data.len()).min(active.size).min(active.bytes.len());
        if end > offset {
            active.bytes[offset..end].copy_from_slice(&data[..end - offset]);
        }
        return;
    }
    if offset < active.peek_head {
        let n = data.len().min(active.peek_head - offset);
        active.bytes[offset..offset + n].copy_from_slice(&data[..n]);
    }
    if active.peek_tail == 0 {
        return;
    }
    let tail_at = active.size.saturating_sub(active.peek_tail);
    let overlap_start = offset.max(tail_at);
    let overlap_end = (offset + data.len()).min(active.size);
    if overlap_end <= overlap_start {
        return;
    }
    let src = overlap_start - offset;
    let dst = active.peek_head + (overlap_start - tail_at);
    let n = overlap_end - overlap_start;
    if dst + n <= active.bytes.len() {
        active.bytes[dst..dst + n].copy_from_slice(&data[src..src + n]);
    }
}

pub(crate) fn remember_brief(sample: &mut Sample, brief: LogBrief) {
    if let Some(slot) = sample.log_briefs.iter_mut().find(|item| item.id == brief.id) {
        *slot = brief;
    } else {
        sample.log_briefs.push(brief);
    }
}

fn start_text(summary_utc: &str, time_utc: u32) -> String {
    if !summary_utc.is_empty() {
        return summary_utc.to_string();
    }
    if time_utc == 0 {
        return String::new();
    }
    crate::dflog::unix_rfc3339(time_utc as u64)
}

fn finish_log_peek(st: &mut LinkState, active: ActiveLogDownload) {
    let head_len = active.peek_head.min(active.bytes.len());
    let summary = crate::dflog::summarize_log(&active.bytes[..head_len], &active.bytes[head_len..]);
    let time_utc = st
        .sample
        .logs
        .iter()
        .find(|log| log.id == active.id)
        .map(|log| log.time_utc)
        .unwrap_or(0);
    remember_brief(
        &mut st.sample,
        LogBrief {
            id: active.id,
            size: active.size as u32,
            firmware: summary.firmware,
            frame: summary.frame,
            start_utc: start_text(&summary.start_utc, time_utc),
            duration_us: summary.duration_us,
            error: String::new(),
            updated_at: wall_time(),
        },
    );
}

fn fail_log_peek(st: &mut LinkState, id: u16, size: u32, error: &str) {
    remember_brief(
        &mut st.sample,
        LogBrief {
            id,
            size,
            firmware: String::new(),
            frame: String::new(),
            start_utc: String::new(),
            duration_us: 0,
            error: error.to_string(),
            updated_at: wall_time(),
        },
    );
}

fn save_completed_log(st: &mut LinkState, active: ActiveLogDownload) {
    let key = if st.sample.boot_uid.is_empty() {
        format!("system-{}", st.target_system)
    } else {
        st.sample
            .boot_uid
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .collect()
    };
    let root = crate::db::data_dir().join("logs").join(key);
    let time_utc = st.sample.logs.iter().find(|log| log.id == active.id).map(|log| log.time_utc).unwrap_or(0);
    let path = root.join(crate::dflog::downloaded_log_name(active.id, &active.bytes, time_utc));
    let result = fs::create_dir_all(&root).and_then(|_| fs::write(&path, &active.bytes));
    let (complete, path, error) = match result {
        Ok(()) => (true, path.display().to_string(), String::new()),
        Err(error) => (true, String::new(), format!("Could not save log: {error}")),
    };
    st.sample.log_download = Some(LogDownload {
        id: active.id,
        size: active.size as u32,
        received: active.size as u32,
        complete,
        path,
        error,
        updated_at: wall_time(),
    });
}

/// A full file is paced near 6 KB/s on a slow serial link. The header peek stays short.
fn log_download_budget(size: usize, peek: bool) -> Duration {
    if peek {
        return Duration::from_secs(40);
    }
    Duration::from_secs((size as u64 / 6_000).clamp(180, 3_600) + 60)
}

fn drive_log_download(conn: &dyn MavConnection<MavMessage>, st: &mut LinkState) {
    let now = Instant::now();
    let complete = st
        .active_log_download
        .as_ref()
        .is_some_and(log_download_complete);
    if complete {
        let active = st.active_log_download.take().expect("active log");
        let peek = active.peek_head > 0;
        end_log_request(conn, st);
        if peek {
            finish_log_peek(st, active);
        } else {
            save_completed_log(st, active);
        }
        return;
    }
    let Some(active) = st.active_log_download.as_mut() else {
        return;
    };
    let limit = log_download_budget(active.size, active.peek_head > 0);
    if now.duration_since(active.started) > limit {
        let id = active.id;
        let size = active.size as u32;
        let received = active.received_chunks.saturating_mul(LOG_BLOCK).min(active.size) as u32;
        let peek = active.peek_head > 0;
        st.active_log_download = None;
        if peek {
            fail_log_peek(st, id, size, "Could not read the log header");
        } else {
            st.sample.log_download = Some(LogDownload {
                id,
                size,
                received,
                complete: true,
                path: String::new(),
                error: "Log download timed out".into(),
                updated_at: wall_time(),
            });
        }
        end_log_request(conn, st);
        return;
    }
    let gap = if active.peek_head == 0 { 900 } else { 200 };
    if now.duration_since(active.last_data) < Duration::from_millis(gap)
        || now.duration_since(active.last_request) < Duration::from_millis(gap)
    {
        return;
    }
    let Some((offset, count)) = next_log_request(active) else {
        return;
    };
    let id = active.id;
    active.last_request = now;
    request_log_range(conn, st, id, offset, count);
}
