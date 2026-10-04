//! Numbered catalog migrations. `build.rs` turns each SQL file into a Rust
//! function. Startup calls the functions whose versions are not in the database.
//! The split files that used to be versions 1 through 6 are one baseline now.
//! A database that still records those checksums is folded into that file.
//! A newer unknown version refuses to open.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};

include!(concat!(env!("OUT_DIR"), "/migrations.rs"));

/// Checksums of the split files, including copies stored before those files were rewritten.
const RETIRED_SPLIT: &[(i64, &str)] = &[
    (1, "9a3d09d76bedf940a3b1ede2086ff55f2d52a0a5dfad9be1279087586641225f"),
    (1, "75e73fef0e8f2f5bdc6be6b6d1c9f8b1dd4843c5b1739d1e1d5a1305abb8b083"),
    (2, "ai-v1"),
    (2, "7a925493e105d4481f3abd5228b17a2fd63a422064411dd0029ea8310f351a1f"),
    (2, "8f744dfc1222d1da64cfd41352c76ba5b1c2dc353db7e13293636f13b7654d74"),
    (3, "4545461548af2c34e61a4fdc2b0912813141f77c8011ed30631b5f5ede4391e5"),
    (3, "97c9ce9b922b2000b645aa625cbbec6e03503737d77a684e06cdfe70cd7684e6"),
    (4, "ba02b99a69ad8be18d761a957e6c0fd67604e65f02eb62fd37b747d3de3b1220"),
    (5, "4297241f5470f200a396985cf59bb97b2728664083976a0025559d2c41a333c0"),
    (6, "9cae988eb362e3df22106504c5694e38aae6b77812eff6a1459a090af8cfebdd"),
];

const FOLDED_THROUGH: i64 = 6;

fn latest() -> i64 {
    MIGRATIONS.last().map(|step| step.version).unwrap_or(0)
}

static FORCE_LATEST: AtomicBool = AtomicBool::new(false);

/// Re-run the latest migration when its file no longer matches the stored checksum.
pub fn force_latest(on: bool) {
    FORCE_LATEST.store(on, Ordering::Relaxed);
}

pub fn apply(conn: &Connection) -> Result<(), String> {
    apply_with(conn, FORCE_LATEST.load(Ordering::Relaxed))
}

fn apply_with(conn: &Connection, force: bool) -> Result<(), String> {
    conn.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
    let _ = conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            checksum TEXT NOT NULL,
            applied_at INTEGER NOT NULL,
            app_version TEXT NOT NULL
         );",
    )
    .map_err(|e| e.to_string())?;
    let mut applied = applied_versions(conn)?;
    let newest = applied.keys().copied().max().unwrap_or(0);
    let known = latest();
    if newest > known && newest > FOLDED_THROUGH {
        return Err(format!(
            "This database is version {newest}, newer than this ArduLoops ({known}). Refusing to change it."
        ));
    }
    let folded = retired_split(&applied);
    if folded {
        if has_existing_tables(conn)? {
            backup(conn)?;
        }
        conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
        let baseline = &MIGRATIONS[0];
        if let Err(error) = (baseline.run)(conn).and_then(|_| {
            conn.execute("DELETE FROM schema_migrations", []).map_err(|e| e.to_string())?;
            record(conn, baseline)
        }) {
            let _ = conn.execute_batch("ROLLBACK");
            return Err(format!("migration {} ({}) failed: {error}", baseline.version, baseline.name));
        }
        conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
        applied = applied_versions(conn)?;
    }
    let rewriting = force && MIGRATIONS.last().is_some_and(|step| {
        applied.get(&step.version).is_some_and(|stored| stored != &checksum(step.sql))
    });
    for step in MIGRATIONS {
        if let Some(stored) = applied.get(&step.version) {
            if stored != &checksum(step.sql) && !(rewriting && step.version == latest()) {
                return Err(format!(
                    "Database migration {} ({}) no longer matches the copy that was applied. ArduLoops will not change this file. Restore a backup saved beside the database.",
                    step.version, step.name
                ));
            }
        }
    }
    let mut pending: Vec<&MigrationFn> = MIGRATIONS.iter().filter(|step| !applied.contains_key(&step.version)).collect();
    if rewriting {
        if let Some(step) = MIGRATIONS.last() {
            pending.push(step);
        }
    }
    if pending.is_empty() {
        return if folded { checked(conn) } else { Ok(()) };
    }
    if has_existing_tables(conn)? {
        backup(conn)?;
    }
    for step in pending {
        conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
        let replace = if applied.contains_key(&step.version) {
            conn.execute("DELETE FROM schema_migrations WHERE version=?1", [step.version]).map(|_| ()).map_err(|e| e.to_string())
        } else {
            Ok(())
        };
        if let Err(error) = replace.and_then(|_| (step.run)(conn)).and_then(|_| record(conn, step)) {
            let _ = conn.execute_batch("ROLLBACK");
            return Err(format!("migration {} ({}) failed: {error}", step.version, step.name));
        }
        conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
    }
    checked(conn)
}

