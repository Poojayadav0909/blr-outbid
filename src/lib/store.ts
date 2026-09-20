import { prisma } from "./db";
import { backPlacements, frontPlacements } from "../data/placements";

const spotOrder = new Map(
  [...frontPlacements, ...backPlacements].map((spot, index) => [spot.id, index]),
);

export type SpotRow = {
  id: string;
  currentBid: number;
  logoUrl?: string;
  company?: string;
  website?: string;
  sold: boolean;
};

export const store = {
  async getSpots(): Promise<SpotRow[]> {
    const [spots, paid] = await Promise.all([
      prisma.spot.findMany(),
      prisma.order.findMany({
        where: { status: "paid" },
        orderBy: { id: "desc" },
      }),
    ]);
    const latestPaid = new Map<string, (typeof paid)[number]>();
    for (const order of paid) if (!latestPaid.has(order.spotId)) latestPaid.set(order.spotId, order);
    spots.sort((a, b) => (spotOrder.get(a.id) ?? 999) - (spotOrder.get(b.id) ?? 999));
    return spots.map(spot => {
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
  },

  async getSpotBid(spotId: string): Promise<number | undefined> {
    return (await prisma.spot.findUnique({ where: { id: spotId }, select: { currentBid: true } }))
      ?.currentBid;
  },

  /** Raise the listed bid only if the new price is higher. */
  async bumpBid(spotId: string, newBidUsd: number) {
    const next = Math.round(newBidUsd);
    const spot = await prisma.spot.findUnique({ where: { id: spotId } });
    if (!spot) {
      await prisma.spot.create({ data: { id: spotId, currentBid: next } });
    } else if (next > spot.currentBid) {
      await prisma.spot.update({ where: { id: spotId }, data: { currentBid: next } });
    }
  },

  async createOrder(input: {
    spotId: string;
    amountCents: number;
    company?: string;
    website?: string;
  }): Promise<number> {
    console.log("Creating order with data:", input);
    const created = await prisma.order.create({
      data: {
        spotId: input.spotId,
        amountCents: input.amountCents,
        company: input.company ?? null,
        website: input.website ?? null,
        currency: "USD",
        status: "pending",
        createdAt: BigInt(Date.now()),
      },
    });
    console.log("Order created:", created);
    return Number(created.id);
  },

  async attachSession(orderId: number, sessionId: string) {
    await prisma.order.updateMany({
      where: { id: orderId },
      data: { dodoSessionId: sessionId, status: "pending" },
    });
  },

  async attachLogoFile(orderId: number, path: string, mimeType?: string) {
    await prisma.order.updateMany({ where: { id: orderId }, data: { logoFile: path, logoMimeType: mimeType || null, logoUrl: null } });
  },

  async getLogoFile(orderId: number): Promise<{ path: string; mimeType: string } | null> {
    const order = await prisma.order.findUnique({ 
      where: { id: orderId }, 
      select: { logoFile: true, logoMimeType: true } 
    });
    if (!order?.logoFile) return null;
    return { path: order.logoFile, mimeType: order.logoMimeType || "image/png" };
  },

  async getOrderLogoUrl(orderId: number): Promise<string | null> {
    return (
      (await prisma.order.findUnique({ where: { id: orderId }, select: { logoUrl: true } }))
        ?.logoUrl ?? null
    );
  },

  async updateOrderLogo(orderId: number, url: string, publicId: string) {
    await prisma.order.updateMany({
      where: { id: orderId },
      data: { logoUrl: url, logoPublicId: publicId },
    });
  },

  async findOrderBySession(sessionId: string) {
    const order = await prisma.order.findFirst({ where: { dodoSessionId: sessionId } });
    if (!order) return null;
    return { id: order.id, spotId: order.spotId, amountCents: order.amountCents, status: order.status };
  },

  async markOrderPaid(orderId: number, webhookId: string) {
    console.log("Marking order as paid:", orderId, webhookId);
    await prisma.order.updateMany({
      where: { id: orderId, NOT: { status: "paid" } },
      data: { status: "paid", webhookId },
    });
  },

  async markOrderFailed(orderId: number) {
    await prisma.order.updateMany({
      where: { id: orderId, status: "pending" },
      data: { status: "failed" },
    });
  },

  async isWebhookSeen(webhookId: string): Promise<boolean> {
    return Boolean(await prisma.webhookEvent.findUnique({ where: { id: webhookId } }));
  },

  async markWebhook(webhookId: string, type: string) {
    await prisma.webhookEvent.upsert({
      where: { id: webhookId },
      create: { id: webhookId, type, processedAt: BigInt(Date.now()) },
      update: {},
    });
  },
};