//! In-app SITL: Mission Planner Cygwin binaries on Windows, firmware
//! `SITL_x86_64_linux_gnu` ELFs on Linux. Spawn `--serial0 tcp:5770`.
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::link::Sample;

pub const LINK: &str = "tcpout:127.0.0.1:5770";
pub const DEFAULT_HOME: &str = "-35.363261,149.165230,584,353";

#[cfg(windows)]
const MP_SITL: &str = "https://firmware.ardupilot.org/Tools/MissionPlanner/sitl/";
#[cfg(any(test, all(target_os = "linux", target_arch = "x86_64")))]
const FW: &str = "https://firmware.ardupilot.org";
#[cfg(windows)]
const DLLS: &[&str] = &[
    "cygatomic-1.dll",
    "cyggcc_s-1.dll",
    "cyggcc_s-seh-1.dll",
    "cyggomp-1.dll",
    "cygiconv-2.dll",
    "cygintl-8.dll",
    "cygquadmath-0.dll",
    "cygssp-0.dll",
    "cygstdc++-6.dll",
    "cygwin1.dll",
];

#[derive(Clone)]
pub struct SitlOpts {
    pub vehicle: String,
    pub wipe: bool,
    pub home: String,
    pub speedup: f64,
}

struct Inner {
    child: Option<Child>,
    pid: Option<u32>,
    gen: u64,
    phase: String,
    detail: String,
    vehicle: String,
    running: bool,
    want_connect: Option<String>,
    cpu_pct: f32,
    rss_mb: f32,
    cpu_mark: Option<(Instant, u64)>,
    stats_pid: Option<u32>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct LiveFile {
    pid: u32,
    vehicle: String,
}

pub struct SitlCtl {
    inner: Mutex<Inner>,
}

impl SitlCtl {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(Inner {
                child: None,
                pid: None,
                gen: 0,
                phase: "idle".into(),
                detail: String::new(),
                vehicle: String::new(),
                running: false,
                want_connect: None,
                cpu_pct: 0.0,
                rss_mb: 0.0,
                cpu_mark: None,
                stats_pid: None,
            }),
        })
    }

    pub fn write_into(&self, s: &mut Sample) {
        if let Ok(g) = self.inner.lock() {
            s.sitl_phase = g.phase.clone();
            s.sitl_detail = g.detail.clone();
            s.sitl_vehicle = g.vehicle.clone();
            s.sitl_running = g.running;
            s.sitl_cpu = g.cpu_pct;
            s.sitl_rss_mb = g.rss_mb;
        }
    }

    pub fn take_connect(&self) -> Option<String> {
        self.inner.lock().ok()?.want_connect.take()
    }

    /// After a hard kill of this process, SITL may still be running (it is not
    /// in cargo's tree once the bridge exe is gone). Pick it up and reconnect.
    pub fn adopt(self: &Arc<Self>, latest: Arc<Mutex<Sample>>) {
        let Some((pid, vehicle)) = read_live() else {
            return;
        };
        #[cfg(windows)]
        let alive = win_proc::is_running(pid) && win_proc::is_sitl(pid);
        #[cfg(unix)]
        let alive = unix_proc::is_running(pid) && unix_proc::is_sitl(pid);
        if !alive {
            clear_live();
            return;
        }
        let gen = {
            let mut g = match self.inner.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            g.gen = g.gen.wrapping_add(1);
            g.child = None;
            g.pid = Some(pid);
            g.vehicle = vehicle;
            g.phase = "run".into();
            g.detail = String::new();
            g.running = true;
            g.want_connect = Some(LINK.into());
            g.cpu_pct = 0.0;
            g.rss_mb = 0.0;
            g.cpu_mark = None;
            g.stats_pid = Some(pid);
            g.gen
        };
        log::info!("sitl adopt pid={pid}");
        self.push_latest(&latest);
        let ctl = Arc::clone(self);
        std::thread::spawn(move || {
            watch_pid(&ctl, gen, &latest);
        });
    }

    pub fn stop(&self) {
        let mut g = match self.inner.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        g.gen = g.gen.wrapping_add(1);
        let pid = g.pid.take();
        kill_child(g.child.take());
        if let Some(pid) = pid {
            #[cfg(windows)]
            win_proc::kill_tree(pid);
            #[cfg(unix)]
            unix_proc::kill(pid);
        }
        clear_live();
        g.running = false;
        g.phase = "idle".into();
        g.detail = String::new();
        g.want_connect = None;
        g.cpu_pct = 0.0;
        g.rss_mb = 0.0;
        g.cpu_mark = None;
        g.stats_pid = None;
    }

    pub fn start(self: &Arc<Self>, opts: SitlOpts, latest: Arc<Mutex<Sample>>) {
        self.stop();
        let gen = {
            let mut g = match self.inner.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            g.vehicle = norm_vehicle(&opts.vehicle).into();
            g.phase = "download".into();
            g.detail = String::new();
            g.running = false;
            g.gen
        };
        self.push_latest(&latest);
        let ctl = Arc::clone(self);
        std::thread::spawn(move || {
            if let Err(err) = run_job(&ctl, gen, opts, &latest) {
                if ctl.alive(gen) {
                    ctl.set(gen, "error", &err, false, None);
                    ctl.push_latest(&latest);
                }
            }
        });
    }

    fn alive(&self, gen: u64) -> bool {
        self.inner.lock().ok().map(|g| g.gen == gen).unwrap_or(false)
    }

    fn set(&self, gen: u64, phase: &str, detail: &str, running: bool, connect: Option<&str>) {
        let mut g = match self.inner.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        if g.gen != gen {
            return;
        }
        g.phase = phase.into();
        g.detail = detail.into();
        g.running = running;
        if let Some(url) = connect {
            g.want_connect = Some(url.into());
        }
    }

    fn attach(&self, gen: u64, child: Child) {
        if let Ok(mut g) = self.inner.lock() {
            if g.gen == gen {
                kill_child(g.child.take());
                let pid = child.id();
                g.pid = Some(pid);
                g.child = Some(child);
                write_live(pid, &g.vehicle);
            } else {
                kill_child(Some(child));
            }
        }
    }

    fn on_exit(&self, gen: u64) {
        let mut g = match self.inner.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        if g.gen != gen {
            return;
        }
        g.child = None;
        g.pid = None;
        clear_live();
        g.running = false;
        g.cpu_pct = 0.0;
        g.rss_mb = 0.0;
        g.cpu_mark = None;
        g.stats_pid = None;
        if g.phase == "run" || g.phase == "start" {
            g.phase = "error".into();
            g.detail = "SITL exited".into();
        }
    }

    fn push_latest(&self, latest: &Mutex<Sample>) {
        if let Ok(mut g) = latest.lock() {
            self.write_into(&mut g);
        }
    }
}

