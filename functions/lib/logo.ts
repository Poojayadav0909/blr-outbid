import type { Env } from "./env";
import { uploadLogo } from "./cloudinary";
import { store } from "./store";

const dataUrlBytes = (dataUrl: string): Uint8Array | null => {
  const match = /^data:[^;,]+;base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  try {
    const binary = atob(match[1] ?? "");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
};

/** Push a pending logo (stored as a data URL) to Cloudinary after payment clears. */
export async function settleLogoIfAny(orderId: number, spotId: string, env: Env) {
  if (await store.getOrderLogoUrl(env, orderId)) return;
  const data = await store.getLogoData(env, orderId);
  if (!data || !data.startsWith("data:image/")) return;
  const bytes = dataUrlBytes(data);
  if (!bytes) return;
  
  // Extract MIME type from data URL
  const mimeMatch = /^data:([^;,]+);base64,/.exec(data);
  const mimeType = mimeMatch?.[1] || "image/png";
  
  try {
    const { url, publicId } = await uploadLogo(
      bytes,
      `spot-logos/spot_${spotId}_order_${orderId}`,
      mimeType,
      env,
    );
    await store.updateOrderLogo(env, orderId, url, publicId);
  } catch (error) {
    console.error(`Logo upload for order ${orderId} deferred:`, error);
  }
}