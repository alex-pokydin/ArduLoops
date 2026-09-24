//! Local serial ports for the link picker. Android has no desktop serial stack.

#[derive(Clone, serde::Serialize)]
pub struct Port {
    pub name: String,
    /// Device Manager name, for example `COM4 — USB-SERIAL CH340`.
    pub label: String,
}

#[cfg(not(target_os = "android"))]
pub fn list() -> Vec<Port> {
    let named = windows_names();
    let mut ports: Vec<Port> = serialport::available_ports()
        .unwrap_or_default()
        .into_iter()
        .filter(|p| !p.port_name.is_empty())
        .map(|p| {
            let label = named.get(&p.port_name).cloned().unwrap_or_else(|| friendly(&p));
            Port { name: p.port_name, label }
        })
        .collect();
    ports.sort_by(|a, b| a.name.cmp(&b.name));
    ports.dedup_by(|a, b| a.name == b.name);
    ports
}

#[cfg(not(target_os = "android"))]
fn friendly(p: &serialport::SerialPortInfo) -> String {
    let extra = match &p.port_type {
        serialport::SerialPortType::UsbPort(info) => info
            .product
            .clone()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| info.manufacturer.clone()),
        serialport::SerialPortType::BluetoothPort => Some("Bluetooth".into()),
        serialport::SerialPortType::PciPort => Some("PCI".into()),
        serialport::SerialPortType::Unknown => None,
    };
    match extra.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        Some(extra) if extra.eq_ignore_ascii_case(&p.port_name) => p.port_name.clone(),
        Some(extra) if extra.to_ascii_lowercase().contains(&p.port_name.to_ascii_lowercase()) => extra,
        Some(extra) => format!("{} — {extra}", p.port_name),
        None => p.port_name.clone(),
    }
}

#[cfg(not(windows))]
fn windows_names() -> std::collections::HashMap<String, String> {
    std::collections::HashMap::new()
}

#[cfg(windows)]
fn windows_names() -> std::collections::HashMap<String, String> {
    use std::collections::HashMap;
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_LOCAL_MACHINE,
        KEY_READ, REG_SZ,
    };

    fn open(parent: HKEY, name: &str) -> Option<HKEY> {
        let mut key = std::ptr::null_mut();
        let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        let rc = unsafe { RegOpenKeyExW(parent, wide.as_ptr(), 0, KEY_READ, &mut key) };
        (rc == ERROR_SUCCESS).then_some(key)
    }
    fn enum_key(key: HKEY, index: u32) -> Option<String> {
        let mut buf = [0u16; 256];
        let mut len = buf.len() as u32;
        let rc = unsafe {
            RegEnumKeyExW(key, index, buf.as_mut_ptr(), &mut len, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut())
        };
        if rc != ERROR_SUCCESS { return None; }
        Some(String::from_utf16_lossy(&buf[..len as usize]))
    }
    fn friendly(key: HKEY) -> Option<String> {
        let name: Vec<u16> = "FriendlyName".encode_utf16().chain(std::iter::once(0)).collect();
        let mut kind = 0u32;
        let mut bytes = 0u32;
        let rc = unsafe { RegQueryValueExW(key, name.as_ptr(), std::ptr::null_mut(), &mut kind, std::ptr::null_mut(), &mut bytes) };
        if rc != ERROR_SUCCESS || kind != REG_SZ || bytes < 4 { return None; }
        let mut buf = vec![0u16; (bytes as usize / 2) + 1];
        let rc = unsafe { RegQueryValueExW(key, name.as_ptr(), std::ptr::null_mut(), &mut kind, buf.as_mut_ptr() as *mut u8, &mut bytes) };
        if rc != ERROR_SUCCESS { return None; }
        let n = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
        let text = String::from_utf16_lossy(&buf[..n]);
        let text = text.trim();
        (!text.is_empty()).then(|| text.to_string())
    }

    let mut out = HashMap::new();
    let Some(root) = open(HKEY_LOCAL_MACHINE, "SYSTEM\\CurrentControlSet\\Enum") else { return out };
    let mut i = 0;
    while let Some(class) = enum_key(root, i) {
        i += 1;
        let Some(class_key) = open(root, &class) else { continue };
        let mut j = 0;
        while let Some(dev) = enum_key(class_key, j) {
            j += 1;
            let Some(dev_key) = open(class_key, &dev) else { continue };
            let mut k = 0;
            while let Some(inst) = enum_key(dev_key, k) {
                k += 1;
                let Some(inst_key) = open(dev_key, &inst) else { continue };
                if let Some(name) = friendly(inst_key) {
                    if let Some(com) = name.rsplit_once("(COM").and_then(|(_, rest)| rest.strip_suffix(')')).map(|n| format!("COM{n}")) {
                        out.insert(com, name);
                    }
                }
                unsafe { RegCloseKey(inst_key) };
            }
            unsafe { RegCloseKey(dev_key) };
        }
        unsafe { RegCloseKey(class_key) };
    }
    unsafe { RegCloseKey(root) };
    out
}

#[cfg(target_os = "android")]
pub fn list() -> Vec<Port> {
    Vec::new()
}
