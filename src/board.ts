import { COLS, COOLDOWN_KEY, DEFAULT_COOLDOWN, PALETTE, PAUSED_KEY, PIXEL_PREFIX, ROWS, UNKNOWN_HEX } from "./config";

export type Cells = (string | null)[];

export interface Snapshot {
  cells: Cells;
  paused: boolean;
  cooldown: number;
  keys: number;
}

export function emptyCells(): Cells {
  return new Array<string | null>(COLS * ROWS).fill(null);
}

export function pixelKey(x: number, y: number): string {
  return `${PIXEL_PREFIX}${x}-${y}`;
}

export function keyAt(index: number): string {
  return pixelKey(index % COLS, Math.floor(index / COLS));
}

export function coords(index: number): { x: number; y: number } {
  return { x: index % COLS, y: Math.floor(index / COLS) };
}

export function parseKey(key: string): number | null {
  if (!key.startsWith(PIXEL_PREFIX)) return null;
  const match = /^(\d+)-(\d+)$/.exec(key.slice(PIXEL_PREFIX.length));
  if (!match) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (x >= COLS || y >= ROWS) return null;
  return y * COLS + x;
}

export function asRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return data as Record<string, unknown>;
}

/** Turn the raw GET body into the board plus the teacher settings. */
export function snapshotFrom(data: unknown): Snapshot | null {
  const record = asRecord(data);
  if (!record) return null;
  const cells = emptyCells();
  for (const [key, value] of Object.entries(record)) {
    const index = parseKey(key);
    if (index === null) continue;
    if (typeof value === "string" && value.trim() !== "") cells[index] = value.trim().toLowerCase().slice(0, 20);
    else if (value !== null && value !== undefined && value !== "") cells[index] = "?";
  }
  const rawCooldown = record[COOLDOWN_KEY];
  const cooldown = typeof rawCooldown === "number" && Number.isFinite(rawCooldown) && rawCooldown >= 0 ? Math.min(60, rawCooldown) : DEFAULT_COOLDOWN;
  return { cells, paused: record[PAUSED_KEY] === true, cooldown, keys: Object.keys(record).length };
}

export function colorHex(name: string | null): string | null {
  if (name === null) return null;
  const swatch = PALETTE.find((entry) => entry.name === name);
  return swatch ? swatch.hex : UNKNOWN_HEX;
}

export function filledCount(cells: Cells): number {
  let count = 0;
  for (const cell of cells) if (cell !== null) count += 1;
  return count;
}

export function filledKeys(cells: Cells): string[] {
  const keys: string[] = [];
  cells.forEach((cell, index) => {
    if (cell !== null) keys.push(keyAt(index));
  });
  return keys;
}

/** Keys inside the rectangle between two cell indexes, in either drag direction. */
export function rectangleIndexes(from: number, to: number): number[] {
  const a = coords(from);
  const b = coords(to);
  const left = Math.min(a.x, b.x);
  const right = Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const bottom = Math.max(a.y, b.y);
  const out: number[] = [];
  for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) out.push(y * COLS + x);
  return out;
}

export type Verb = "POST" | "PATCH" | "DELETE";

export interface VerbCheck {
  ok: boolean;
  why: string;
}

/** The classroom rules: POST only fills empty pixels, PATCH and DELETE only touch filled ones. */
export function checkVerb(verb: Verb, current: string | null, color: string): VerbCheck {
  if (verb === "POST") {
    if (current !== null) return { ok: false, why: "That pixel is already filled. DELETE it first, then POST." };
    return { ok: true, why: "" };
  }
  if (current === null) {
    return { ok: false, why: `That pixel is empty. ${verb === "PATCH" ? "POST a color first, then PATCH it." : "There is nothing to DELETE."}` };
  }
  if (verb === "PATCH" && current === color) return { ok: false, why: `It is already ${color}. Pick a different color to PATCH.` };
  return { ok: true, why: "" };
}

export function statusHint(status: number, text: string): string {
  if (status === 200) return "200 OK";
  if (status === 201) return "201 Created";
  if (status === 400 && /previous value/i.test(text)) return "400 Changed by someone else since your last GET";
  if (status === 400) return "400 The window could not read that";
  if (status === 403) return "403 The store said stop for a moment";
  if (status === 404) return "404 That address is not there";
  if (status === 429) return "429 Too many requests";
  if (status === 0) return "No reply (network)";
  return `${status}`;
}

export function maskSecret(value: string, secret: string): string {
  return value.split(secret).join("••••");
}

export function showResponse(json: unknown, text: string): string {
  if (json !== null) {
    const pretty = JSON.stringify(json, null, 2);
    return pretty.length > 700 ? `${pretty.slice(0, 700)}\n…` : pretty;
  }
  const clean = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return clean.slice(0, 300) || "(empty)";
}

/** Keep polling at the base rate; back off only if the store starts refusing. */
export function nextPollDelay(current: number, ok: boolean, base: number, max: number): number {
  if (ok) return base;
  return Math.min(max, Math.max(base, current) * 2);
}
