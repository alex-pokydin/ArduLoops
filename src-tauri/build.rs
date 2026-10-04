use std::fs;
use std::path::Path;

fn main() {
    println!("cargo::rustc-check-cfg=cfg(mobile)");
    embed_migrations();
    embed_skills();
    #[cfg(feature = "desktop")]
    tauri_build::build();
}

/// Embeds src-tauri/migrations/NNNN_name.sql in numeric order.
/// The packaged app has no migrations folder to scan at runtime.
fn embed_migrations() {
    println!("cargo:rerun-if-changed=migrations");
    let mut found = Vec::new();
    for entry in fs::read_dir("migrations").unwrap_or_else(|error| panic!("read migrations: {error}")) {
        let path = entry.unwrap_or_else(|error| panic!("read migrations: {error}")).path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("sql") {
            continue;
        }
        println!("cargo:rerun-if-changed={}", path.display());
        let stem = path.file_stem().and_then(|stem| stem.to_str()).unwrap_or("");
        let (number, name) = stem.split_once('_').unwrap_or_else(|| {
            panic!("migration {} must be NNNN_snake_name.sql", path.display());
        });
        if number.len() != 4 || !number.chars().all(|c| c.is_ascii_digit()) {
            panic!("migration {} must start with four digits", path.display());
        }
        if name.is_empty() || !name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') {
            panic!("migration {} name must be snake_case", path.display());
        }
        let version: i64 = number.parse().unwrap();
        let sql = fs::read_to_string(&path).unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
        found.push((version, name.to_string(), sql));
    }
    found.sort_by_key(|(version, _, _)| *version);
    if found.is_empty() {
        panic!("migrations directory has no SQL files");
    }
    for (index, (version, _, _)) in found.iter().enumerate() {
        let expected = index as i64 + 1;
        if *version != expected {
            panic!("migration versions must be contiguous from 0001; expected {expected:04}, found {version:04}");
        }
    }
    let mut code = String::from(
        "struct MigrationFn {\n    version: i64,\n    name: &'static str,\n    sql: &'static str,\n    run: fn(&Connection) -> Result<(), String>,\n}\n\n",
    );
    for (version, name, sql) in &found {
        let fn_name = format!("migration_{version:04}_{name}");
        let sql_const = format!("MIGRATION_{version:04}_SQL");
        code.push_str(&format!("const {sql_const}: &str = {};\n\n", rust_raw_string(sql)));
        code.push_str(&format!("fn {fn_name}(conn: &Connection) -> Result<(), String> {{\n"));
        code.push_str(&function_body(*version, &sql_const));
        code.push_str("}\n\n");
    }
    code.push_str("static MIGRATIONS: &[MigrationFn] = &[\n");
    for (version, name, _) in &found {
        let fn_name = format!("migration_{version:04}_{name}");
        let sql_const = format!("MIGRATION_{version:04}_SQL");
        code.push_str(&format!(
            "    MigrationFn {{ version: {version}, name: \"{name}\", sql: {sql_const}, run: {fn_name} }},\n"
        ));
    }
    code.push_str("];\n");
    let dest = Path::new(&std::env::var("OUT_DIR").unwrap()).join("migrations.rs");
    fs::write(&dest, code).unwrap_or_else(|error| panic!("write {}: {error}", dest.display()));
}

/// Plain SQL becomes `execute_batch`. The baseline also adds columns that an
/// older table may already lack, so those ALTERs are not in the SQL file.
fn function_body(version: i64, sql_const: &str) -> String {
    let mut body = format!("    conn.execute_batch({sql_const}).map_err(|e| e.to_string())?;\n");
    if version == 1 {
        body.push_str("    repair_baseline(conn)?;\n");
    }
    body.push_str("    Ok(())\n");
    body
}

/// Embeds ../skills/ROOT.md. Evidence invariants stay separate from each field's contract. The packaged app does not read that folder at runtime. A running bridge picks up a change to this embedded skill only when cargo runs again.
fn embed_skills() {
    let path = Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("../skills/ROOT.md");
    println!("cargo:rerun-if-changed={}", path.display());
    let text = fs::read_to_string(&path).unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    let code = format!("const SKILL_ROOT: &str = {};\n", rust_raw_string(&text));
    let dest = Path::new(&std::env::var("OUT_DIR").unwrap()).join("skills.rs");
    fs::write(&dest, code).unwrap_or_else(|error| panic!("write {}: {error}", dest.display()));
}

fn rust_raw_string(value: &str) -> String {
    let mut hashes = 1;
    loop {
        let fence = "#".repeat(hashes);
        if !value.contains(&format!("\"{fence}")) {
            return format!("r{fence}\"{value}\"{fence}");
        }
        hashes += 1;
    }
}
