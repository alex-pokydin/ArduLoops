//! App version vs the latest GitHub release. One path for desktop and phone.
//! GitHub is only checked in the background. Status never waits on the network.
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use crate::db::data_dir;

const RELEASES_API: &str = "https://api.github.com/repos/alex-pokydin/ArduLoops/releases/latest";
const RELEASES_PAGE: &str = "https://github.com/alex-pokydin/ArduLoops/releases/latest";
const CACHE_TTL: Duration = Duration::from_secs(6 * 60 * 60);

struct Release {
    tag: String,
    url: String,
}

struct Cache {
    at: Instant,
    release: Option<Release>,
}

static CACHE: Mutex<Option<Cache>> = Mutex::new(None);
static FETCHING: AtomicBool = AtomicBool::new(false);

pub fn status(refresh: bool) -> Value {
    #[cfg(not(test))]
    kick(refresh);
    #[cfg(test)]
    let _ = refresh;
    report(env!("CARGO_PKG_VERSION"), cached_release().as_ref())
}

pub fn kick_refresh() {
    kick(false);
}

fn kick(force: bool) {
    if !force && cache_fresh() {
        return;
    }
    if FETCHING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    let started = std::thread::Builder::new()
        .name("arduloops-release".into())
        .spawn(|| {
            match fetch_github() {
                Ok(release) => remember(Some(release)),
                Err(_) => remember_attempt(),
            }
            FETCHING.store(false, Ordering::SeqCst);
        })
        .is_ok();
    if !started {
        FETCHING.store(false, Ordering::SeqCst);
    }
}

fn report(current: &str, found: Option<&Release>) -> Value {
    let latest = found.map(|item| item.tag.as_str()).unwrap_or(current);
    let url = found
        .map(|item| item.url.as_str())
        .unwrap_or(RELEASES_PAGE);
    json!({
        "current": current,
        "latest": latest,
        "newer": is_newer(latest, current),
        "url": url,
    })
}

fn cache_fresh() -> bool {
    CACHE
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|item| item.at.elapsed() < CACHE_TTL))
        .unwrap_or(false)
}

fn cached_release() -> Option<Release> {
    if let Ok(guard) = CACHE.lock() {
        if let Some(release) = guard.as_ref().and_then(|item| item.release.as_ref()) {
            return Some(Release {
                tag: release.tag.clone(),
                url: release.url.clone(),
            });
        }
    }
    read_disk()
}

fn remember(release: Option<Release>) {
    if let Ok(mut guard) = CACHE.lock() {
        *guard = Some(Cache {
            at: Instant::now(),
            release: release.as_ref().map(|item| Release {
                tag: item.tag.clone(),
                url: item.url.clone(),
            }),
        });
    }
    let Some(release) = release else {
        return;
    };
    let path = data_dir().join("release-latest.json");
    let body = json!({
        "tag": release.tag,
        "url": release.url,
        "at": SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
    });
    if let Ok(text) = serde_json::to_string(&body) {
        let _ = fs::write(path, text);
    }
}

fn remember_attempt() {
    if let Ok(mut guard) = CACHE.lock() {
        if let Some(item) = guard.as_mut() {
            item.at = Instant::now();
            return;
        }
        *guard = Some(Cache {
            at: Instant::now(),
            release: read_disk(),
        });
    }
}

fn read_disk() -> Option<Release> {
    let text = fs::read_to_string(data_dir().join("release-latest.json")).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    let tag = value["tag"].as_str()?.trim();
    if tag.is_empty() {
        return None;
    }
    Some(Release {
        tag: tag.to_string(),
        url: value["url"]
            .as_str()
            .filter(|item| !item.is_empty())
            .unwrap_or(RELEASES_PAGE)
            .to_string(),
    })
}

fn fetch_github() -> Result<Release, String> {
    install_tls();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .use_preconfigured_tls(mozilla_tls())
        .build()
        .map_err(|e| e.to_string())?;
    let version = env!("CARGO_PKG_VERSION");
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    runtime.block_on(async move {
        let resp = client
            .get(RELEASES_API)
            .header("user-agent", format!("ArduLoops/{version}"))
            .header("accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = resp.status();
        let text = resp.text().await.map_err(|e| e.to_string())?;
        let value: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({}));
        if !status.is_success() {
            return Err(format!("github {status}"));
        }
        if value["draft"].as_bool() == Some(true) || value["prerelease"].as_bool() == Some(true) {
            return Err("prerelease".into());
        }
        let tag = value["tag_name"].as_str().unwrap_or("").trim();
        if tag.is_empty() {
            return Err("empty tag".into());
        }
        let url = value["html_url"]
            .as_str()
            .filter(|item| item.starts_with("https://github.com/"))
            .unwrap_or(RELEASES_PAGE);
        Ok(Release {
            tag: tag.to_string(),
            url: url.to_string(),
        })
    })
}

fn install_tls() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

fn mozilla_tls() -> rustls::ClientConfig {
    install_tls();
    let roots = rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth()
}

fn triple(raw: &str) -> Option<(u64, u64, u64)> {
    let text = raw.trim().trim_start_matches('v');
    let mut parts = text.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next().unwrap_or("0").split('-').next()?.parse().ok()?;
    Some((major, minor, patch))
}

fn is_newer(latest: &str, current: &str) -> bool {
    match (triple(latest), triple(current)) {
        (Some(latest), Some(current)) => latest > current,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_newer_tag_is_an_update() {
        assert!(super::is_newer("2.2.2", "2.2.1"));
        assert!(super::is_newer("v2.3.0", "2.2.9"));
        assert!(!super::is_newer("2.2.1", "2.2.1"));
        assert!(!super::is_newer("2.2.0", "2.2.1"));
        assert!(!super::is_newer("not-a-version", "2.2.1"));
        assert_eq!(super::triple("2.2.1-beta"), Some((2, 2, 1)));
    }

    #[test]
    fn a_missing_release_keeps_this_build() {
        let body = super::report("2.2.1", None);
        assert_eq!(body["current"], "2.2.1");
        assert_eq!(body["latest"], "2.2.1");
        assert_eq!(body["newer"], false);
        let found = super::Release {
            tag: "2.3.0".into(),
            url: "https://github.com/alex-pokydin/ArduLoops/releases/tag/2.3.0".into(),
        };
        let next = super::report("2.2.1", Some(&found));
        assert_eq!(next["newer"], true);
        assert_eq!(next["latest"], "2.3.0");
    }
}
