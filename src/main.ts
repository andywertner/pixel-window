import "./style.css";
import { deleteKeys, deletePixel, getBoard, patchPixel, postPixel, setCooldown, setPaused, type Exchange, type Method } from "./api";
import {
  checkVerb,
  colorHex,
  coords,
  emptyCells,
  filledCount,
  filledKeys,
  keyAt,
  nextPollDelay,
  rectangleIndexes,
  snapshotFrom,
  statusHint,
  type Cells,
  type Verb,
} from "./board";
import { COLS, COOLDOWN_CHOICES, DEFAULT_COOLDOWN, PALETTE, POLL_MAX_MS, POLL_MS, ROWS, TEACHER_PASSWORD } from "./config";

type Mode = "student" | "wall";
type Tool = "none" | "clear";

interface Recent {
  method: Method;
  key: string;
  status: number;
}

interface State {
  cells: Cells;
  paused: boolean;
  cooldown: number;
  selected: number | null;
  color: string;
  pollStatus: number;
  pollMs: number;
  pollCount: number;
  pollKeys: number;
  pollDelay: number;
  pollInflight: boolean;
  pollError: string;
  last: Exchange | null;
  recent: Recent[];
  note: string;
  busy: boolean;
  cooldownUntil: number;
  pending: { index: number; value: string | null; at: number } | null;
  intro: boolean;
  teacher: boolean;
  passOpen: boolean;
  passWrong: boolean;
  tool: Tool;
  drag: { from: number; to: number } | null;
  pendingClear: number[] | null;
  confirmReset: boolean;
  teacherNote: string;
}

const COLOR_STORE = "pixel-window-color";
const INTRO_STORE = "pixel-window-intro";
const TEACHER_STORE = "pixel-window-teacher";

const rootElement = document.querySelector<HTMLElement>("#app");
if (!rootElement) throw new Error("Missing app root");
const root = rootElement;
const mode: Mode = root.dataset.mode === "wall" ? "wall" : "student";

const state: State = {
  cells: emptyCells(),
  paused: false,
  cooldown: DEFAULT_COOLDOWN,
  selected: null,
  color: savedColor(),
  pollStatus: 0,
  pollMs: 0,
  pollCount: 0,
  pollKeys: 0,
  pollDelay: POLL_MS,
  pollInflight: false,
  pollError: "",
  last: null,
  recent: [],
  note: "Click a pixel, pick a color, then choose a verb.",
  busy: false,
  cooldownUntil: 0,
  pending: null,
  intro: mode === "student" && sessionStorage.getItem(INTRO_STORE) !== "seen",
  teacher: sessionStorage.getItem(TEACHER_STORE) === "yes",
  passOpen: false,
  passWrong: false,
  tool: "none",
  drag: null,
  pendingClear: null,
  confirmReset: false,
  teacherNote: "",
};

function savedColor(): string {
  const saved = localStorage.getItem(COLOR_STORE);
  return PALETTE.some((swatch) => swatch.name === saved) ? (saved as string) : "red";
}

function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ---------- shell (built once) ---------- */

root.classList.add(mode);
root.innerHTML = `
  <header class="top">
    <h1>Pixel Window</h1>
    <div class="monitor" id="monitor"></div>
    <div class="bar" id="bar"><i></i></div>
  </header>
  <div class="admin" id="admin" hidden></div>
  <main class="main">
    <section class="stage" id="stage">
      <div class="board" id="board" role="grid" aria-label="Shared pixel board"></div>
      <div class="paused-badge" id="paused" hidden>
        <strong>Paused</strong>
        <span>GET keeps running. POST, PATCH and DELETE wait for the teacher.</span>
      </div>
    </section>
    <aside class="side" id="side"></aside>
  </main>
  <div class="wall-monitor"><span id="wall-monitor"></span><div class="bar" id="wall-bar"><i></i></div></div>
  <button type="button" class="t-mode" data-act="t-mode" aria-label="Teacher tools">T</button>
  <div id="overlay"></div>
`;

