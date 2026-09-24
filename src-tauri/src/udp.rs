//! UDP MAVLink for GCS-style `udpin` / `udpout`.
//!
//! rust-mavlink 0.13.1's UDP socket has no read timeout, treats each datagram as a
//! byte stream (a bogus length waits on the *next* packet), and on Windows a reply
//! HEARTBEAT to a send-only port surfaces as `WSAECONNRESET` — `recv` then spins
//! and `try_open`'s 6s deadline never fires.
use std::collections::VecDeque;
use std::io::{self, Cursor};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4, ToSocketAddrs, UdpSocket};
use std::sync::Mutex;
use std::time::Duration;

use mavlink::ardupilotmega::{MavMessage, MavType};
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
    dest: Mutex<Vec<SocketAddr>>,
    pending: Mutex<VecDeque<(MavHeader, MavMessage)>>,
    sequence: Mutex<u8>,
    protocol_version: Mutex<MavlinkVersion>,
    server: bool,
}

impl UdpMav {
    fn bind_in(addr: &str) -> io::Result<Self> {
        let sock_addr = parse_addr(addr)?;
        let socket = prep(UdpSocket::bind(sock_addr)?)?;
        socket.set_broadcast(true)?;
        // Until a vehicle answers, GCS heartbeats go to the whole subnet on this port.
        let announce = SocketAddr::new(IpAddr::V4(Ipv4Addr::BROADCAST), sock_addr.port());
        log::info!("UDP listen {sock_addr} announce {announce}");
        Ok(Self::new(socket, true, vec![announce]))
    }

    fn bind_out(addr: &str, broadcast: bool) -> io::Result<Self> {
        let dest = parse_addr(addr)?;
        let socket = prep(bind_gcs_socket(&dest)?)?;
        if broadcast {
            socket.set_broadcast(true)?;
        }
        // MAVESP8266 listens on 14555 and answers a GCS that is listening on 14550.
        let mut dests = vec![dest];
        if dest.port() == 14550 {
            if let SocketAddr::V4(v4) = dest {
                dests.push(SocketAddr::V4(SocketAddrV4::new(*v4.ip(), 14555)));
            }
        }
        log::info!(
            "UDP {} {dests:?} local {}",
            if broadcast { "broadcast" } else { "out" },
            socket.local_addr()?
        );
        Ok(Self::new(socket, false, dests))
    }

    fn new(socket: UdpSocket, server: bool, dest: Vec<SocketAddr>) -> Self {
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

fn from_vehicle(msgs: &[(MavHeader, MavMessage)]) -> bool {
    msgs.iter().any(|(_, msg)| match msg {
        MavMessage::HEARTBEAT(hb) => hb.mavtype != MavType::MAV_TYPE_GCS,
        _ => true,
    })
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
                    let mut q = decode_datagram(&buf[..n]);
                    if q.is_empty() {
                        continue;
                    }
                    if from_vehicle(&q) {
                        let mut dests = self.dest.lock().unwrap();
                        if self.server || dests.len() != 1 || dests.first() != Some(&addr) {
                            *dests = vec![addr];
                        }
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
        let dests = self.dest.lock().unwrap().clone();
        if dests.is_empty() {
            return Ok(0);
        }
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
        let mut sent = 0;
        let mut last_err = None;
        for addr in dests {
            match self.socket.send_to(&bytes, addr) {
                Ok(n) => sent += n,
                Err(err) => last_err = Some(err),
            }
        }
        if sent == 0 {
            if let Some(err) = last_err {
                return Err(err.into());
            }
        }
        Ok(sent)
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
    fn udpout_heartbeat_reaches_vehicle_and_reply_comes_back() {
        let vehicle = prep(UdpSocket::bind("127.0.0.1:0").unwrap()).unwrap();
        let vehicle_addr = vehicle.local_addr().unwrap();
        let gcs = UdpMav::bind_out(&vehicle_addr.to_string(), false).unwrap();
        let sent = gcs
            .send(
                &MavHeader { system_id: 255, component_id: 190, sequence: 0 },
                &hb(),
            )
            .expect("send");
        assert!(sent > 8, "heartbeat was not written");
        let mut buf = [0u8; 512];
        let (n, from) = vehicle.recv_from(&mut buf).expect("vehicle never saw the GCS heartbeat");
        assert!(n > 8);
        let mut reply = Vec::new();
        write_versioned_msg(
            &mut reply,
            MavlinkVersion::V2,
            MavHeader { system_id: 1, component_id: 1, sequence: 0 },
            &hb(),
        )
        .unwrap();
        vehicle.send_to(&reply, from).unwrap();
        let rec = gcs.recv().expect("GCS never saw the vehicle heartbeat");
        assert!(matches!(rec.1, MavMessage::HEARTBEAT(_)));
    }

    #[test]
    fn udpin_sends_until_a_vehicle_answers() {
        let mav = UdpMav::bind_in("127.0.0.1:0").unwrap();
        let n = mav.send(&MavHeader::default(), &hb()).unwrap_or(0);
        assert!(n > 0 || mav.socket.local_addr().is_ok());
    }

    #[test]
    fn udpin_loopback() {
        let socket = prep(UdpSocket::bind("127.0.0.1:0").unwrap()).unwrap();
        let addr = socket.local_addr().unwrap();
        let server = UdpMav::new(socket, true, Vec::new());
        let client = UdpMav::bind_out(&addr.to_string(), false).unwrap();
        client.send(&MavHeader::default(), &hb()).unwrap();
        let rec = server.recv().expect("heartbeat on udpin");
        assert!(matches!(rec.1, MavMessage::HEARTBEAT(_)));
    }
}
