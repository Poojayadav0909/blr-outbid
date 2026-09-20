import { serve } from "bun";
import { mkdirSync, rmSync, statSync } from "node:fs";
import index from "./index.html";
import { cloudinaryConfigured, uploadLogo } from "./lib/cloudinary";
import {
  createCheckoutSession,
  dodoConfigured,
  getCheckoutSession,
  isSessionPaid,
  verifyWebhook,
} from "./lib/dodo";
import { store } from "./lib/store";

const uploadsDir = "var/uploads";
mkdirSync(uploadsDir, { recursive: true });

const settledUntil = new Set<number>();
const settleLogoIfAny = async (orderId: number, spotId: string) => {
  if (settledUntil.has(orderId) || (await store.getOrderLogoUrl(orderId))) return;
  const fileData = await store.getLogoFile(orderId);
  if (!fileData) return;
  try {
    const bytes = new Uint8Array(await Bun.file(fileData.path).arrayBuffer());
    const { url, publicId } = await uploadLogo(
      bytes,
      `spot-logos/spot_${spotId}_order_${orderId}`,
      fileData.mimeType,
    );
    await store.updateOrderLogo(orderId, url, publicId);
    rmSync(fileData.path, { force: true });
    console.log("Logo uploaded successfully to Cloudinary:", url);
  } catch (error) {
    settledUntil.add(orderId);
    console.error(`Logo upload for order ${orderId} deferred:`, error);
  }
};

const mimeExt: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
};
const parseImageData = (dataUrl: string): { bytes: Uint8Array; ext: string; mime: string } => {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Logo must be a base64 data URL.");
  const mime = (match[1] ?? "").toLowerCase();
  const ext = mimeExt[mime];
  if (!ext) throw new Error("Logo must be PNG, JPG, WEBP, GIF, or SVG.");
  const bytes = new Uint8Array(Buffer.from(match[2] ?? "", "base64"));
  if (bytes.length === 0 || bytes.length > 3_000_000) {
    throw new Error("Logo must be between 1 byte and 3 MB.");
  }
  return { bytes, ext, mime };
};

const clientKey = (req: Request) =>
  (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local").toLowerCase();

// Simple in-memory rate limit: 10 checkout creations per minute per IP.
const checkoutHits = new Map<string, number[]>();
const checkoutLimited = (key: string) => {
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

const imageAsset = (path: string) => {
  const lastModified = statSync(path).mtime.toUTCString();
  return new Response(Bun.file(path), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-cache",
      "Last-Modified": lastModified,
      ETag: `"${statSync(path).mtimeMs}"`,
    },
  });
};

const productMin = Math.max(0, Number(process.env.DODO_PRODUCT_MIN ?? 500) || 500);

