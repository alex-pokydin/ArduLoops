//! Firmware operations are independent of MAVLink; USB writes use an explicit plan.
use serde_json::{json, Value};

pub fn call(operation: &str, arguments: &Value) -> Result<Value, String> {
    crate::firmware_native::call(operation, arguments)
}

pub fn import_local(bytes: &[u8], vehicle: &str) -> Result<Value, String> {
    crate::firmware_native::import_local(bytes, vehicle)
}

pub fn tools() -> Vec<Value> {
    vec![
        json!({"name":"ardupilot_firmware_catalog",
            "description":concat!(
                "Read the official custom.ardupilot.org vehicle/version/board/features catalog. ",
                "Feature IDs and defaults come from the selected board/version. ",
                "No device changes.",
            ),
            "inputSchema":{"type":"object","required":["resource"],"additionalProperties":false,"properties":{
                "resource":{"type":"string","enum":["vehicles","versions","boards","features","standard_artifacts"]},
                "vehicle_id":{"type":"string"},"version_id":{"type":"string"},"board_id":{"type":"string"}}}}),
        json!({"name":"ardupilot_firmware_build",
            "description":concat!(
                "plan starts from catalog defaults, or from features when that selected list is passed, then applies enable/disable and closes dependencies. ",
                "submit queues that saved plan with the official build service (no automatic retry on uncertainty). ",
                "status/logs inspect a build. ",
                "download accepts successful locally submitted builds, validates the APJ and saves its SHA256. ",
                "Only board/version/features are sent; no vehicle telemetry. ",
                "Does not flash.",
            ),
            "inputSchema":{"type":"object","required":["action"],"additionalProperties":false,"properties":{
                "action":{"type":"string","enum":["plan","submit","status","logs","download"]},
                "vehicle_id":{"type":"string"},"version_id":{"type":"string"},"board_id":{"type":"string"},
                "features":{"type":"array","items":{"type":"string"}},
                "enable":{"type":"array","items":{"type":"string"}},"disable":{"type":"array","items":{"type":"string"}},
                "plan_id":{"type":"string"},"build_id":{"type":"string"},"tail":{"type":"integer","minimum":1,"maximum":1000}}}}),
        json!({"name":"ardupilot_firmware_flash",
            "description":concat!(
                "ports lists USB devices. ",
                "prepare validates a downloaded artifact against the live disarmed vehicle, backs up all parameters and returns an expiring plan. ",
                "start_bootloader IRREVERSIBLY WRITES FIRMWARE using the native Rust ArduPilot serial bootloader client. ",
                "Call only after explicit user authorization for this image/device with the exact confirmation from prepare. ",
                "It requires separate UDP telemetry and a USB serial identity, but no Python, pyserial, or ArduPilot checkout. ",
                "No DFU or UDP flashing. ",
                "status returns worker progress/logs. ",
                "A verified write still requires reconnecting and checking sensors/modes/pre-arm; it is not proof of flight readiness.",
            ),
            "inputSchema":{"type":"object","required":["action"],"additionalProperties":false,"properties":{
                "action":{"type":"string","enum":["ports","prepare","start_bootloader","status"]},
                "artifact_id":{"type":"string"},"port":{"type":"string"},"plan_id":{"type":"string"},
                "confirmation":{"type":"string"}}}}),
    ]
}
