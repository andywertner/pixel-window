/** Pixel Window's own Zapier Storage locker. Not shared with The Window or Dash. */
export const STORE_SECRET = "2a4825a7-8e4e-465a-8610-09c6069634ff";

export const STORE_ORIGIN = "https://store.zapier.com";
export const RECORDS_PATH = "/api/records";

/**
 * Zapier Storage allows 500 keys per secret. One key per pixel keeps every
 * verb honest (POST really creates, DELETE really removes), so the board is
 * 30 x 16 = 480 pixels, leaving room for the settings keys below.
 */
export const COLS = 30;
export const ROWS = 16;
export const PIXEL_PREFIX = "px-";

export const PAUSED_KEY = "wall-paused";
export const COOLDOWN_KEY = "wall-cooldown";

/** How often every page GETs the board. */
export const POLL_MS = 3000;
/** Slowest the poll backs off to if the store ever throttles. */
export const POLL_MAX_MS = 15000;
/** Seconds a student waits between writes unless the teacher changes it. */
export const DEFAULT_COOLDOWN = 5;
export const COOLDOWN_CHOICES = [1, 2, 3, 5, 10];

export const TEACHER_PASSWORD = "admin";

export interface Swatch {
  name: string;
  hex: string;
}

export const PALETTE: Swatch[] = [
  { name: "white", hex: "#ffffff" },
  { name: "gray", hex: "#8e98a8" },
  { name: "black", hex: "#1b1f27" },
  { name: "brown", hex: "#8a5a2b" },
  { name: "red", hex: "#e63946" },
  { name: "orange", hex: "#f77f1e" },
  { name: "yellow", hex: "#ffd23f" },
  { name: "lime", hex: "#9ad92b" },
  { name: "green", hex: "#2a9d5c" },
  { name: "teal", hex: "#1a9a8f" },
  { name: "cyan", hex: "#3cc8f0" },
  { name: "blue", hex: "#2f6fe0" },
  { name: "navy", hex: "#213a8f" },
  { name: "purple", hex: "#7b3fe4" },
  { name: "pink", hex: "#ff7eb6" },
  { name: "magenta", hex: "#d63cae" },
];

/** Anything that is not a palette name still shows up, so it can be deleted. */
export const UNKNOWN_HEX = "#b8bec8";