const server = serve({
  routes: {
    // Keep the Bun dev asset namespace available for bundled images, CSS, and HMR.
    // A catch-all route here would return index.html for image requests.
    "/": index,
    "/outbid-front-image.png": () => imageAsset("public/outbid-front-image.png"),
    "/outbid-back-image.png": () => imageAsset("public/outbid-back-image.png"),
    "/api/assets/version": () =>
      Response.json({
        front: statSync("public/outbid-front-image.png").mtimeMs,
        back: statSync("public/outbid-back-image.png").mtimeMs,
      }),

    "/api/spots": async () => Response.json(await store.getSpots()),

    "/api/checkout": {
      async POST(req) {
        if (checkoutLimited(clientKey(req))) {
          return Response.json(
            { error: "Too many checkout attempts. Try again in a minute." },
            { status: 429, headers: { "Retry-After": "60" } },
          );
        }
        if (!dodoConfigured()) {
          return Response.json(
            { error: "Dodo Payments is not configured yet — add your keys to .env." },
            { status: 503 },
          );
        }
        const body = (await req.json().catch(() => ({}))) as {
          spotId?: string;
          amount?: number;
          company?: string;
          website?: string;
          logoDataUrl?: string;
        };
        console.log("Checkout request body:", body);
        const spotId = body.spotId ?? "";
        const amount = Math.floor(body.amount ?? 0);
        const company = body.company?.trim() || undefined;
        const website = /^https?:\/\//i.test(body.website ?? "") ? (body.website as string) : undefined;
        const currentBid = await store.getSpotBid(spotId);
        if (currentBid === undefined) {
          return Response.json({ error: "Unknown spot." }, { status: 400 });
        }
        const minBid = Math.max(currentBid + 50, productMin);
        if (amount < minBid) {
          return Response.json(
            { error: `Amount must be at least ${minBid} (current bid ${currentBid} + 50).` },
            { status: 400 },
          );
        }
        const logoFile = body.logoDataUrl ? parseImageData(body.logoDataUrl) : null;
        const orderId = await store.createOrder({
          spotId,
          amountCents: amount * 100,
          company,
          website,
        });
        console.log("Order created with ID:", orderId, "company:", company, "website:", website);
        let logoPath: string | null = null;
        if (logoFile) {
          logoPath = `${uploadsDir}/order-${orderId}${logoFile.ext}`;
          await Bun.write(logoPath, logoFile.bytes);
          await store.attachLogoFile(orderId, logoPath, logoFile.mime);
          console.log("Logo file attached:", logoPath, "mime:", logoFile.mime);
        }
        try {
          const session = await createCheckoutSession({ spotId, amountCents: amount * 100 });
          await store.attachSession(orderId, session.session_id);
          console.log("Checkout session created:", session.session_id);
          return Response.json({ checkout_url: session.checkout_url, session_id: session.session_id });
        } catch (error) {
          await store.markOrderFailed(orderId);
          if (logoPath) rmSync(logoPath, { force: true });
          return Response.json(
            { error: error instanceof Error ? error.message : "Failed to start checkout." },
            { status: 502 },
          );
        }
      },
    },

    "/api/checkout/:id": {
      async GET(req) {
        const sessionId = req.params.id ?? "";
        const order = sessionId ? await store.findOrderBySession(sessionId) : null;
        if (!order) {
          return Response.json({ error: "Unknown checkout session." }, { status: 404 });
        }
        if (order.status !== "paid" && dodoConfigured()) {
          const session = await getCheckoutSession(sessionId);
          if (session && isSessionPaid(session)) {
            await store.markOrderPaid(order.id, `poll:${sessionId}`);
            await store.bumpBid(order.spotId, order.amountCents / 100);
            order.status = "paid";
            await settleLogoIfAny(order.id, order.spotId);
          }
        }
        return Response.json({
          order_id: order.id,
          spot_id: order.spotId,
          amount_cents: order.amountCents,
          status: order.status,
        });
      },
    },

    "/api/webhook/dodo": {
      async POST(req) {
        const rawBody = await req.text();
        console.log("Webhook received:", rawBody);
        const header = (name: string) => req.headers.get(name) ?? "";
        const ok = verifyWebhook(rawBody, {
          "webhook-id": header("webhook-id"),
          "webhook-timestamp": header("webhook-timestamp"),
          "webhook-signature": header("webhook-signature"),
        });
        if (!ok) return Response.json({ error: "Invalid signature" }, { status: 401 });

        const webhookId = header("webhook-id");
        if (await store.isWebhookSeen(webhookId)) {
          console.log("Webhook already processed:", webhookId);
          return Response.json({ received: true, duplicate: true });
        }

        let payload: { type?: string; data?: Record<string, any> };
        try {
          payload = JSON.parse(rawBody);
        } catch {
          return Response.json({ error: "Invalid payload" }, { status: 400 });
        }

        const type = payload.type ?? "";
        const data = payload.data ?? {};
        console.log("Webhook payload:", { type, data });
        const paid = [
          type,
          data?.status,
          data?.payment_status,
        ].some(value => typeof value === "string" && /(succeeded|completed|paid)/i.test(value));

        if (paid) {
          console.log("Payment succeeded, processing order");
          const sessionId =
            data?.checkout_session_id ?? data?.session_id ?? data?.id ?? data?.payment_id ?? "";
          const spotId = (data?.metadata as Record<string, any> | undefined)?.spotId;
          console.log("Looking for order with session:", sessionId, "spotId:", spotId);
          
          const order = sessionId ? await store.findOrderBySession(String(sessionId)) : null;
          console.log("Found order:", order);
          
          if (order) {
            console.log("Processing paid order:", order.id, "for spot:", order.spotId);
            await store.markOrderPaid(order.id, webhookId);
            await store.bumpBid(order.spotId, order.amountCents / 100);
            await settleLogoIfAny(order.id, order.spotId);
            console.log("Order processed successfully");
          } else if (spotId) {
            console.log("No order found, bumping bid for spot:", spotId);
            await store.bumpBid(String(spotId), (data?.settlement_amount ?? 0) / 100);
          }
        }

        await store.markWebhook(webhookId, type);
        console.log("Webhook marked as processed:", webhookId);
        return Response.json({ received: true }, { status: 200 });
      },
    },

    "/api/hello": {
      async GET(req) {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async req => {
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);

