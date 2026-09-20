import type { Env, RequestContext } from "../../lib/env";
import { verifyWebhook } from "../../lib/dodo";
import { settleLogoIfAny } from "../../lib/logo";
import { store } from "../../lib/store";

export const onRequestPost = async ({ request, env }: RequestContext) => {
  const rawBody = await request.text();
  const header = (name: string) => request.headers.get(name) ?? "";
  const ok = await verifyWebhook(
    rawBody,
    {
      "webhook-id": header("webhook-id"),
      "webhook-timestamp": header("webhook-timestamp"),
      "webhook-signature": header("webhook-signature"),
    },
    env.DODO_WEBHOOK_SECRET ?? "",
  );
  if (!ok) return Response.json({ error: "Invalid signature" }, { status: 401 });

  const webhookId = header("webhook-id");
  if (await store.isWebhookSeen(env, webhookId)) {
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
  const paid = [type, data?.status, data?.payment_status].some(
    value => typeof value === "string" && /(succeeded|completed|paid)/i.test(value),
  );

  if (paid) {
    const sessionId =
      data?.checkout_session_id ?? data?.session_id ?? data?.id ?? data?.payment_id ?? "";
    const spotId = (data?.metadata as Record<string, any> | undefined)?.spotId;
    const order = sessionId ? await store.findOrderBySession(env, String(sessionId)) : null;
    
    if (order) {
      await store.markOrderPaid(env, order.id, webhookId);
      await store.bumpBid(env, order.spotId, order.amountCents / 100);
      await settleLogoIfAny(order.id, order.spotId, env);
      console.log("Order processed:", order.id);
    } else if (spotId) {
      await store.bumpBid(env, String(spotId), (data?.settlement_amount ?? 0) / 100);
    }
  }

  await store.markWebhook(env, webhookId, type);
  return Response.json({ received: true }, { status: 200 });
};