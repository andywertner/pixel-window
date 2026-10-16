import { COOLDOWN_KEY, PAUSED_KEY, RECORDS_PATH, STORE_ORIGIN, STORE_SECRET } from "./config";
import { maskSecret, showResponse } from "./board";

export type Method = "GET" | "POST" | "PATCH" | "DELETE";

export interface Exchange {
  method: Method;
  url: string;
  body: string | null;
  status: number;
  statusText: string;
  response: string;
  responseText: string;
  ms: number;
  at: number;
}

export interface CallResult {
  status: number;
  json: unknown;
  text: string;
  exchange: Exchange;
}

interface CallOpts {
  method: Method;
  query?: Record<string, string>;
  body?: unknown;
}

export async function call(opts: CallOpts): Promise<CallResult> {
  const params = new URLSearchParams();
  params.set("secret", STORE_SECRET);
  for (const [key, value] of Object.entries(opts.query ?? {})) params.set(key, value);
  const real = `${STORE_ORIGIN}${RECORDS_PATH}?${params.toString()}`;
  const raw = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  const started = Date.now();
  let status = 0;
  let statusText = "";
  let text = "";
  try {
    const response = await fetch(real, {
      method: opts.method,
      cache: "no-store",
      headers: raw !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: raw,
    });
    status = response.status;
    statusText = response.statusText;
    text = await response.text();
  } catch (error) {
    text = error instanceof Error ? error.message : String(error);
  }
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return {
    status,
    json,
    text,
    exchange: {
      method: opts.method,
      url: maskSecret(real, STORE_SECRET),
      body: raw === undefined ? null : JSON.stringify(opts.body, null, 2),
      status,
      statusText,
      response: showResponse(json, text),
      responseText: text,
      ms: Date.now() - started,
      at: Date.now(),
    },
  };
}

export function getBoard(): Promise<CallResult> {
  return call({ method: "GET" });
}

export function postPixel(key: string, color: string): Promise<CallResult> {
  return call({ method: "POST", body: { [key]: color } });
}

export function patchPixel(key: string, color: string, previous: string): Promise<CallResult> {
  return call({ method: "PATCH", body: { action: "set_value_if", data: { key, value: color, previous_value: previous } } });
}

export function deletePixel(key: string): Promise<CallResult> {
  return call({ method: "DELETE", query: { key } });
}

/** Teacher tools. One request each, so the board changes for everyone on their next GET. */
export function deleteKeys(keys: string[]): Promise<CallResult> {
  return call({ method: "PATCH", body: { action: "delete", data: keys } });
}

export function setPaused(paused: boolean): Promise<CallResult> {
  return call({ method: "POST", body: { [PAUSED_KEY]: paused } });
}

export function setCooldown(seconds: number): Promise<CallResult> {
  return call({ method: "POST", body: { [COOLDOWN_KEY]: seconds } });
}
