import type { Env } from "./env";

export const dodoConfigured = (env: Env) =>
  Boolean(env.DODO_API_KEY && env.DODO_PRODUCT_ID && env.DODO_WEBHOOK_SECRET);

const apiBase = (env: Env) =>
  env.DODO_ENVIRONMENT === "live" || env.DODO_ENVIRONMENT === "production"
    ? "https://live.dodopayments.com"
    : "https://test.dodopayments.com";

export const publicBase = (env: Env) => env.PUBLIC_BASE_URL ?? "http://localhost:3000";

/** Create a Dodo hosted Checkout Session for a variable bid amount. */
export function dodoErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(text.replace(/^.*?\{/, "{")) as { message?: string };
    if (parsed.message) return parsed.message;
  } catch {
    /* not Dodo error JSON */
  }
  return /failed \(\d{3}\)/.test(text) ? "Checkout could not be started. Try again." : String(error);
}

export async function createCheckoutSession(
  env: Env,
  input: { spotId: string; amountCents: number },
): Promise<{ session_id: string; checkout_url: string }> {
  const res = await fetch(`${apiBase(env)}/checkouts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.DODO_API_KEY}`,
    },
    body: JSON.stringify({
      product_cart: [
        { product_id: env.DODO_PRODUCT_ID, quantity: 1, amount: Math.round(input.amountCents) },
      ],
      metadata: { spotId: input.spotId },
      return_url: `${publicBase(env)}/?checkout=success`,
      cancel_url: `${publicBase(env)}/?checkout=cancelled`,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    session_id?: string;
    checkout_url?: string;
    error?: string;
  };
  if (!res.ok || !body.session_id) {
    throw new Error(`Dodo create-session failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return { session_id: body.session_id, checkout_url: body.checkout_url ?? "" };
}

export async function getCheckoutSession(
  env: Env,
  sessionId: string,
): Promise<{
  status?: string;
  payment_status?: string;
  amount?: number;
  currency?: string;
} | null> {
  try {
    const res = await fetch(`${apiBase(env)}/checkouts/${sessionId}`, {
      headers: { Authorization: `Bearer ${env.DODO_API_KEY}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      status?: string;
      payment_status?: string;
      amount?: number;
      currency?: string;
    };
  } catch {
    return null;
  }
}

export function isSessionPaid(session: { status?: string; payment_status?: string }): boolean {
  return [session.status, session.payment_status].some(
    value => typeof value === "string" && /(succeeded|completed|paid)/i.test(value),
  );
}

const encoder = new TextEncoder();

function hmacSha256(secret: string, message: string): Promise<ArrayBuffer> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  ).then(key => crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

const base64ToBytes = (value: string): Uint8Array => {
  const bin = atob(value);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

const bytesToHex = (value: ArrayBuffer): string =>
  [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");

/** Constant-time compare; lengths must match. */
const safeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
};

/**
 * Standard Webhooks signature verification (docs.dodopayments.com/developer-resources/webhooks).
 * Signature = HMAC-SHA256 of `${webhook-id}.${webhook-timestamp}.${rawPayload}` using the
 * webhook signing secret; header value is expected as `v1,<base64>`.
 */
export async function verifyWebhook(
  rawBody: string,
  headers: { "webhook-id"?: string; "webhook-timestamp"?: string; "webhook-signature"?: string },
  webhookSecret: string,
): Promise<boolean> {
  if (!webhookSecret || !rawBody) return false;
  const id = headers["webhook-id"] ?? "";
  const timestamp = headers["webhook-timestamp"] ?? "";
  const received = (headers["webhook-signature"] ?? "").split(",").pop()?.trim() ?? "";
  if (!id || !timestamp || !received) return false;
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 15 * 60) {
    return false;
  }
  const message = `${id}.${timestamp}.${rawBody}`;
  const digest = await hmacSha256(webhookSecret, message);
  const a = base64ToBytes(received);
  const match = (expected: Uint8Array) => safeEqual(a, expected);
  if (match(new Uint8Array(digest))) return true;
  const hex = bytesToHex(digest);
  const hexBytes = new TextEncoder().encode(hex);
  return a.length === hexBytes.length && safeEqual(a, hexBytes);
}