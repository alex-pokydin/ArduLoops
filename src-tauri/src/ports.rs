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
            let label = named
                .get(&p.port_name)
                .cloned()
                .unwrap_or_else(|| friendly(&p));
            Port {
                name: p.port_name,
                label,
            }
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
    match extra
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        Some(extra) if extra.eq_ignore_ascii_case(&p.port_name) => p.port_name.clone(),
        Some(extra)
            if extra
                .to_ascii_lowercase()
                .contains(&p.port_name.to_ascii_lowercase()) =>
        {
            extra
        }
        Some(extra) => format!("{} — {extra}", p.port_name),
        None => p.port_name.clone(),
    }
}

#[cfg(windows)]
fn port_first(com: &str, friendly: &str) -> String {
    let title = friendly.trim();
    let tail = format!("({com})");
    let title = if title.len() >= tail.len() && title.to_ascii_lowercase().ends_with(&tail.to_ascii_lowercase()) {
        title[..title.len() - tail.len()].trim().trim_end_matches(['—', '-', ' '])
    } else if title.len() >= com.len() && title.to_ascii_lowercase().starts_with(&com.to_ascii_lowercase()) {
        title[com.len()..].trim_start_matches(['—', '-', ' '])
    } else {
        title
    };
    if title.is_empty() || title.eq_ignore_ascii_case(com) {
        com.to_string()
    } else {
        format!("{com} — {title}")
    }
}

#[cfg(not(windows))]
fn windows_names() -> std::collections::HashMap<String, String> {
    std::collections::HashMap::new()
}

#[cfg(windows)]
fn windows_names() -> std::collections::HashMap<String, String> {
    use std::collections::HashMap;
    use windows_sys::Win32::Devices::DeviceAndDriverInstallation::{
        SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInfo, SetupDiGetClassDevsW, DIGCF_PRESENT,
        SP_DEVINFO_DATA,
    };

    // Ports (COM & LPT). Present devices only, not the whole device tree.
    const PORTS: windows_sys::core::GUID =
        windows_sys::core::GUID::from_u128(0x4d36e978_e325_11ce_bfc1_08002be10318);

    let mut out = HashMap::new();
    let set = unsafe { SetupDiGetClassDevsW(&PORTS, std::ptr::null(), std::ptr::null_mut(), DIGCF_PRESENT) };
    if set == -1 {
        return out;
    }
    let mut index = 0u32;
    loop {
        let mut info = SP_DEVINFO_DATA {
            cbSize: std::mem::size_of::<SP_DEVINFO_DATA>() as u32,
            ClassGuid: windows_sys::core::GUID::from_u128(0),
            DevInst: 0,
            Reserved: 0,
        };
        if unsafe { SetupDiEnumDeviceInfo(set, index, &mut info) } == 0 {
            break;
        }
        index += 1;
        let Some(name) = device_friendly(set, &info) else {
            continue;
        };
        let Some(com) = name
            .rsplit_once("(COM")
            .and_then(|(_, rest)| rest.strip_suffix(')'))
            .map(|n| format!("COM{n}"))
        else {
            continue;
        };
        out.insert(com.clone(), port_first(&com, &name));
    }
    unsafe { SetupDiDestroyDeviceInfoList(set) };
    out
}

#[cfg(windows)]
fn device_friendly(set: isize, info: &windows_sys::Win32::Devices::DeviceAndDriverInstallation::SP_DEVINFO_DATA) -> Option<String> {
    use windows_sys::Win32::Devices::DeviceAndDriverInstallation::{
        SetupDiGetDeviceRegistryPropertyW, SPDRP_FRIENDLYNAME,
    };

    let mut kind = 0u32;
    let mut bytes = 0u32;
    unsafe {
        SetupDiGetDeviceRegistryPropertyW(
            set,
            info,
            SPDRP_FRIENDLYNAME,
            &mut kind,
            std::ptr::null_mut(),
            0,
            &mut bytes,
        );
    }
    if bytes < 4 || bytes > 4096 {
        return None;
    }
    let mut buf = vec![0u8; bytes as usize];
    let ok = unsafe {
        SetupDiGetDeviceRegistryPropertyW(
            set,
            info,
            SPDRP_FRIENDLYNAME,
            &mut kind,
            buf.as_mut_ptr(),
            bytes,
            &mut bytes,
        )
    };
    if ok == 0 {
        return None;
    }
    let words = buf.len() / 2;
    let wide: Vec<u16> = (0..words)
        .map(|i| u16::from_le_bytes([buf[i * 2], buf[i * 2 + 1]]))
        .collect();
    let end = wide.iter().position(|c| *c == 0).unwrap_or(wide.len());
    let text = String::from_utf16_lossy(&wide[..end]).trim().to_string();
    (!text.is_empty()).then_some(text)
}

#[cfg(target_os = "android")]
pub fn list() -> Vec<Port> {
    Vec::new()
}
