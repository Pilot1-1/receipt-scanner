// Phone photos are often 5-15 MB; the processor rejects anything over 7 MB.
// Shrinking in the browser also makes the upload (and Gemini) much faster.
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIDE = 2400; // receipts are tall and narrow, so keep enough pixels to read small print
const SKIP_BELOW = 2 * 1024 * 1024;
const HARD_LIMIT = 7 * 1024 * 1024;

export async function prepareImage(file) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));

    if (scale === 1 && ALLOWED.includes(file.type) && file.size <= SKIP_BELOW) {
      bitmap.close();
      return { blob: file, contentType: file.type };
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error("encode failed");
    return { blob, contentType: "image/jpeg" };
  } catch {
    // The browser could not decode it (e.g. HEIC in Chrome): send the original if the API accepts it.
    if (ALLOWED.includes(file.type) && file.size <= HARD_LIMIT) return { blob: file, contentType: file.type };
    throw new Error(`${file.name}: use a JPEG, PNG or WebP photo under 7 MB`);
  }
}