const board = root.querySelector<HTMLElement>("#board")!;
const stage = root.querySelector<HTMLElement>("#stage")!;
const monitor = root.querySelector<HTMLElement>("#monitor")!;
const wallMonitor = root.querySelector<HTMLElement>("#wall-monitor")!;
const admin = root.querySelector<HTMLElement>("#admin")!;
const side = root.querySelector<HTMLElement>("#side")!;
const pausedBadge = root.querySelector<HTMLElement>("#paused")!;
const overlay = root.querySelector<HTMLElement>("#overlay")!;

const cellNodes: HTMLButtonElement[] = [];
{
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < COLS * ROWS; index += 1) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cell empty";
    cell.dataset.i = String(index);
    const { x, y } = coords(index);
    cell.setAttribute("aria-label", `pixel ${x}, ${y}`);
    fragment.appendChild(cell);
    cellNodes.push(cell);
  }
  board.appendChild(fragment);
}

const painted: (string | null)[] = new Array<string | null>(COLS * ROWS).fill("unpainted");

function sizeBoard(): void {
  const rect = stage.getBoundingClientRect();
  const gap = 1;
  const pad = mode === "wall" ? 10 : 8;
  const width = (rect.width - pad * 2 - gap * (COLS - 1)) / COLS;
  const height = (rect.height - pad * 2 - gap * (ROWS - 1)) / ROWS;
  const cell = Math.max(4, Math.floor(Math.min(width, height)));
  board.style.setProperty("--cell", `${cell}px`);
}
new ResizeObserver(sizeBoard).observe(stage);
sizeBoard();

/* ---------- board painting ---------- */

function paintBoard(): void {
  const rectangle = new Set<number>();
  if (state.drag) for (const index of rectangleIndexes(state.drag.from, state.drag.to)) rectangle.add(index);
  if (state.pendingClear) for (const index of state.pendingClear) rectangle.add(index);
  for (let index = 0; index < cellNodes.length; index += 1) {
    const value = state.cells[index];
    const node = cellNodes[index];
    if (painted[index] !== value) {
      painted[index] = value;
      const hex = colorHex(value);
      node.style.background = hex ?? "";
      node.classList.toggle("empty", hex === null);
      node.classList.toggle("white", value === "white");
      node.title = value === null ? "empty" : value;
    }
    node.classList.toggle("sel", state.selected === index);
    node.classList.toggle("rect", rectangle.has(index));
  }
}

/* ---------- poll loop (the GET that never stops) ---------- */

let pollTimer = 0;

function schedulePoll(delay: number): void {
  window.clearTimeout(pollTimer);
  pollTimer = window.setTimeout(() => void poll(), delay);
}

async function poll(): Promise<void> {
  if (document.hidden) {
    schedulePoll(1000);
    return;
  }
  state.pollInflight = true;
  renderMonitor();
  const started = Date.now();
  const result = await getBoard();
  const snapshot = result.status === 200 ? snapshotFrom(result.json) : null;
  const ok = snapshot !== null;
  state.pollInflight = false;
  state.pollStatus = result.status;
  state.pollMs = result.exchange.ms;
  state.pollCount += 1;
  state.pollError = ok ? "" : result.status === 0 ? "no reply" : statusHint(result.status, result.text);
  if (snapshot) {
    state.cells = snapshot.cells;
    state.paused = snapshot.paused;
    state.cooldown = snapshot.cooldown;
    state.pollKeys = snapshot.keys;
    if (state.pending) {
      if (started < state.pending.at) state.cells[state.pending.index] = state.pending.value;
      else state.pending = null;
    }
  }
  state.pollDelay = nextPollDelay(state.pollDelay, ok, POLL_MS, POLL_MAX_MS);
  render();
  restartBars(state.pollDelay);
  schedulePoll(state.pollDelay);
}

/** The thin line under the header fills up over the wait, then GET fires again. */
function restartBars(duration: number): void {
  for (const bar of root.querySelectorAll<HTMLElement>(".bar")) {
    const old = bar.querySelector("i");
    const fresh = document.createElement("i");
    fresh.style.animationDuration = `${duration}ms`;
    if (old) old.replaceWith(fresh);
    else bar.appendChild(fresh);
  }
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) schedulePoll(0);
});

/* ---------- rendering ---------- */

