/** Images per message, the same limit the bridge keeps. */
export const IMAGES_PER_MESSAGE = 4;

const MAX_SIDE = 1600;
const KEEP_BYTES = 1_500_000;

/**
 * A screenshot shrunk so the longer side is at most 1600 px. JPEG, because every
 * provider takes it. A small PNG, JPEG, or WebP is sent as it is; a GIF is never redrawn.
 */
export async function shrinkImage(file: Blob): Promise<Blob> {
  if (file.type === "image/gif") return file;
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const plain = ["image/png", "image/jpeg", "image/webp"].includes(file.type);
    if (scale === 1 && plain && file.size <= KEEP_BYTES) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    // JPEG has no transparency. White keeps dark text on a transparent PNG readable.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    return out ?? file;
  } finally {
    bitmap.close();
  }
}

/** Image files among pasted or dropped items. */
export function imageFiles(list: DataTransferItemList | FileList | null | undefined): File[] {
  if (!list) return [];
  const out: File[] = [];
  for (const item of Array.from(list as ArrayLike<DataTransferItem | File>)) {
    const file = item instanceof File ? item : item.kind === "file" ? item.getAsFile() : null;
    if (file && file.type.startsWith("image/")) out.push(file);
  }
  return out;
}
