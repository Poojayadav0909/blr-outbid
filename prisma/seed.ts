import { prisma } from "../src/lib/db";
import { backPlacements, frontPlacements } from "../src/data/placements";

for (const spot of [...frontPlacements, ...backPlacements]) {
  await prisma.spot.upsert({
    where: { id: spot.id },
    create: { id: spot.id, currentBid: spot.currentBid },
    update: {},
  });
}

const existingPaid = await prisma.order.findFirst({
  where: { spotId: "front-chest", status: "paid" },
});
if (!existingPaid) {
  await prisma.order.create({
    data: {
      spotId: "front-chest",
      amountCents: 120000,
      currency: "USD",
      status: "paid",
      webhookId: "demo",
      company: "ACME",
      website: "https://example.com",
      logoUrl: "https://res.cloudinary.com/kuajp0qg/raw/upload/v1789906224/spot-logos/demo_acme",
      logoPublicId: "spot-logos/demo_acme",
      createdAt: BigInt(Date.now()),
    },
  });
}

const spotCount = await prisma.spot.count();
const paidCount = await prisma.order.count({ where: { status: "paid" } });
console.log(`Seeded ${spotCount} spots, ${paidCount} paid order(s).`);
await prisma.$disconnect();