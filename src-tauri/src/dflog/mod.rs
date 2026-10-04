//! DataFlash BIN reader. Messages are decoded from the log's own FMT records.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::db::data_dir;

// Local log list, inspect, schema, query, and the compute entry.
include!("catalog.rs");

// Desired/actual tracking, step fit, and frequency response.
include!("track.rs");

// Gyro spectrum and the FFT.
include!("spectrum.rs");

// DataFlash decode, names, and summaries.
include!("parse.rs");

// Tests.
include!("tests.rs");
