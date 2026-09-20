import type { Env, RequestContext } from "../lib/env";
import { store } from "../lib/store";

export const onRequestGet = async ({ env }: RequestContext) => {
  try {
    return Response.json(await store.getSpots(env));
  } catch (error) {
    console.error("GET /api/spots failed:", error);
    return Response.json({ error: "Failed to load spots." }, { status: 500 });
  }
};