fn run_job(
    ctl: &Arc<SitlCtl>,
    gen: u64,
    opts: SitlOpts,
    latest: &Mutex<Sample>,
) -> Result<(), String> {
    let vehicle = norm_vehicle(&opts.vehicle);
    let model = if vehicle == "plane" { "plane" } else { "+" };
    let root = sitl_root()?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let run_dir = root.join(vehicle);
    fs::create_dir_all(&run_dir).map_err(|e| e.to_string())?;

    let exe = fetch_sitl(ctl, gen, latest, &root, vehicle)?;
    if !ctl.alive(gen) {
        return Ok(());
    }

    ctl.set(gen, "start", "", false, None);
    ctl.push_latest(latest);

    let home = sanitize_home(&opts.home);
    let speedup = opts.speedup.clamp(1.0, 10.0);
    let mut cmd = Command::new(&exe);
    cmd.arg(format!("-M{model}"))
        .arg(format!("-O{home}"))
        .arg(format!("-s{speedup}"))
        .arg("--serial0")
        .arg("tcp:5770")
        .arg("--serial1")
        .arg("none")
        .arg("--serial2")
        .arg("none")
        .current_dir(&run_dir)
        .env("HOME", &run_dir)
        .stdin(Stdio::null());
    let log = File::create(run_dir.join("sitl.log")).map_err(|e| format!("sitl.log: {e}"))?;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;
    cmd.stdout(Stdio::from(log)).stderr(Stdio::from(log_err));
    if opts.wipe {
        cmd.arg("--wipe");
    }
    let path = std::env::var_os("PATH").unwrap_or_default();
    let mut new_path = root.as_os_str().to_os_string();
    new_path.push(if cfg!(windows) { ";" } else { ":" });
    new_path.push(&run_dir);
    new_path.push(if cfg!(windows) { ";" } else { ":" });
    new_path.push(&path);
    cmd.env("PATH", new_path);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(sitl_spawn_flags());
    }

    log::info!(
        "sitl spawn {} -M{model} -O{home} -s{speedup} --serial0 tcp:5770{}",
        exe.display(),
        if opts.wipe { " --wipe" } else { "" }
    );

    let child = cmd.spawn().map_err(|e| format!("spawn: {e}"))?;
    ctl.attach(gen, child);
    if !ctl.alive(gen) {
        return Ok(());
    }
    // SERIAL0 is one TCP client. Do not probe-connect — that attach/close
    // kills Cygwin SITL when it has no clock console.
    std::thread::sleep(Duration::from_millis(600));
    if !ctl.alive(gen) {
        return Ok(());
    }
    ctl.set(gen, "run", "", true, Some(LINK));
    ctl.push_latest(latest);
    watch_pid(ctl, gen, latest);
    Ok(())
}

