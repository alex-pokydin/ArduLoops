//! UDP MAVLink for GCS-style `udpin` / `udpout`.
//!
//! rust-mavlink 0.13.1's UDP socket has no read timeout, treats each datagram as a
//! byte stream (a bogus length waits on the *next* packet), and on Windows a reply
//! HEARTBEAT to a send-only port surfaces as `WSAECONNRESET` — `recv` then spins
//! and `try_open`'s 6s deadline never fires.
use std::collections::VecDeque;
use std::io::{self, Cursor};
use std::net::{SocketAddr, ToSocketAddrs, UdpSocket};
use std::sync::Mutex;
use std::time::Duration;

use mavlink::ardupilotmega::MavMessage;
use mavlink::peek_reader::PeekReader;
use mavlink::{
    read_versioned_msg, write_versioned_msg, MavConnection, MavHeader, MavlinkVersion,
};

const READ_TIMEOUT: Duration = Duration::from_millis(100);
const MTU: usize = 1500;

fn strip_prefix_ci<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    if s.len() >= prefix.len() && s[..prefix.len()].eq_ignore_ascii_case(prefix) {
        Some(&s[prefix.len()..])
    } else {
        None
    }
}

fn parse_addr(s: &str) -> io::Result<SocketAddr> {
    s.to_socket_addrs()?
        .next()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, s))
}

#[cfg(windows)]
fn ignore_connreset(socket: &UdpSocket) {
    use std::os::windows::io::AsRawSocket;
    extern "system" {
        fn WSAIoctl(
            s: usize,
            dw_io_control_code: u32,
            lpv_in_buffer: *const u8,
            cb_in_buffer: u32,
            lpv_out_buffer: *mut u8,
            cb_out_buffer: u32,
            lpcb_bytes_returned: *mut u32,
            lp_overlapped: *mut core::ffi::c_void,
            lp_completion_routine: *mut core::ffi::c_void,
        ) -> i32;
    }
    const SIO_UDP_CONNRESET: u32 = 0x9800_000C;
    let mut enable: i32 = 0;
    let mut returned: u32 = 0;
    unsafe {
        let _ = WSAIoctl(
            socket.as_raw_socket() as usize,
            SIO_UDP_CONNRESET,
            &mut enable as *mut i32 as *const u8,
            4,
            std::ptr::null_mut(),
            0,
            &mut returned,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        );
    }
}

#[cfg(not(windows))]
fn ignore_connreset(_socket: &UdpSocket) {}

/// Vehicles usually send to the GCS on 14550, or listen there. Bind that port when it is free
/// and still send to the address the user typed.
fn bind_gcs_socket(dest: &SocketAddr) -> io::Result<UdpSocket> {
    if dest.port() == 14550 || dest.port() == 14551 {
        let fixed = if dest.is_ipv6() {
            format!("[::]:{}", dest.port())
        } else {
            format!("0.0.0.0:{}", dest.port())
        };
        if let Ok(socket) = UdpSocket::bind(&fixed) {
            return Ok(socket);
        }
    }
    let ephemeral = if dest.is_ipv6() { "[::]:0" } else { "0.0.0.0:0" };
    UdpSocket::bind(ephemeral)
}

fn prep(socket: UdpSocket) -> io::Result<UdpSocket> {
    socket.set_read_timeout(Some(READ_TIMEOUT))?;
    ignore_connreset(&socket);
    Ok(socket)
}

fn decode_ver(buf: &[u8], ver: MavlinkVersion) -> Vec<(MavHeader, MavMessage)> {
    let mut reader = PeekReader::new(Cursor::new(buf.to_vec()));
    let mut out = Vec::new();
    loop {
        match read_versioned_msg(&mut reader, ver) {
            Ok(msg) => out.push(msg),
            Err(_) => break,
        }
    }
    out
}

fn decode_datagram(buf: &[u8]) -> Vec<(MavHeader, MavMessage)> {
    let v2 = decode_ver(buf, MavlinkVersion::V2);
    if !v2.is_empty() {
        return v2;
    }
    decode_ver(buf, MavlinkVersion::V1)
}

pub struct UdpMav {
    socket: UdpSocket,
    dest: Mutex<Option<SocketAddr>>,
    pending: Mutex<VecDeque<(MavHeader, MavMessage)>>,
    sequence: Mutex<u8>,
    protocol_version: Mutex<MavlinkVersion>,
    server: bool,
}

impl UdpMav {
    fn bind_in(addr: &str) -> io::Result<Self> {
        let sock_addr = parse_addr(addr)?;
        let socket = prep(UdpSocket::bind(sock_addr)?)?;
        log::info!("UDP listen {sock_addr}");
        Ok(Self::new(socket, true, None))
    }

    fn bind_out(addr: &str, broadcast: bool) -> io::Result<Self> {
        let dest = parse_addr(addr)?;
        let socket = prep(bind_gcs_socket(&dest)?)?;
        if broadcast {
            socket.set_broadcast(true)?;
        }
        log::info!(
            "UDP {} {dest} local {}",
            if broadcast { "broadcast" } else { "out" },
            socket.local_addr()?
        );
        Ok(Self::new(socket, false, Some(dest)))
    }

