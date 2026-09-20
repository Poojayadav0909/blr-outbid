import { createHmac, timingSafeEqual } from "node:crypto";

const liveMode =
  process.env.DODO_ENVIRONMENT === "live" || process.env.DODO_ENVIRONMENT === "production";
const apiKey = process.env.DODO_API_KEY ?? "";
const productId = process.env.DODO_PRODUCT_ID ?? "";
const webhookSecret = process.env.DODO_WEBHOOK_SECRET ?? "";

export const DODO_API_BASE = liveMode
  ? "https://live.dodopayments.com"
  : "https://test.dodopayments.com";

export const publicBase = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";

export const dodoConfigured = () => Boolean(apiKey && productId && webhookSecret);

/**
 * Create a Dodo hosted Checkout Session for a variable bid amount.
 * Requires one Pay-What-You-Want product (set DODO_PRODUCT_ID). The `amount`
 * field is the price in the lowest currency denomination (cents for USD).
 */
export async function createCheckoutSession(input: {
  spotId: string;
  amountCents: number;
}): Promise<{ session_id: string; checkout_url: string }> {
  console.log("Creating Dodo checkout session:", input);
  const res = await fetch(`${DODO_API_BASE}/checkouts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      product_cart: [
        { product_id: productId, quantity: 1, amount: Math.round(input.amountCents) },
      ],
      metadata: { spotId: input.spotId },
      return_url: `${publicBase}/?checkout=success`,
      cancel_url: `${publicBase}/?checkout=cancelled`,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    session_id?: string;
    checkout_url?: string;
    error?: string;
  };
  console.log("Dodo checkout response:", body);
  if (!res.ok || !body.session_id) {
    throw new Error(`Dodo create-session failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return { session_id: body.session_id, checkout_url: body.checkout_url ?? "" };
}

export async function getCheckoutSession(sessionId: string): Promise<{
  status?: string;
  payment_status?: string;
  amount?: number;
  currency?: string;
} | null> {
  try {
    const res = await fetch(`${DODO_API_BASE}/checkouts/${sessionId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
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

/**
 * Standard Webhooks signature verification (see docs.dodopayments.com/developer-resources/webhooks).
 * Signature = HMAC-SHA256 of `${webhook-id}.${webhook-timestamp}.${rawPayload}` using the
 * webhook signing secret; header value is expected as `v1,<base64>`.
 */
export function verifyWebhook(
  rawBody: string,
  headers: { "webhook-id"?: string; "webhook-timestamp"?: string; "webhook-signature"?: string },
): boolean {
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
  const expectedBase64 = createHmac("sha256", webhookSecret).update(message).digest("base64");
  const expectedHex = createHmac("sha256", webhookSecret).update(message).digest("hex");
  const a = Buffer.from(received);
  const match = (expected: string) =>
    a.length === expected.length && timingSafeEqual(a, Buffer.from(expected));
  return match(expectedBase64) || match(expectedHex);
}