fn fetch_sitl(
    ctl: &SitlCtl,
    gen: u64,
    latest: &Mutex<Sample>,
    root: &Path,
    vehicle: &str,
) -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        let (elf, exe_name) = match vehicle {
            "plane" => ("ArduPlane.elf", "ArduPlane.exe"),
            _ => ("ArduCopter.elf", "ArduCopter.exe"),
        };
        ensure_url(
            ctl,
            gen,
            latest,
            &root.join(exe_name),
            &format!("{MP_SITL}{elf}"),
            exe_name,
            1_000_000,
        )?;
        for dll in DLLS {
            ensure_url(
                ctl,
                gen,
                latest,
                &root.join(dll),
                &format!("{MP_SITL}{dll}"),
                dll,
                4_000,
            )?;
        }
        Ok(root.join(exe_name))
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        let dest = root.join(linux_bin(vehicle));
        ensure_url(
            ctl,
            gen,
            latest,
            &dest,
            &linux_fw_url(vehicle),
            linux_bin(vehicle),
            1_000_000,
        )?;
        chmod_exec(&dest)?;
        Ok(dest)
    }
    #[cfg(not(any(windows, all(target_os = "linux", target_arch = "x86_64"))))]
    {
        let _ = (ctl, gen, latest, root, vehicle);
        Err("in-app SITL needs Windows or Linux x86_64".into())
    }
}

#[cfg(any(test, all(target_os = "linux", target_arch = "x86_64")))]
fn linux_bin(vehicle: &str) -> &'static str {
    if vehicle == "plane" {
        "arduplane"
    } else {
        "arducopter"
    }
}

#[cfg(any(test, all(target_os = "linux", target_arch = "x86_64")))]
fn linux_fw_url(vehicle: &str) -> String {
    let folder = if vehicle == "plane" { "Plane" } else { "Copter" };
    format!("{FW}/{folder}/stable/SITL_x86_64_linux_gnu/{}", linux_bin(vehicle))
}

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
fn chmod_exec(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    let mut perms = meta.permissions();
    perms.set_mode(perms.mode() | 0o755);
    fs::set_permissions(path, perms).map_err(|e| e.to_string())
}

fn watch_pid(ctl: &SitlCtl, gen: u64, latest: &Mutex<Sample>) {
    loop {
        std::thread::sleep(Duration::from_millis(400));
        if !ctl.alive(gen) {
            return;
        }
        let exited = {
            let mut g = match ctl.inner.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            if g.gen != gen {
                return;
            }
            let parent = g.pid.or_else(|| g.child.as_ref().map(|c| c.id()));
            let exited = match g.child.as_mut() {
                Some(ch) => match ch.try_wait() {
                    Ok(Some(_)) => {
                        g.child = None;
                        g.pid = None;
                        true
                    }
                    Ok(None) => false,
                    Err(_) => {
                        g.child = None;
                        g.pid = None;
                        true
                    }
                },
                None => match g.pid {
                    Some(pid) => !os_running(pid),
                    None => true,
                },
            };
            if !exited {
                if let Some(parent) = parent {
                    let pid = os_stats_pid(parent);
                    if g.stats_pid != Some(pid) {
                        g.stats_pid = Some(pid);
                        g.cpu_mark = None;
                    }
                    let (cpu, rss) = os_usage(pid, &mut g.cpu_mark);
                    g.cpu_pct = cpu;
                    g.rss_mb = rss;
                }
            }
            exited
        };
        if exited {
            ctl.on_exit(gen);
            ctl.push_latest(latest);
            return;
        }
        ctl.push_latest(latest);
    }
}