fn checked(conn: &Connection) -> Result<(), String> {
    let check: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if check != "ok" {
        return Err(format!("database integrity check failed: {check}"));
    }
    let fk: i64 = conn
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if fk > 0 {
        return Err("database foreign key check failed".into());
    }
    Ok(())
}

fn checksum(sql: &str) -> String {
    format!("{:x}", Sha256::digest(sql.as_bytes()))
}

fn retired_split(applied: &HashMap<i64, String>) -> bool {
    applied.iter().any(|(version, sum)| {
        RETIRED_SPLIT.iter().any(|(retired_version, retired_sum)| version == retired_version && sum == retired_sum)
    })
}

fn repair_baseline(conn: &Connection) -> Result<(), String> {
    add_column(conn, "firmware_artifacts", "comment", "TEXT NOT NULL DEFAULT ''")?;
    add_column(conn, "controllers", "comment", "TEXT NOT NULL DEFAULT ''")?;
    add_column(conn, "controllers", "flashed_artifact_id", "TEXT")?;
    add_column(conn, "ai_audit", "detail", "TEXT NOT NULL DEFAULT ''")?;
    add_column(conn, "ai_proposal", "kind", "TEXT NOT NULL DEFAULT 'param'")?;
    add_column(conn, "ai_proposal", "payload", "TEXT NOT NULL DEFAULT ''")?;
    add_column(conn, "ai_chat", "vehicle_key", "TEXT NOT NULL DEFAULT ''")?;
    Ok(())
}

fn applied_versions(conn: &Connection) -> Result<HashMap<i64, String>, String> {
    let mut stmt = conn
        .prepare("SELECT version, checksum FROM schema_migrations")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut out = HashMap::new();
    for row in rows {
        let (version, sum) = row.map_err(|e| e.to_string())?;
        out.insert(version, sum);
    }
    Ok(out)
}

fn has_existing_tables(conn: &Connection) -> Result<bool, String> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT IN ('schema_migrations', 'sqlite_sequence')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

fn backup(conn: &Connection) -> Result<(), String> {
    let Some(path) = conn.path() else {
        return Ok(());
    };
    if path.is_empty() || path == ":memory:" {
        return Ok(());
    }
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let dest = format!("{path}.bak-{stamp}");
    let escaped = dest.replace('\'', "''");
    conn.execute_batch(&format!("VACUUM INTO '{escaped}'"))
        .map_err(|e| format!("could not back up the database before migrating: {e}"))?;
    Ok(())
}

