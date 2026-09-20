import type { Env } from "./env";

const cloudinaryConfigured = (env: Env) =>
  Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);

async function signature(params: Record<string, string>, env: Env): Promise<string> {
  const query = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join("&");
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(query + env.CLOUDINARY_API_SECRET));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

/**
 * Upload a logo to Cloudinary, OWNER-verified, ONLY after payment has succeeded.
 * The `file` (image bytes) travels as a base64 data URI in the urlencoded form body.
 */
export async function uploadLogo(
  bytes: Uint8Array,
  publicId: string,
  mimeType: string = "image/png",
  env: Env,
): Promise<{ url: string; publicId: string }> {
  if (!cloudinaryConfigured(env)) throw new Error("Cloudinary is not configured.");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = { public_id: publicId, overwrite: "true", timestamp };
  const body = new URLSearchParams({
    file: `data:${mimeType};base64,${bytesToBase64(bytes)}`,
    api_key: env.CLOUDINARY_API_KEY ?? "",
    signature: await signature(params, env),
    ...params,
  });

  const res = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/auto/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as {
    secure_url?: string;
    public_id?: string;
    error?: unknown;
  };
  if (!res.ok || !data.secure_url) {
    throw new Error(`Cloudinary upload failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return { url: data.secure_url, publicId: data.public_id ?? publicId };
}