fn ensure_url(
    ctl: &SitlCtl,
    gen: u64,
    latest: &Mutex<Sample>,
    dest: &Path,
    url: &str,
    label: &str,
    min_len: u64,
) -> Result<(), String> {
    if !ctl.alive(gen) {
        return Ok(());
    }
    if dest.is_file() {
        if let Ok(meta) = dest.metadata() {
            if meta.len() >= min_len {
                return Ok(());
            }
        }
    }
    ctl.set(gen, "download", label, false, None);
    ctl.push_latest(latest);
    download(url, dest, min_len, &mut |frac| {
        if !ctl.alive(gen) {
            return;
        }
        let pct = (frac * 100.0).round() as u32;
        ctl.set(gen, "download", &format!("{label} {pct}%"), false, None);
        ctl.push_latest(latest);
    })?;
    Ok(())
}

fn download(
    url: &str,
    dest: &Path,
    min_len: u64,
    on_frac: &mut dyn FnMut(f32),
) -> Result<(), String> {
    let tmp = dest.with_extension("part");
    let ureq_err = match download_ureq(url, &tmp, on_frac) {
        Ok(()) => None,
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Some(e)
        }
    };
    if ureq_err.is_some() {
        on_frac(0.0);
        #[cfg(windows)]
        download_powershell(url, &tmp)?;
        #[cfg(unix)]
        download_curl(url, &tmp)?;
        #[cfg(not(any(windows, unix)))]
        return Err(ureq_err.unwrap());
    }
    let len = tmp.metadata().map(|m| m.len()).unwrap_or(0);
    if len < min_len {
        let _ = fs::remove_file(&tmp);
        return Err(format!("short download ({len} bytes)"));
    }
    let _ = fs::remove_file(dest);
    fs::rename(&tmp, dest).map_err(|e| e.to_string())?;
    Ok(())
}

fn download_ureq(url: &str, dest: &Path, on_frac: &mut dyn FnMut(f32)) -> Result<(), String> {
    let resp = ureq::get(url)
        .timeout(Duration::from_secs(300))
        .call()
        .map_err(|e| e.to_string())?;
    if resp.status() != 200 {
        return Err(format!("HTTP {}", resp.status()));
    }
    let total = resp
        .header("Content-Length")
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);
    let mut reader = resp.into_reader();
    let mut file = File::create(dest).map_err(|e| e.to_string())?;
    let mut buf = [0u8; 65_536];
    let mut got = 0u64;
    loop {
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        got += n as u64;
        if total > 0 {
            on_frac((got as f32 / total as f32).clamp(0.0, 1.0));
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(unix)]
fn download_curl(url: &str, dest: &Path) -> Result<(), String> {
    let status = Command::new("curl")
        .args(["-fsSL", "--connect-timeout", "20", "-o"])
        .arg(dest)
        .arg(url)
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("curl {status}"))
    }
}

#[cfg(windows)]
fn download_powershell(url: &str, dest: &Path) -> Result<(), String> {
    let dest_s = dest.to_string_lossy().replace('\'', "''");
    let url_s = url.replace('\'', "''");
    let status = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &format!("Invoke-WebRequest -Uri '{url_s}' -OutFile '{dest_s}' -UseBasicParsing"),
        ])
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("powershell {status}"))
    }
}

fn sitl_root() -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        let base = std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is not set")?;
        Ok(PathBuf::from(base).join("ArduLoops").join("sitl"))
    }
    #[cfg(not(windows))]
    {
        if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
            return Ok(PathBuf::from(xdg).join("ArduLoops").join("sitl"));
        }
        let home = std::env::var_os("HOME").ok_or("HOME is not set")?;
        Ok(PathBuf::from(home).join(".local/share/ArduLoops/sitl"))
    }
}

fn live_path() -> Option<PathBuf> {
    Some(sitl_root().ok()?.join("live.json"))
}

fn write_live(pid: u32, vehicle: &str) {
    let Some(path) = live_path() else { return };
    let body = LiveFile {
        pid,
        vehicle: vehicle.into(),
    };
    if let Ok(txt) = serde_json::to_string(&body) {
        let _ = fs::write(path, txt);
    }
}