    fn new(socket: UdpSocket, server: bool, dest: Option<SocketAddr>) -> Self {
        Self {
            socket,
            dest: Mutex::new(dest),
            pending: Mutex::new(VecDeque::new()),
            sequence: Mutex::new(0),
            protocol_version: Mutex::new(MavlinkVersion::V2),
            server,
        }
    }
}

pub fn connect(url: &str) -> io::Result<Box<dyn MavConnection<MavMessage> + Send + Sync>> {
    let url = url.trim();
    if let Some(rest) = strip_prefix_ci(url, "udpin:") {
        return Ok(Box::new(UdpMav::bind_in(rest)?));
    }
    if let Some(rest) = strip_prefix_ci(url, "udpout:") {
        return Ok(Box::new(UdpMav::bind_out(rest, false)?));
    }
    if let Some(rest) = strip_prefix_ci(url, "udpbcast:") {
        return Ok(Box::new(UdpMav::bind_out(rest, true)?));
    }
    Err(io::Error::new(
        io::ErrorKind::InvalidInput,
        format!("not a UDP url: {url}"),
    ))
}

impl MavConnection<MavMessage> for UdpMav {
    fn recv(&self) -> Result<(MavHeader, MavMessage), mavlink::error::MessageReadError> {
        if let Some(msg) = self.pending.lock().unwrap().pop_front() {
            return Ok(msg);
        }
        let mut buf = [0u8; MTU];
        loop {
            match self.socket.recv_from(&mut buf) {
                Ok((n, addr)) => {
                    if self.server {
                        *self.dest.lock().unwrap() = Some(addr);
                    }
                    let mut q = decode_datagram(&buf[..n]);
                    if q.is_empty() {
                        continue;
                    }
                    let first = q.remove(0);
                    self.pending.lock().unwrap().extend(q);
                    return Ok(first);
                }
                Err(err)
                    if err.kind() == io::ErrorKind::TimedOut
                        || err.kind() == io::ErrorKind::WouldBlock =>
                {
                    return Err(err.into());
                }
                Err(err) if err.kind() == io::ErrorKind::ConnectionReset => continue,
                Err(err) => return Err(err.into()),
            }
        }
    }

    fn send(
        &self,
        header: &MavHeader,
        data: &MavMessage,
    ) -> Result<usize, mavlink::error::MessageWriteError> {
        let dest = *self.dest.lock().unwrap();
        let Some(addr) = dest else {
            return Ok(0);
        };
        let mut seq = self.sequence.lock().unwrap();
        let header = MavHeader {
            sequence: *seq,
            system_id: header.system_id,
            component_id: header.component_id,
        };
        *seq = seq.wrapping_add(1);
        drop(seq);
        let ver = *self.protocol_version.lock().unwrap();
        let mut bytes = Vec::new();
        write_versioned_msg(&mut bytes, ver, header, data)?;
        Ok(self.socket.send_to(&bytes, addr)?)
    }

    fn set_protocol_version(&mut self, version: MavlinkVersion) {
        *self.protocol_version.lock().unwrap() = version;
    }

    fn get_protocol_version(&self) -> MavlinkVersion {
        *self.protocol_version.lock().unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mavlink::ardupilotmega::{
        HEARTBEAT_DATA, MavAutopilot, MavModeFlag, MavState, MavType,
    };

    fn hb() -> MavMessage {
        MavMessage::HEARTBEAT(HEARTBEAT_DATA {
            custom_mode: 0,
            mavtype: MavType::MAV_TYPE_FIXED_WING,
            autopilot: MavAutopilot::MAV_AUTOPILOT_ARDUPILOTMEGA,
            base_mode: MavModeFlag::empty(),
            system_status: MavState::MAV_STATE_ACTIVE,
            mavlink_version: 3,
        })
    }

    #[test]
    fn datagram_v2_heartbeat() {
        let mut bytes = Vec::new();
        write_versioned_msg(&mut bytes, MavlinkVersion::V2, MavHeader::default(), &hb()).unwrap();
        let got = decode_datagram(&bytes);
        assert!(matches!(&got[0].1, MavMessage::HEARTBEAT(_)));
    }

    #[test]
    fn udpout_14550_listens_on_that_port_when_free() {
        let probe = UdpSocket::bind("127.0.0.1:14550");
        if probe.is_err() {
            return;
        }
        drop(probe);
        let mav = UdpMav::bind_out("127.0.0.1:14550", false).unwrap();
        assert_eq!(mav.socket.local_addr().unwrap().port(), 14550);
    }

    #[test]
    fn udpin_loopback() {
        let socket = prep(UdpSocket::bind("127.0.0.1:0").unwrap()).unwrap();
        let addr = socket.local_addr().unwrap();
        let server = UdpMav::new(socket, true, None);
        let client = UdpMav::bind_out(&addr.to_string(), false).unwrap();
        client.send(&MavHeader::default(), &hb()).unwrap();
        let rec = server.recv().expect("heartbeat on udpin");
        assert!(matches!(rec.1, MavMessage::HEARTBEAT(_)));
    }
}
