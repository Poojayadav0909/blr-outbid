import { createHash } from "node:crypto";

const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? "";
export const cloudinaryApiKey = process.env.CLOUDINARY_API_KEY ?? "";
const apiSecret = process.env.CLOUDINARY_API_SECRET ?? "";

export const cloudinaryConfigured = () => Boolean(cloudName && cloudinaryApiKey && apiSecret);

function signature(params: Record<string, string>) {
  const query = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join("&");
  return createHash("sha1").update(query + apiSecret).digest("hex");
}

/**
 * Upload a logo to Cloudinary, OWNER-verified, ONLY after payment has succeeded.
 * The `file` (image bytes) is never part of the signed params; it travels as a
 * base64 data URI in the urlencoded form body.
 */
export async function uploadLogo(buffer: Uint8Array, publicId: string, mimeType: string = "image/png"): Promise<{ url: string; publicId: string }> {
  if (!cloudinaryConfigured()) throw new Error("Cloudinary is not configured.");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = { public_id: publicId, overwrite: "true", timestamp };
  const body = new URLSearchParams({
    file: `data:${mimeType};base64,${Buffer.from(buffer).toString("base64")}`,
    api_key: cloudinaryApiKey,
    signature: signature(params),
    ...params,
  });

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as { secure_url?: string; public_id?: string; error?: unknown };
  if (!res.ok || !data.secure_url) {
    throw new Error(`Cloudinary upload failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return { url: data.secure_url, publicId: data.public_id ?? publicId };
}