fn read_live() -> Option<(u32, String)> {
    let txt = fs::read_to_string(live_path()?).ok()?;
    let live: LiveFile = serde_json::from_str(&txt).ok()?;
    if live.pid == 0 {
        return None;
    }
    Some((live.pid, live.vehicle))
}

fn clear_live() {
    if let Some(path) = live_path() {
        let _ = fs::remove_file(path);
    }
}

/// Inherit the bridge console when we have one (Cygwin clock bits). GUI builds
/// have no console — CREATE_NO_WINDOW avoids a popup.
#[cfg(windows)]
fn sitl_spawn_flags() -> u32 {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetConsoleWindow() -> *mut std::ffi::c_void;
    }
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    if unsafe { GetConsoleWindow() }.is_null() {
        CREATE_NO_WINDOW
    } else {
        0
    }
}

fn norm_vehicle(v: &str) -> &'static str {
    if v.eq_ignore_ascii_case("plane") {
        "plane"
    } else {
        "copter"
    }
}

fn sanitize_home(raw: &str) -> String {
    let s: String = raw.chars().filter(|c| !c.is_whitespace()).collect();
    let n = s.split(',').count();
    if n >= 2 && n <= 4 && s.chars().all(|c| c.is_ascii_digit() || matches!(c, '.' | '-' | ',')) {
        s
    } else {
        DEFAULT_HOME.into()
    }
}

fn kill_child(child: Option<Child>) {
    if let Some(mut ch) = child {
        #[cfg(windows)]
        win_proc::kill_tree(ch.id());
        #[cfg(unix)]
        unix_proc::kill(ch.id());
        let _ = ch.kill();
        let _ = ch.wait();
    }
}

fn os_running(pid: u32) -> bool {
    #[cfg(windows)]
    {
        win_proc::is_running(pid)
    }
    #[cfg(unix)]
    {
        unix_proc::is_running(pid)
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = pid;
        false
    }
}

fn os_stats_pid(parent: u32) -> u32 {
    #[cfg(windows)]
    {
        win_proc::worker_pid(parent).unwrap_or(parent)
    }
    #[cfg(not(windows))]
    {
        parent
    }
}

fn os_usage(pid: u32, mark: &mut Option<(Instant, u64)>) -> (f32, f32) {
    #[cfg(windows)]
    {
        win_proc::usage(pid, mark)
    }
    #[cfg(unix)]
    {
        unix_proc::usage(pid, mark)
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = (pid, mark);
        (0.0, 0.0)
    }
}

#[cfg(unix)]
mod unix_proc {
    use std::fs;
    use std::path::Path;
    use std::process::Command;
    use std::time::{Duration, Instant};

    pub fn is_running(pid: u32) -> bool {
        if Path::new(&format!("/proc/{pid}")).exists() {
            return true;
        }
        Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    pub fn is_sitl(pid: u32) -> bool {
        let comm = fs::read_to_string(format!("/proc/{pid}/comm")).unwrap_or_default();
        let name = comm.trim().to_ascii_lowercase();
        if name.contains("arducopter") || name.contains("arduplane") {
            return true;
        }
        if let Ok(link) = fs::read_link(format!("/proc/{pid}/exe")) {
            let lower = link.to_string_lossy().to_ascii_lowercase();
            return lower.contains("arducopter") || lower.contains("arduplane");
        }
        false
    }

    pub fn kill(pid: u32) {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status();
        std::thread::sleep(Duration::from_millis(80));
        if is_running(pid) {
            let _ = Command::new("kill")
                .args(["-KILL", &pid.to_string()])
                .status();
        }
    }

    pub fn usage(pid: u32, mark: &mut Option<(Instant, u64)>) -> (f32, f32) {
        let rss = rss_mb(pid);
        let ticks = cpu_ticks(pid).unwrap_or(0);
        let now = Instant::now();
        let cpu = if let Some((t0, ticks0)) = *mark {
            let dt = now.saturating_duration_since(t0).as_secs_f32();
            if dt > 0.05 {
                let d = ticks.saturating_sub(ticks0) as f32;
                (d / (100.0 * dt) * 100.0).clamp(0.0, 400.0)
            } else {
                0.0
            }
        } else {
            0.0
        };
        *mark = Some((now, ticks));
        (cpu, rss)
    }

    fn cpu_ticks(pid: u32) -> Option<u64> {
        let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        let rest = stat.rsplit_once(')')?.1;
        let mut it = rest.split_whitespace();
        for _ in 0..11 {
            it.next()?;
        }
        let utime: u64 = it.next()?.parse().ok()?;
        let stime: u64 = it.next()?.parse().ok()?;
        Some(utime + stime)
    }

    fn rss_mb(pid: u32) -> f32 {
        let Ok(txt) = fs::read_to_string(format!("/proc/{pid}/status")) else {
            return 0.0;
        };
        for line in txt.lines() {
            if let Some(rest) = line.strip_prefix("VmRSS:") {
                let kb: f32 = rest
                    .split_whitespace()
                    .next()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0.0);
                return kb / 1024.0;
            }
        }
        0.0
    }
}

