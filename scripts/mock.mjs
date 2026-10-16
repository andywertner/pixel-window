// Installed with page.evaluateOnNewDocument. Mirrors the store.zapier.com behavior
// observed on 2026-10-15 so audits never touch the real locker.
export function installMock(seed) {
  const store = Object.assign({}, seed);
  const requests = [];
  window.__store = store;
  window.__requests = requests;
  const json = (status, value) =>
    new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  window.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = (init && init.method) || "GET";
    const body = init && init.body ? JSON.parse(init.body) : null;
    requests.push({ method, url: url.toString(), body });
    if (window.__fail) return new Response("Forbidden", { status: 403 });
    await new Promise((r) => setTimeout(r, 20));
    if (method === "GET") {
      const keys = url.searchParams.getAll("key");
      if (!keys.length) return json(200, store);
      const out = {};
      for (const key of keys) if (key in store) out[key] = store[key];
      return json(200, out);
    }
    if (method === "POST") {
      if (!body || typeof body !== "object") return json(400, { error: "Expected JSON object in body." });
      Object.assign(store, body);
      return json(201, body);
    }
    if (method === "DELETE") {
      const key = url.searchParams.get("key");
      if (key) delete store[key];
      else for (const k of Object.keys(store)) delete store[k];
      return json(200, {});
    }
    if (method === "PATCH") {
      if (body.action === "set_value_if") {
        const { key, value, previous_value } = body.data;
        if (store[key] !== previous_value) return json(400, { error: "Stored value does not match previous value." });
        store[key] = value;
        return json(200, value);
      }
      if (body.action === "delete") {
        for (const key of body.data) delete store[key];
        return json(200, "");
      }
      return json(400, { error: "unknown action" });
    }
    return json(405, {});
  };
}

export function seedBoard(fill = 0.45) {
  const colors = ["red", "orange", "yellow", "lime", "green", "teal", "cyan", "blue", "navy", "purple", "pink", "magenta", "white", "black", "gray", "brown"];
  const seed = {};
  let n = 0;
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 30; x += 1) {
      n += 1;
      if ((n * 7919) % 100 < fill * 100) seed[`px-${x}-${y}`] = colors[(x * 3 + y * 5) % colors.length];
    }
  }
  return seed;
}
