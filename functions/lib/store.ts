import postgres from "postgres";
import type { Sql } from "postgres";
import { backPlacements, frontPlacements } from "../../src/data/placements";
import type { Env } from "./env";

const spotOrder = new Map(
  [...frontPlacements, ...backPlacements].map((spot, index) => [spot.id, index]),
);

const connect = (env: Env): Sql =>
  postgres(env.HYPERDRIVE.connectionString as string, {
    max: 5,
    fetch_types: false,
    prepare: true,
  });

export type SpotRow = {
  id: string;
  currentBid: number;
  logoUrl?: string;
  company?: string;
  website?: string;
  sold: boolean;
};

type PaidOrder = {
  id: number;
  spotId: string;
  amountCents: number;
  company: string | null;
  website: string | null;
  logoUrl: string | null;
  status: string;
};

export const store = {
  async getSpots(env: Env): Promise<SpotRow[]> {
    const sql = connect(env);
    try {
      const [spots, paid] = await Promise.all([
        sql`SELECT id, "currentBid" FROM spots`,
        sql`SELECT id, "spotId", "amountCents", company, website, "logoUrl", status FROM orders WHERE status = 'paid' ORDER BY id DESC`,
      ]);
      const latestPaid = new Map<string, PaidOrder>();
      for (const order of paid as unknown as PaidOrder[]) {
        if (!latestPaid.has(order.spotId)) latestPaid.set(order.spotId, order);
      }
      (spots as unknown as { id: string }[]).sort(
        (a, b) => (spotOrder.get(a.id) ?? 999) - (spotOrder.get(b.id) ?? 999),
      );
      return (spots as unknown as { id: string; currentBid: number }[]).map(spot => {
        const order = latestPaid.get(spot.id);
        return {
          id: spot.id,
          currentBid: spot.currentBid,
          logoUrl: order?.logoUrl ?? undefined,
          company: order?.company ?? undefined,
          website: order?.website ?? undefined,
          sold: Boolean(order),
        };
      });
    } finally {
      await sql.end();
    }
  },

  async getSpotBid(env: Env, spotId: string): Promise<number | undefined> {
    const sql = connect(env);
    try {
      const rows = await sql`SELECT "currentBid" FROM spots WHERE id = ${spotId} LIMIT 1`;
      const row = rows[0] as { currentBid: number } | undefined;
      return row?.currentBid;
    } finally {
      await sql.end();
    }
  },

  /** Raise the listed bid only if the new price is higher. */
  async bumpBid(env: Env, spotId: string, newBidUsd: number) {
    const next = Math.round(newBidUsd);
    const sql = connect(env);
    try {
      await sql`
        INSERT INTO spots (id, "currentBid")
        VALUES (${spotId}, ${next})
        ON CONFLICT (id) DO UPDATE
          SET "currentBid" = GREATEST(spots."currentBid", EXCLUDED."currentBid")
      `;
    } finally {
      await sql.end();
    }
  },

  async createOrder(
    env: Env,
    input: { spotId: string; amountCents: number; company?: string; website?: string },
  ): Promise<number> {
    const sql = connect(env);
    try {
      const rows = await sql`
        INSERT INTO orders ("spotId", "amountCents", company, website, currency, status, "createdAt")
        VALUES (${input.spotId}, ${input.amountCents}, ${input.company ?? null}, ${input.website ?? null}, 'USD', 'pending', ${String(Date.now())})
        RETURNING id
      `;
      return Number((rows[0] as { id: number }).id);
    } finally {
      await sql.end();
    }
  },

  async attachSession(env: Env, orderId: number, sessionId: string) {
    const sql = connect(env);
    try {
      await sql`
        UPDATE orders SET "dodoSessionId" = ${sessionId}, status = 'pending' WHERE id = ${orderId}
      `;
    } finally {
      await sql.end();
    }
  },

  async attachLogoData(env: Env, orderId: number, dataUrl: string) {
    const sql = connect(env);
    try {
      await sql`UPDATE orders SET "logoFile" = ${dataUrl} WHERE id = ${orderId}`;
    } finally {
      await sql.end();
    }
  },

  async getLogoData(env: Env, orderId: number): Promise<string | null> {
    const sql = connect(env);
    try {
      const rows = await sql`SELECT "logoFile" FROM orders WHERE id = ${orderId} LIMIT 1`;
      return ((rows[0] as { logoFile: string | null } | undefined)?.logoFile) ?? null;
    } finally {
      await sql.end();
    }
  },

  async getOrderLogoUrl(env: Env, orderId: number): Promise<string | null> {
    const sql = connect(env);
    try {
      const rows = await sql`SELECT "logoUrl" FROM orders WHERE id = ${orderId} LIMIT 1`;
      return ((rows[0] as { logoUrl: string | null } | undefined)?.logoUrl) ?? null;
    } finally {
      await sql.end();
    }
  },

  async updateOrderLogo(env: Env, orderId: number, url: string, publicId: string) {
    const sql = connect(env);
    try {
      await sql`
        UPDATE orders SET "logoUrl" = ${url}, "logoPublicId" = ${publicId}, "logoFile" = NULL
        WHERE id = ${orderId}
      `;
    } finally {
      await sql.end();
    }
  },

  async findOrderBySession(env: Env, sessionId: string) {
    const sql = connect(env);
    try {
      const rows = await sql`
        SELECT id, "spotId", "amountCents", status FROM orders WHERE "dodoSessionId" = ${sessionId} LIMIT 1
      `;
      const row = rows[0] as
        | { id: number; spotId: string; amountCents: number; status: string }
        | undefined;
      if (!row) return null;
      return { id: row.id, spotId: row.spotId, amountCents: row.amountCents, status: row.status };
    } finally {
      await sql.end();
    }
  },

  async markOrderPaid(env: Env, orderId: number, webhookId: string) {
    const sql = connect(env);
    try {
      await sql`
        UPDATE orders SET status = 'paid', "webhookId" = ${webhookId}
        WHERE id = ${orderId} AND status <> 'paid'
      `;
    } finally {
      await sql.end();
    }
  },

  async markOrderFailed(env: Env, orderId: number) {
    const sql = connect(env);
    try {
      await sql`
        UPDATE orders SET status = 'failed' WHERE id = ${orderId} AND status = 'pending'
      `;
    } finally {
      await sql.end();
    }
  },

  async isWebhookSeen(env: Env, webhookId: string): Promise<boolean> {
    const sql = connect(env);
    try {
      const rows = await sql`SELECT id FROM webhook_events WHERE id = ${webhookId} LIMIT 1`;
      return rows.length > 0;
    } finally {
      await sql.end();
    }
  },

  async markWebhook(env: Env, webhookId: string, type: string) {
    const sql = connect(env);
    try {
      await sql`
        INSERT INTO webhook_events (id, type, "processedAt")
        VALUES (${webhookId}, ${type ?? null}, ${String(Date.now())})
        ON CONFLICT (id) DO NOTHING
      `;
    } finally {
      await sql.end();
    }
  },
};