#[cfg(windows)]
mod win_proc {
    use std::time::Instant;

    type Handle = *mut std::ffi::c_void;
    type Bool = i32;
    type Dword = u32;
    type FileTime = [u32; 2];

    const TH32CS_SNAPPROCESS: Dword = 0x2;
    const PROCESS_QUERY_INFORMATION: Dword = 0x0400;
    const PROCESS_VM_READ: Dword = 0x0010;
    const PROCESS_TERMINATE: Dword = 0x0001;

    #[repr(C)]
    struct ProcessEntry32W {
        dw_size: Dword,
        cnt_usage: Dword,
        th32_process_id: Dword,
        th32_default_heap_id: usize,
        th32_module_id: Dword,
        cnt_threads: Dword,
        th32_parent_process_id: Dword,
        pc_pri_class_base: i32,
        dw_flags: Dword,
        sz_exe_file: [u16; 260],
    }

    #[repr(C)]
    struct ProcessMemoryCounters {
        cb: Dword,
        page_fault_count: Dword,
        peak_working_set_size: usize,
        working_set_size: usize,
        quota_peak_paged_pool_usage: usize,
        quota_paged_pool_usage: usize,
        quota_peak_non_paged_pool_usage: usize,
        quota_non_paged_pool_usage: usize,
        pagefile_usage: usize,
        peak_pagefile_usage: usize,
    }