fn record(conn: &Connection, step: &MigrationFn) -> Result<(), String> {
    let at = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    conn.execute(
        "INSERT INTO schema_migrations (version, name, checksum, applied_at, app_version) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![step.version, step.name, checksum(step.sql), at, env!("CARGO_PKG_VERSION")],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn add_column(conn: &Connection, table: &str, column: &str, decl: &str) -> Result<(), String> {
    let n: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name=?1"),
            [column],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        conn.execute(&format!("ALTER TABLE {table} ADD COLUMN {column} {decl}"), [])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{apply, apply_with};
    use rusqlite::Connection;
    use std::fs;

    #[test]
    fn legacy_rows_survive_and_a_second_run_changes_nothing() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE firmware_artifacts (
                artifact_id TEXT PRIMARY KEY, build_id TEXT, vehicle_id TEXT NOT NULL, board_name TEXT,
                board_id INTEGER NOT NULL, version_id TEXT, git_identity TEXT, image_size INTEGER,
                description TEXT, file_path TEXT, features_json TEXT NOT NULL, created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL);
             INSERT INTO firmware_artifacts VALUES ('keep', NULL, 'copter', 'JHEM', 1081, NULL, NULL, 1, '', '', '{}', 1, 1);
             CREATE TABLE schema_migrations (
                version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL,
                applied_at INTEGER NOT NULL, app_version TEXT NOT NULL);
             INSERT INTO schema_migrations VALUES (2, 'agent_history', 'ai-v1', 1, '1.4.0');
             CREATE TABLE ai_audit (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL, result TEXT NOT NULL, source TEXT NOT NULL);
             CREATE TABLE ai_proposal (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, status TEXT NOT NULL, param TEXT NOT NULL, old_value REAL, new_value REAL NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL);
             CREATE TABLE ai_chat (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
             INSERT INTO ai_chat VALUES ('chat', 'kept', 1, 1);",
        )
        .unwrap();
        apply(&conn).unwrap();
        let artifact: String = conn.query_row("SELECT artifact_id FROM firmware_artifacts", [], |row| row.get(0)).unwrap();
        let title: String = conn.query_row("SELECT title FROM ai_chat", [], |row| row.get(0)).unwrap();
        let versions: i64 = conn.query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| row.get(0)).unwrap();
        let cache: i64 = conn
            .query_row("SELECT COUNT(*) FROM sqlite_master WHERE name='param_cache'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(artifact, "keep");
        assert_eq!(title, "kept");
        assert_eq!(versions, super::MIGRATIONS.len() as i64);
        assert_eq!(cache, 1);
        apply(&conn).unwrap();
        let again: i64 = conn.query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| row.get(0)).unwrap();
        assert_eq!(again, super::MIGRATIONS.len() as i64);
    }

    #[test]
    fn force_rewrites_only_the_latest_migration() {
        let conn = Connection::open_in_memory().unwrap();
        apply(&conn).unwrap();
        conn.execute(
            "INSERT INTO firmware_artifacts (artifact_id, vehicle_id, board_id, features_json, created_at, updated_at) VALUES ('keep', 'copter', 1, '{}', 1, 1)",
            [],
        ).unwrap();
        conn.execute("UPDATE schema_migrations SET checksum='stale' WHERE version=(SELECT MAX(version) FROM schema_migrations)", []).unwrap();
        let error = apply(&conn).unwrap_err();
        assert!(error.contains("no longer matches"), "{error}");
        apply_with(&conn, true).unwrap();
        let stale: i64 = conn.query_row("SELECT COUNT(*) FROM schema_migrations WHERE checksum='stale'", [], |row| row.get(0)).unwrap();
        assert_eq!(stale, 0);
        let artifact: String = conn.query_row("SELECT artifact_id FROM firmware_artifacts", [], |row| row.get(0)).unwrap();
        assert_eq!(artifact, "keep");
    }

    #[test]
    fn a_newer_database_is_left_alone() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE schema_migrations (
                version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL,
                applied_at INTEGER NOT NULL, app_version TEXT NOT NULL);
             INSERT INTO schema_migrations VALUES (99, 'future', 'x', 1, '9');
             CREATE TABLE firmware_artifacts (artifact_id TEXT PRIMARY KEY);
             INSERT INTO firmware_artifacts VALUES ('keep');",
        )
        .unwrap();
        let error = apply(&conn).unwrap_err();
        assert!(error.contains("newer"), "{error}");
        let artifact: String = conn.query_row("SELECT artifact_id FROM firmware_artifacts", [], |row| row.get(0)).unwrap();
        assert_eq!(artifact, "keep");
    }

    #[test]
    fn file_database_is_backed_up_before_a_new_migration() {
        let path = std::env::temp_dir().join(format!("arduloops-migrate-{}.sqlite3", std::process::id()));
        let _ = fs::remove_file(&path);
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE firmware_artifacts (
                artifact_id TEXT PRIMARY KEY, build_id TEXT, vehicle_id TEXT NOT NULL, board_name TEXT,
                board_id INTEGER NOT NULL, version_id TEXT, git_identity TEXT, image_size INTEGER,
                description TEXT, file_path TEXT, features_json TEXT NOT NULL, created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL);
             INSERT INTO firmware_artifacts VALUES ('keep', NULL, 'copter', NULL, 1, NULL, NULL, 1, '', '', '{}', 1, 1);",
        )
        .unwrap();
        apply(&conn).unwrap();
        let artifact: String = conn.query_row("SELECT artifact_id FROM firmware_artifacts", [], |row| row.get(0)).unwrap();
        assert_eq!(artifact, "keep");
        drop(conn);
        let backups: Vec<_> = fs::read_dir(std::env::temp_dir())
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with(&format!("arduloops-migrate-{}.sqlite3.bak-", std::process::id())))
            .collect();
        assert_eq!(backups.len(), 1, "{backups:?}");
        for name in &backups {
            let _ = fs::remove_file(std::env::temp_dir().join(name));
        }
        let _ = fs::remove_file(&path);
    }
}
