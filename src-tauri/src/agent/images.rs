// Images the user attached to a message. Each file is stored once, named by its content hash.

const IMAGE_LIMIT: usize = 8 * 1024 * 1024;
const IMAGES_PER_TURN: usize = 4;

fn images_dir() -> std::path::PathBuf {
    data_dir().join("ai-images")
}

fn image_mime(ext: &str) -> Option<&'static str> {
    match ext {
        "png" => Some("image/png"),
        "jpg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        _ => None,
    }
}

fn image_ext(content_type: &str) -> Option<&'static str> {
    match content_type.split(';').next().unwrap_or("").trim() {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        _ => None,
    }
}

/// Store an image the user picked and return its id, `{sha256_16}.{ext}`.
pub fn store_image(bytes: &[u8], content_type: &str) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("The image is empty.".into());
    }
    if bytes.len() > IMAGE_LIMIT {
        return Err("This image is larger than 8 MB.".into());
    }
    let ext = image_ext(content_type).ok_or("This file is not a PNG, JPEG, WebP, or GIF image.")?;
    use sha2::Digest;
    let hash = sha2::Sha256::digest(bytes);
    let stem: String = hash.iter().take(8).map(|byte| format!("{byte:02x}")).collect();
    let id = format!("{stem}.{ext}");
    let dir = images_dir();
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let path = dir.join(&id);
    if !path.is_file() {
        fs::write(&path, bytes).map_err(|err| err.to_string())?;
    }
    Ok(id)
}

/// Only an id this bridge issued: 16 hex characters and a known extension.
fn image_path(id: &str) -> Option<std::path::PathBuf> {
    let (stem, ext) = id.split_once('.')?;
    if stem.len() != 16 || !stem.chars().all(|c| c.is_ascii_hexdigit()) || image_mime(ext).is_none() {
        return None;
    }
    let path = images_dir().join(id);
    path.is_file().then_some(path)
}

/// The stored bytes and their media type, for showing the image again.
pub fn image_file(id: &str) -> Option<(Vec<u8>, &'static str)> {
    let path = image_path(id)?;
    let mime = image_mime(id.rsplit('.').next()?)?;
    Some((fs::read(path).ok()?, mime))
}

/// Ids from a send body that name stored images, at most four.
fn image_ids(value: &Value) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for id in value.as_array().into_iter().flatten().filter_map(Value::as_str) {
        if out.len() == IMAGES_PER_TURN {
            break;
        }
        if image_path(id).is_some() && !out.iter().any(|seen| seen == id) {
            out.push(id.to_string());
        }
    }
    out
}

/// The images of this turn, ready to send with the user message.
fn turn_images(value: &Value) -> Vec<genai::chat::Binary> {
    use base64::Engine;
    image_ids(value)
        .into_iter()
        .filter_map(|id| {
            let (bytes, mime) = image_file(&id)?;
            let data = base64::engine::general_purpose::STANDARD.encode(bytes);
            Some(genai::chat::Binary::from_base64(mime, data, Some(id)))
        })
        .collect()
}

fn user_message(prompt: &str, images: Vec<genai::chat::Binary>) -> genai::chat::ChatMessage {
    if images.is_empty() {
        return genai::chat::ChatMessage::user(prompt);
    }
    let mut parts = vec![genai::chat::ContentPart::Text(prompt.to_string())];
    parts.extend(images.into_iter().map(genai::chat::ContentPart::Binary));
    genai::chat::ChatMessage::user(genai::chat::MessageContent::from_parts(parts))
}
