// The billboard images are bundled static assets; the client uses this to
// bust its image cache after redeploys. A fixed version + no-cache works.
export const onRequestGet = async () =>
  Response.json(
    { front: 1, back: 1 },
    { headers: { "Cache-Control": "no-cache" } },
  );