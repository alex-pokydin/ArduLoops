//! MAVLink bridge for ArduLoops.
use std::collections::{HashMap, HashSet};
use std::fs;
use std::sync::mpsc::{Receiver, TryRecvError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use mavlink::ardupilotmega::{
    MavAutopilot, MavCmd, MavFrame, MavMessage, MavMissionResult, MavModeFlag, MavParamType, MavResult,
    MavType, PidTuningAxis, ATTITUDE_DATA, ATTITUDE_TARGET_DATA, COMMAND_ACK_DATA, COMMAND_LONG_DATA,
    GLOBAL_POSITION_INT_DATA, GPS_RAW_INT_DATA, HEARTBEAT_DATA, HOME_POSITION_DATA, LOG_DATA_DATA,
    LOG_ENTRY_DATA, LOG_ERASE_DATA, LOG_REQUEST_DATA_DATA, LOG_REQUEST_END_DATA, LOG_REQUEST_LIST_DATA,
    MISSION_CLEAR_ALL_DATA, MISSION_COUNT_DATA, MISSION_CURRENT_DATA, MISSION_ITEM_DATA, MISSION_ITEM_INT_DATA,
    NAV_CONTROLLER_OUTPUT_DATA,
    PARAM_REQUEST_LIST_DATA, PARAM_REQUEST_READ_DATA, PARAM_SET_DATA, PARAM_VALUE_DATA, PID_TUNING_DATA,
    RC_CHANNELS_DATA, RC_CHANNELS_OVERRIDE_DATA, RC_CHANNELS_RAW_DATA, REQUEST_DATA_STREAM_DATA,
    SIM_STATE_DATA, SIMSTATE_DATA, STATUSTEXT_DATA, VFR_HUD_DATA,
};
use mavlink::{MavConnection, MavHeader};
use serde::{Deserialize, Serialize};

use crate::sitl::{SitlCtl, SitlOpts};

// Sample, commands, modes, and link state.
include!("model.rs");

// Parameter reads, writes, and stream requests.
include!("params.rs");

// On-board log list and download.
include!("logs.rs");

// Heartbeat, sticks, and reboot.
include!("pilot.rs");

// Command dispatch and incoming MAVLink.
include!("messages.rs");

// Opening the link and the read loop.
include!("session.rs");

// Lua scripts over MAVLink file transfer.
include!("scripts.rs");

// The minute of live samples the assistant reads.
include!("buffer.rs");

// Tests.
include!("tests.rs");
