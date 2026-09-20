import type { Env, RequestContext } from "../lib/env";
import { createCheckoutSession, dodoConfigured, dodoErrorMessage } from "../lib/dodo";
import { store } from "../lib/store";

// Live product set a minimum charge (Dodo REQUEST_AMOUNT_BELOW_MINIMUM below this).
const productMin = (env: Env): number =>
  Math.max(0, Number(env.DODO_PRODUCT_MIN ?? 500) || 500);

const mimeExt: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
};

const validateLogoDataUrl = (dataUrl: string): string | null => {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const mime = (match[1] ?? "").toLowerCase();
  if (!mimeExt[mime]) return null;
  let size = 0;
  try {
    size = atob(match[2] ?? "").length;
  } catch {
    return null;
  }
  if (size === 0 || size > 3_000_000) return null;
  return dataUrl;
};

// Simple in-memory rate limit: 10 checkout creations per minute per IP.
const checkoutHits = new Map<string, number[]>();
const checkoutLimited = (key: string): boolean => {
  const now = Date.now();
  const recent = (checkoutHits.get(key) ?? []).filter(t => now - t < 60_000);
  if (recent.length >= 10) {
    checkoutHits.set(key, recent);
    return true;
  }
  recent.push(now);
  checkoutHits.set(key, recent);
  return false;
};

const clientKey = (request: Request) =>
  (request.headers.get("cf-connecting-ip")?.trim() || "unknown").toLowerCase();

export const onRequestPost = async ({ request, env }: RequestContext) => {
  if (checkoutLimited(clientKey(request))) {
    return Response.json(
      { error: "Too many checkout attempts. Try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }
  if (!dodoConfigured(env)) {
    return Response.json(
      { error: "Dodo Payments is not configured yet — add your keys." },
      { status: 503 },
    );
  }
  const body = (await request.json().catch(() => ({}))) as {
    spotId?: string;
    amount?: number;
    company?: string;
    website?: string;
    logoDataUrl?: string;
  };
  const spotId = body.spotId ?? "";
  const amount = Math.floor(body.amount ?? 0);
  const company = body.company?.trim() || undefined;
  const website = /^https?:\/\//i.test(body.website ?? "") ? (body.website as string) : undefined;

  const currentBid = await store.getSpotBid(env, spotId);
  if (currentBid === undefined) {
    return Response.json({ error: "Unknown spot." }, { status: 400 });
  }
  const minBid = Math.max(currentBid + 50, productMin(env));
  if (amount < minBid) {
    return Response.json(
      { error: `Amount must be at least ${minBid} (current bid ${currentBid} + 50).` },
      { status: 400 },
    );
  }

  const logoData = body.logoDataUrl ? validateLogoDataUrl(body.logoDataUrl) : null;
  if (body.logoDataUrl && !logoData) {
    return Response.json(
      { error: "Logo must be a PNG, JPG, WEBP, GIF, or SVG data URL under 3 MB." },
      { status: 400 },
    );
  }

  const orderId = await store.createOrder(env, {
    spotId,
    amountCents: amount * 100,
    company,
    website,
  });
  if (logoData) await store.attachLogoData(env, orderId, logoData);

  try {
    const session = await createCheckoutSession(env, { spotId, amountCents: amount * 100 });
    await store.attachSession(env, orderId, session.session_id);
    return Response.json({ checkout_url: session.checkout_url, session_id: session.session_id });
  } catch (error) {
    await store.markOrderFailed(env, orderId);
    return Response.json({ error: dodoErrorMessage(error) }, { status: 502 });
  }
};