function render(): void {
  paintBoard();
  renderMonitor();
  renderSide();
  renderAdmin();
  renderOverlay();
  pausedBadge.hidden = !state.paused;
  root.classList.toggle("paused", state.paused);
  root.classList.toggle("teacher", state.teacher);
  root.classList.toggle("tool-clear", state.teacher && state.tool === "clear");
  // Bars above the board may have appeared or gone; size now rather than a frame later.
  sizeBoard();
}

function statusClass(status: number): string {
  if (status >= 200 && status < 300) return "ok";
  if (status === 0) return "bad";
  return "warn";
}

function renderMonitor(): void {
  const filled = filledCount(state.cells);
  const seconds = Math.round(state.pollDelay / 1000);
  const status = state.pollCount === 0 ? "" : state.pollError ? state.pollError : statusHint(state.pollStatus, "");
  monitor.innerHTML = `
    <span class="dot ${state.pollInflight ? "live" : ""}"></span>
    <span class="verb-tag get">GET</span>
    <code>/api/records</code>
    <span class="every">every ${seconds}s</span>
    ${state.pollCount ? `<span class="st ${statusClass(state.pollStatus)}">${escape(status)}</span><span class="ms">${state.pollMs} ms</span>` : `<span class="st">starting…</span>`}
    <span class="filled">${filled} / ${COLS * ROWS} filled</span>
    <span class="count">#${state.pollCount}</span>`;
  wallMonitor.innerHTML = `
    <span class="dot ${state.pollInflight ? "live" : ""}"></span>
    <span class="verb-tag get">GET</span> every ${seconds}s ·
    <span class="st ${statusClass(state.pollStatus)}">${escape(status || "starting…")}</span> ·
    ${filled} / ${COLS * ROWS} · #${state.pollCount}`;
}

function cooldownLeft(): number {
  return Math.max(0, Math.ceil((state.cooldownUntil - Date.now()) / 1000));
}

function verbAllowed(verb: Verb): { ok: boolean; why: string } {
  if (state.selected === null) return { ok: false, why: "Click a pixel on the board first." };
  if (state.paused) return { ok: false, why: "The teacher paused the board. GET still runs." };
  if (state.busy) return { ok: false, why: "Waiting for the last reply…" };
  const left = cooldownLeft();
  if (left > 0 && !state.teacher) return { ok: false, why: `Cooldown: ${left}s until your next request.` };
  return checkVerb(verb, state.cells[state.selected], state.color);
}

function renderSide(): void {
  if (mode === "wall") return;
  const selected = state.selected;
  const current = selected === null ? null : state.cells[selected];
  const where = selected === null ? "" : (() => {
    const { x, y } = coords(selected);
    return `(${x}, ${y})`;
  })();
  const chip = current === null
    ? `<span class="chip empty-chip">empty</span>`
    : `<span class="chip" style="background:${colorHex(current)}">${escape(current)}</span>`;
  const left = cooldownLeft();
  const verbs = (["POST", "PATCH", "DELETE"] as Verb[]).map((verb) => {
    const allowed = verbAllowed(verb);
    const sub = verb === "POST" ? "fill" : verb === "PATCH" ? "recolor" : "clear";
    const timer = left > 0 && !state.teacher && state.selected !== null && !state.paused ? ` <em>${left}s</em>` : "";
    return `<button type="button" class="verb ${verb.toLowerCase()} ${allowed.ok ? "" : "off"}" data-act="verb" data-verb="${verb}" aria-disabled="${!allowed.ok}">${verb}${timer}<small>${sub}</small></button>`;
  }).join("");
  const palette = PALETTE.map((swatch) => `<button type="button" class="swatch ${swatch.name === "white" ? "white" : ""} ${state.color === swatch.name ? "on" : ""}" data-act="color" data-color="${swatch.name}" style="background:${swatch.hex}" title="${swatch.name}" aria-label="${swatch.name}" aria-pressed="${state.color === swatch.name}"></button>`).join("");
  side.innerHTML = `
    <section class="pick">
      <div class="pixel-info">
        <strong>Pixel</strong>
        ${selected === null ? `<span class="muted">none picked</span>` : `<code>${keyAt(selected)}</code> <span class="muted">${where}</span> ${chip}`}
      </div>
      <div class="palette" role="group" aria-label="Colors">${palette}</div>
      <div class="color-line">Your color: <span class="chip" style="background:${colorHex(state.color)}">${escape(state.color)}</span></div>
      <div class="verbs">${verbs}</div>
      <p class="note">${escape(state.note)}</p>
    </section>
    <section class="window">
      <h2>The Window <small>your last request</small></h2>
      ${renderExchange(state.last)}
      ${state.recent.length ? `<ul class="recent">${state.recent.map((entry) => `<li><span class="verb-tag ${entry.method.toLowerCase()}">${entry.method}</span> <code>${escape(entry.key)}</code> <span class="st ${statusClass(entry.status)}">${entry.status || "—"}</span></li>`).join("")}</ul>` : ""}
    </section>`;
}