    const PROCESS_QUERY_LIMITED_INFORMATION: Dword = 0x1000;
    const STILL_ACTIVE: Dword = 259;

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateToolhelp32Snapshot(flags: Dword, pid: Dword) -> Handle;
        fn Process32FirstW(snapshot: Handle, entry: *mut ProcessEntry32W) -> Bool;
        fn Process32NextW(snapshot: Handle, entry: *mut ProcessEntry32W) -> Bool;
        fn OpenProcess(access: Dword, inherit: Bool, pid: Dword) -> Handle;
        fn TerminateProcess(process: Handle, exit_code: Dword) -> Bool;
        fn CloseHandle(handle: Handle) -> Bool;
        fn GetExitCodeProcess(process: Handle, code: *mut Dword) -> Bool;
        fn GetProcessTimes(
            process: Handle,
            creation: *mut FileTime,
            exit: *mut FileTime,
            kernel: *mut FileTime,
            user: *mut FileTime,
        ) -> Bool;
        fn K32GetProcessMemoryInfo(
            process: Handle,
            counters: *mut ProcessMemoryCounters,
            cb: Dword,
        ) -> Bool;
    }

    fn snapshot() -> Vec<(u32, u32, String)> {
        let mut out = Vec::new();
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap as isize == -1 {
                return out;
            }
            let mut entry = std::mem::zeroed::<ProcessEntry32W>();
            entry.dw_size = std::mem::size_of::<ProcessEntry32W>() as Dword;
            if Process32FirstW(snap, &mut entry) != 0 {
                loop {
                    let name = String::from_utf16_lossy(&entry.sz_exe_file)
                        .trim_end_matches('\0')
                        .to_string();
                    out.push((entry.th32_process_id, entry.th32_parent_process_id, name));
                    if Process32NextW(snap, &mut entry) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snap);
        }
        out
    }

    pub fn worker_pid(parent: u32) -> Option<u32> {
        let procs = snapshot();
        let mut stack = vec![parent];
        let mut seen = std::collections::HashSet::from([parent]);
        while let Some(cur) = stack.pop() {
            for (pid, ppid, name) in &procs {
                if *ppid == cur && seen.insert(*pid) {
                    let lower = name.to_ascii_lowercase();
                    if lower.contains("arducopter") || lower.contains("arduplane") {
                        return Some(*pid);
                    }
                    stack.push(*pid);
                }
            }
        }
        None
    }

    pub fn is_running(pid: u32) -> bool {
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return false;
            }
            let mut code = 0;
            let ok = GetExitCodeProcess(h, &mut code);
            CloseHandle(h);
            ok != 0 && code == STILL_ACTIVE
        }
    }

    pub fn is_sitl(pid: u32) -> bool {
        snapshot()
            .into_iter()
            .find(|(p, _, _)| *p == pid)
            .map(|(_, _, name)| {
                let lower = name.to_ascii_lowercase();
                lower.contains("arducopter") || lower.contains("arduplane")
            })
            .unwrap_or(false)
    }

    pub fn kill_tree(parent: u32) {
        let procs = snapshot();
        let mut stack = vec![parent];
        let mut seen = std::collections::HashSet::from([parent]);
        let mut pids = Vec::new();
        while let Some(cur) = stack.pop() {
            for (pid, ppid, _) in &procs {
                if *ppid == cur && seen.insert(*pid) {
                    pids.push(*pid);
                    stack.push(*pid);
                }
            }
        }
        for pid in pids.into_iter().rev() {
            terminate(pid);
        }
        terminate(parent);
    }

    fn terminate(pid: u32) {
        unsafe {
            let h = OpenProcess(PROCESS_TERMINATE, 0, pid);
            if !h.is_null() {
                TerminateProcess(h, 1);
                CloseHandle(h);
            }
        }
    }

    pub fn usage(pid: u32, mark: &mut Option<(Instant, u64)>) -> (f32, f32) {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
            if handle.is_null() {
                return (0.0, 0.0);
            }
            let out = usage_handle(handle, mark);
            CloseHandle(handle);
            out
        }
    }

    fn filetime_100ns(ft: FileTime) -> u64 {
        ((ft[1] as u64) << 32) | ft[0] as u64
    }

    fn usage_handle(handle: Handle, mark: &mut Option<(Instant, u64)>) -> (f32, f32) {
        let mut creation = [0u32; 2];
        let mut exit = [0u32; 2];
        let mut kernel = [0u32; 2];
        let mut user = [0u32; 2];
        let cpu_ok = unsafe {
            GetProcessTimes(
                handle,
                &mut creation,
                &mut exit,
                &mut kernel,
                &mut user,
            )
        } != 0;
        let cpu_100ns = if cpu_ok {
            filetime_100ns(kernel) + filetime_100ns(user)
        } else {
            0
        };
        let now = Instant::now();
        let cpu_pct = if let Some((prev_t, prev_cpu)) = *mark {
            let wall_ns = now.saturating_duration_since(prev_t).as_nanos() as f64;
            let cpu_ns = cpu_100ns.saturating_sub(prev_cpu) as f64 * 100.0;
            if wall_ns > 0.0 {
                (cpu_ns / wall_ns * 100.0).clamp(0.0, 800.0) as f32
            } else {
                0.0
            }
        } else {
            0.0
        };
        if cpu_ok {
            *mark = Some((now, cpu_100ns));
        }

        let mut mem = ProcessMemoryCounters {
            cb: std::mem::size_of::<ProcessMemoryCounters>() as Dword,
            page_fault_count: 0,
            peak_working_set_size: 0,
            working_set_size: 0,
            quota_peak_paged_pool_usage: 0,
            quota_paged_pool_usage: 0,
            quota_peak_non_paged_pool_usage: 0,
            quota_non_paged_pool_usage: 0,
            pagefile_usage: 0,
            peak_pagefile_usage: 0,
        };
        let rss_mb = if unsafe { K32GetProcessMemoryInfo(handle, &mut mem, mem.cb) } != 0 {
            mem.working_set_size as f32 / (1024.0 * 1024.0)
        } else {
            0.0
        };
        (cpu_pct, rss_mb)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linux_firmware_urls() {
        assert_eq!(
            linux_fw_url("copter"),
            "https://firmware.ardupilot.org/Copter/stable/SITL_x86_64_linux_gnu/arducopter"
        );
        assert_eq!(
            linux_fw_url("plane"),
            "https://firmware.ardupilot.org/Plane/stable/SITL_x86_64_linux_gnu/arduplane"
        );
        assert_eq!(linux_bin("copter"), "arducopter");
        assert_eq!(linux_bin("plane"), "arduplane");
    }
}

