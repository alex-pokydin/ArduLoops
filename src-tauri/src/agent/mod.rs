//! Local AI assistant: provider keys, chats, proposals, and audit.
//! The API key never leaves this process in an HTTP response.

use std::cell::Cell;
use std::collections::{HashMap, HashSet};
use std::thread;
use std::fs;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::db::data_dir;
use crate::link::{Cmd, Sample};

include!(concat!(env!("OUT_DIR"), "/skills.rs"));

// Live turn: generation, stop, and the status the UI polls.
include!("live.rs");

// Chat storage, provider keys, and the /ai routes.
include!("route.rs");

// Folded chat context and the recent-turn window.
include!("context.rs");

// Proposals, steer notes, and safe mode.
include!("decide.rs");

// Waiting for connect, reboot, or disconnect.
include!("link_wait.rs");

// Tool descriptions.
include!("schema.rs");

// Tool dispatch and the log jobs.
include!("dispatch.rs");

// Parameter writes, firmware calls, and tool batches.
include!("actions.rs");

// The model loop and provider requests.
include!("converse.rs");

// Tests.
include!("tests.rs");
