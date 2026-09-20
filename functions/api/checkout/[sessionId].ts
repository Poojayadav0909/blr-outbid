import type { Env, RequestContext } from "../../lib/env";
import { dodoConfigured, getCheckoutSession, isSessionPaid } from "../../lib/dodo";
import { settleLogoIfAny } from "../../lib/logo";
import { store } from "../../lib/store";

export const onRequestGet = async ({ params, env }: RequestContext) => {
  const sessionId = params.sessionId ?? "";
  const order = sessionId ? await store.findOrderBySession(env, sessionId) : null;
  if (!order) {
    return Response.json({ error: "Unknown checkout session." }, { status: 404 });
  }
  if (order.status !== "paid" && dodoConfigured(env)) {
    const session = await getCheckoutSession(env, sessionId);
    if (session && isSessionPaid(session)) {
      await store.markOrderPaid(env, order.id, `poll:${sessionId}`);
      await store.bumpBid(env, order.spotId, order.amountCents / 100);
      order.status = "paid";
      await settleLogoIfAny(order.id, order.spotId, env);
    }
  }
  return Response.json({
    order_id: order.id,
    spot_id: order.spotId,
    amount_cents: order.amountCents,
    status: order.status,
  });
};