function renderExchange(exchange: Exchange | null): string {
  if (!exchange) return `<p class="muted small">Nothing sent yet. GET is already running on its own, up top.</p>`;
  return `
    <div class="exchange">
      <div class="req"><span class="verb-tag ${exchange.method.toLowerCase()}">${exchange.method}</span> <code>${escape(exchange.url)}</code></div>
      ${exchange.body === null ? "" : `<pre>${escape(exchange.body)}</pre>`}
      <div class="res"><span class="st ${statusClass(exchange.status)}">${escape(statusHint(exchange.status, exchange.responseText))}</span> <span class="ms">${exchange.ms} ms</span></div>
      <pre>${escape(exchange.response)}</pre>
    </div>`;
}

function renderAdmin(): void {
  admin.hidden = !state.teacher;
  if (!state.teacher) return;
  const filled = filledCount(state.cells);
  let tools = "";
  if (state.pendingClear) {
    const count = state.pendingClear.filter((index) => state.cells[index] !== null).length;
    tools = `<span class="pending">Clear <b>${count}</b> filled pixel${count === 1 ? "" : "s"} in that area?</span>
      <button type="button" class="danger" data-act="clear-go" ${count === 0 ? "disabled" : ""}>Clear them</button>
      <button type="button" data-act="clear-cancel">Cancel</button>`;
  } else if (state.confirmReset) {
    tools = `<span class="pending">Reset the whole board? <b>${filled}</b> pixels will go.</span>
      <button type="button" class="danger" data-act="reset-go" ${filled === 0 ? "disabled" : ""}>Reset it</button>
      <button type="button" data-act="clear-cancel">Cancel</button>`;
  } else {
    tools = `
      <button type="button" class="${state.paused ? "resume" : "pause"}" data-act="pause">${state.paused ? "▶ Resume everyone" : "⏸ Pause everyone"}</button>
      <button type="button" class="${state.tool === "clear" ? "on" : ""}" data-act="tool-clear">${state.tool === "clear" ? "✓ Drag across the board…" : "Clear an area"}</button>
      <button type="button" data-act="reset">Reset board</button>
      <label>Cooldown
        <select data-act="cooldown" aria-label="Cooldown seconds">
          ${COOLDOWN_CHOICES.map((seconds) => `<option value="${seconds}" ${seconds === state.cooldown ? "selected" : ""}>${seconds}s</option>`).join("")}
        </select>
      </label>`;
  }
  admin.innerHTML = `
    <strong>Teacher</strong>
    ${tools}
    <span class="teacher-note">${escape(state.teacherNote)}</span>
    <button type="button" class="lock" data-act="lock">Lock</button>`;
}

function renderOverlay(): void {
  if (state.passOpen) {
    overlay.innerHTML = `<div class="veil"><form class="card password" id="pass-form">
      <h2>Teacher password</h2>
      <input id="pass" type="password" autocomplete="off" aria-label="Password" />
      ${state.passWrong ? `<p class="bad-text">That password is not right.</p>` : ""}
      <div class="row"><button type="button" data-act="pass-cancel">Cancel</button><button type="submit" class="primary">Unlock</button></div>
    </form></div>`;
    overlay.querySelector<HTMLInputElement>("#pass")?.focus();
    return;
  }
  if (state.intro) {
    overlay.innerHTML = `<div class="veil"><div class="card intro">
      <h2>Pixel Window</h2>
      <p>One board. The whole class. Four verbs.</p>
      <ul>
        <li><span class="verb-tag get">GET</span> runs by itself every 3 seconds. Watch the monitor at the top.</li>
        <li><span class="verb-tag post">POST</span> fills an <b>empty</b> pixel with your color.</li>
        <li><span class="verb-tag patch">PATCH</span> changes the color of a pixel that is <b>already filled</b>.</li>
        <li><span class="verb-tag delete">DELETE</span> empties a pixel. Any pixel. Yes, even that one.</li>
      </ul>
      <p class="muted">Nobody's name is on anything. Be the kind of pixel you want to see.</p>
      <button type="button" class="primary big" data-act="intro-go">Open the window</button>
    </div></div>`;
    return;
  }
  overlay.innerHTML = "";
}

/* ---------- student actions ---------- */

function remember(exchange: Exchange, key: string): void {
  state.last = exchange;
  state.recent.unshift({ method: exchange.method, key, status: exchange.status });
  state.recent = state.recent.slice(0, 5);
}

async function sendVerb(verb: Verb): Promise<void> {
  const allowed = verbAllowed(verb);
  if (!allowed.ok) {
    state.note = allowed.why;
    render();
    return;
  }
  const index = state.selected as number;
  const key = keyAt(index);
  const current = state.cells[index];
  state.busy = true;
  state.note = `Sending ${verb}…`;
  render();
  const result = verb === "POST"
    ? await postPixel(key, state.color)
    : verb === "PATCH"
      ? await patchPixel(key, state.color, current ?? "")
      : await deletePixel(key);
  state.busy = false;
  remember(result.exchange, key);
  const good = result.status >= 200 && result.status < 300;
  if (good) {
    const value = verb === "DELETE" ? null : state.color;
    state.cells[index] = value;
    state.pending = { index, value, at: Date.now() };
    state.note = verb === "POST"
      ? `201 Created. ${key} is ${state.color} for everyone on their next GET.`
      : verb === "PATCH"
        ? `200 OK. ${key} changed to ${state.color}.`
        : `200 OK. ${key} is empty again.`;
  } else if (result.status === 400 && /previous value/i.test(result.text)) {
    state.note = "400. Someone changed that pixel after your last GET. Wait for the next GET, then try again.";
  } else {
    state.note = `${statusHint(result.status, result.text)}. Try again in a moment.`;
  }
  if (!state.teacher) state.cooldownUntil = Date.now() + state.cooldown * 1000;
  render();
}

let cooldownTimer = 0;
window.setInterval(() => {
  if (mode === "wall") return;
  const left = cooldownLeft();
  if (left !== cooldownTimer) {
    cooldownTimer = left;
    renderSide();
  }
}, 200);

/* ---------- teacher actions ---------- */

async function teacherRequest(label: string, run: () => Promise<{ status: number; exchange: Exchange }>): Promise<void> {
  state.teacherNote = `${label}…`;
  renderAdmin();
  const result = await run();
  const good = result.status >= 200 && result.status < 300;
  state.teacherNote = good ? `${label}: ${statusHint(result.status, "")}` : `${label} failed: ${statusHint(result.status, "")}`;
  if (mode === "student") remember(result.exchange, "teacher");
  render();
}

async function togglePause(): Promise<void> {
  const next = !state.paused;
  state.paused = next;
  await teacherRequest(next ? "Paused" : "Resumed", () => setPaused(next));
}

async function clearIndexes(indexes: number[], label: string): Promise<void> {
  const keys = indexes.filter((index) => state.cells[index] !== null).map(keyAt);
  for (const index of indexes) state.cells[index] = null;
  state.pendingClear = null;
  state.confirmReset = false;
  state.drag = null;
  if (keys.length === 0) {
    state.teacherNote = "Nothing filled there.";
    render();
    return;
  }
  await teacherRequest(`${label} (${keys.length})`, () => deleteKeys(keys));
}

function unlockTeacher(): void {
  state.teacher = true;
  state.passOpen = false;
  state.passWrong = false;
  state.teacherNote = "Unlocked. Your requests skip the cooldown.";
  sessionStorage.setItem(TEACHER_STORE, "yes");
  render();
}

function lockTeacher(): void {
  state.teacher = false;
  state.tool = "none";
  state.drag = null;
  state.pendingClear = null;
  state.confirmReset = false;
  sessionStorage.removeItem(TEACHER_STORE);
  render();
}

/* ---------- events ---------- */

root.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (!target) return;
  const act = target.dataset.act;
  if (act === "color") {
    state.color = target.dataset.color ?? state.color;
    localStorage.setItem(COLOR_STORE, state.color);
    render();
  } else if (act === "verb") {
    void sendVerb(target.dataset.verb as Verb);
  } else if (act === "intro-go") {
    state.intro = false;
    sessionStorage.setItem(INTRO_STORE, "seen");
    render();
  } else if (act === "t-mode") {
    if (state.teacher) lockTeacher();
    else {
      state.passOpen = true;
      state.passWrong = false;
      render();
    }
  } else if (act === "pass-cancel") {
    state.passOpen = false;
    render();
  } else if (act === "lock") {
    lockTeacher();
  } else if (act === "pause") {
    void togglePause();
  } else if (act === "tool-clear") {
    state.tool = state.tool === "clear" ? "none" : "clear";
    state.selected = null;
    state.drag = null;
    state.pendingClear = null;
    state.teacherNote = state.tool === "clear" ? "Drag a box over the pixels to clear." : "";
    render();
  } else if (act === "reset") {
    state.confirmReset = true;
    state.pendingClear = null;
    render();
  } else if (act === "reset-go") {
    void clearIndexes(state.cells.map((_cell, index) => index), "Reset");
  } else if (act === "clear-go") {
    if (state.pendingClear) void clearIndexes(state.pendingClear, "Cleared");
  } else if (act === "clear-cancel") {
    state.pendingClear = null;
    state.confirmReset = false;
    state.drag = null;
    render();
  }
});

root.addEventListener("change", (event) => {
  const target = event.target as HTMLSelectElement;
  if (target.dataset.act !== "cooldown") return;
  const seconds = Number(target.value);
  state.cooldown = seconds;
  void teacherRequest(`Cooldown ${seconds}s`, () => setCooldown(seconds));
});

root.addEventListener("submit", (event) => {
  const form = event.target as HTMLFormElement;
  if (form.id !== "pass-form") return;
  event.preventDefault();
  const input = form.querySelector<HTMLInputElement>("#pass");
  if (input && input.value === TEACHER_PASSWORD) unlockTeacher();
  else {
    state.passWrong = true;
    render();
    overlay.querySelector<HTMLInputElement>("#pass")?.focus();
  }
});

function cellIndexAt(clientX: number, clientY: number): number | null {
  const rect = board.getBoundingClientRect();
  const cell = parseFloat(getComputedStyle(board).getPropertyValue("--cell")) || 1;
  const step = cell + 1;
  const x = Math.floor((clientX - rect.left - 2) / step);
  const y = Math.floor((clientY - rect.top - 2) / step);
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return null;
  return y * COLS + x;
}

board.addEventListener("pointerdown", (event) => {
  const index = cellIndexAt(event.clientX, event.clientY);
  if (index === null) return;
  if (state.teacher && state.tool === "clear") {
    event.preventDefault();
    board.setPointerCapture(event.pointerId);
    state.drag = { from: index, to: index };
    state.pendingClear = null;
    paintBoard();
    return;
  }
  if (mode === "wall") return;
  state.selected = index;
  const value = state.cells[index];
  state.note = value === null ? `${keyAt(index)} is empty. POST fills it with ${state.color}.` : `${keyAt(index)} is ${value}. PATCH recolors it, DELETE empties it.`;
  render();
});

board.addEventListener("pointermove", (event) => {
  if (!state.drag) return;
  const index = cellIndexAt(event.clientX, event.clientY);
  if (index === null || index === state.drag.to) return;
  state.drag.to = index;
  paintBoard();
});

function finishDrag(): void {
  if (!state.drag) return;
  state.pendingClear = rectangleIndexes(state.drag.from, state.drag.to);
  state.drag = null;
  render();
}
board.addEventListener("pointerup", finishDrag);
board.addEventListener("pointercancel", () => {
  state.drag = null;
  paintBoard();
});

/* ---------- go ---------- */

render();
schedulePoll(0);
