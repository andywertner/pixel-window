// Every screen must fit a 1366x650 Chromebook at 100% and 130% browser zoom with nothing
// clipped or covered. Browser zoom is emulated the way Chrome does it: a smaller CSS
// viewport with a higher devicePixelRatio. Run with CHROME=<path> to use another binary.
import puppeteer from "puppeteer-core";
import { installMock, seedBoard } from "./mock.mjs";

const base = process.env.BASE || "http://127.0.0.1:5175/";
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--no-sandbox"],
});
let page;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function click(selector) {
  const box = await page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(box.x, box.y);
}

const states = [
  { id: "intro", path: "", intro: true },
  { id: "plain", path: "" },
  { id: "picked", path: "", pick: true },
  { id: "picked-130-note", path: "", pick: true, longNote: true },
  { id: "paused", path: "", paused: true, pick: true },
  { id: "poll-error", path: "", fail: true, pick: true },
  { id: "teacher", path: "", teacher: true, pick: true },
  { id: "teacher-reset", path: "", teacher: true, reset: true },
  { id: "teacher-clear", path: "", teacher: true, clear: true },
  { id: "teacher-paused", path: "", teacher: true, paused: true },
  { id: "password", path: "", password: true },
  { id: "wall", path: "wall/" },
  { id: "wall-paused", path: "wall/", paused: true },
  { id: "wall-teacher", path: "wall/", teacher: true },
  { id: "wall-teacher-clear", path: "wall/", teacher: true, clear: true },
];

function audit(zoom) {
  const problems = [];
  const vw = innerWidth;
  const vh = innerHeight;
  const doc = document.documentElement;
  if (doc.scrollHeight > vh + 1 || doc.scrollWidth > vw + 1) problems.push(`page scrolls ${doc.scrollWidth}x${doc.scrollHeight} > ${vw}x${vh}`);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const within = (r) => r.top >= -1 && r.left >= -1 && r.bottom <= vh + 1 && r.right <= vw + 1;
  const label = (el) => (el.getAttribute("aria-label") || el.innerText || el.className).replace(/\s+/g, " ").slice(0, 30);
  const tButton = document.querySelector(".t-mode").getBoundingClientRect();
  const overlaps = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;

  for (const el of document.querySelectorAll("button, input, select, .pixel-info, .note, h1, h2, .monitor, .admin, .paused-badge, .wall-monitor")) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (!within(r)) problems.push(`off-screen ${el.tagName.toLowerCase()} ${label(el)}`);
    if (!el.classList.contains("t-mode") && !el.closest(".t-mode") && overlaps(r, tButton) && !el.matches(".monitor, .admin, .top")) {
      problems.push(`covered by T button: ${label(el)}`);
    }
  }
  const monitor = document.querySelector(".monitor");
  if (monitor && visible(monitor) && monitor.scrollWidth > monitor.clientWidth + 1) problems.push(`monitor text clipped ${monitor.scrollWidth}>${monitor.clientWidth}`);
  for (const el of document.querySelectorAll(".pick, .side, .admin, .card, .stage, .main")) {
    if (!visible(el)) continue;
    if (el.scrollHeight > el.clientHeight + 2) problems.push(`${el.className.split(" ")[0]} overflows ${el.scrollHeight}>${el.clientHeight}`);
  }
  const admin = document.querySelector(".admin");
  if (admin && visible(admin) && admin.getBoundingClientRect().height > 70) problems.push(`admin bar wraps to ${Math.round(admin.getBoundingClientRect().height)}px`);
  const win = document.querySelector(".window");
  if (win && visible(win) && win.getBoundingClientRect().height < 110) problems.push(`window log too short ${Math.round(win.getBoundingClientRect().height)}`);
  const board = document.querySelector("#board");
  const stage = document.querySelector("#stage");
  if (board && visible(board)) {
    const b = board.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    if (b.left < s.left - 1 || b.right > s.right + 1 || b.top < s.top - 1 || b.bottom > s.bottom + 1) problems.push("board outside stage");
    const cell = parseFloat(getComputedStyle(board).getPropertyValue("--cell"));
    const minCell = zoom > 1 ? 18 : 24;
    if (cell < minCell) problems.push(`cells only ${cell}px`);
    const fill = Math.max(b.width / s.width, b.height / s.height);
    if (fill < 0.9) problems.push(`board uses only ${Math.round(fill * 100)}% of its space`);
    const pill = document.querySelector(".wall-monitor");
    if (pill && visible(pill) && overlaps(b, pill.getBoundingClientRect())) problems.push("wall monitor covers pixels");
    if (overlaps(b, tButton)) problems.push("T button covers pixels");
  }
  for (const card of document.querySelectorAll(".card")) {
    if (card.scrollHeight > card.clientHeight + 2) problems.push(`card needs scrolling ${card.scrollHeight}>${card.clientHeight}`);
  }
  return problems;
}

const failures = [];
let shots = 0;
try {
  for (const zoom of [1, 1.3]) {
    for (const state of states) {
      // Fresh page per state: init scripts (mock seed, fail flag) would otherwise pile up.
      if (page) await page.close();
      page = await browser.newPage();
      page.click = click;
      await page.setViewport({ width: Math.round(1366 / zoom), height: Math.round(650 / zoom), deviceScaleFactor: zoom });
      const seed = seedBoard(0.5);
      if (state.paused) seed["wall-paused"] = true;
      await page.evaluateOnNewDocument(installMock, seed);
      await page.evaluateOnNewDocument((s) => {
        sessionStorage.setItem("pixel-window-intro", s.intro ? "" : "seen");
        if (s.teacher) sessionStorage.setItem("pixel-window-teacher", "yes");
        else sessionStorage.removeItem("pixel-window-teacher");
        if (s.fail) window.__fail = true;
      }, state);
      await page.goto(`${base}${state.path}`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.querySelectorAll(".cell").length === 480 && Number(document.querySelector("#wall-monitor, #monitor").textContent.match(/#(\d+)/)?.[1] || 0) >= 1);
      if (state.pick) {
        await page.click('[data-i="31"]');
        await page.click('[data-verb="PATCH"]');
        await sleep(150);
        await page.click('[data-i="32"]');
        await page.click('[data-verb="DELETE"]');
        await sleep(150);
      }
      if (state.longNote) {
        await page.evaluate(() => {
          const note = document.querySelector(".note");
          if (note) note.textContent = "400. Someone changed that pixel after your last GET. Wait for the next GET, then try again.";
        });
      }
      if (state.password) {
        await page.click('[data-act="t-mode"]');
        await sleep(50);
        await page.type("#pass", "nope");
        await page.keyboard.press("Enter");
        await sleep(50);
      }
      if (state.reset) {
        await page.click('[data-act="reset"]');
        await sleep(50);
      }
      if (state.clear) {
        await page.click('[data-act="tool-clear"]');
        const a = await page.$('[data-i="0"]');
        const b = await page.$('[data-i="93"]');
        const ra = await a.boundingBox();
        const rb = await b.boundingBox();
        await page.mouse.move(ra.x + 2, ra.y + 2);
        await page.mouse.down();
        await page.mouse.move(rb.x + 2, rb.y + 2, { steps: 4 });
        await page.mouse.up();
        await sleep(50);
      }
      await sleep(120);
      const problems = await page.evaluate(audit, zoom);
      const name = `${Math.round(zoom * 100)}-${state.id}`;
      if (problems.length) {
        failures.push(`${name}: ${problems.join("; ")}`);
        await page.screenshot({ path: `/tmp/pixel-fit-FAIL-${name}.png` });
      } else if (process.env.SHOTS) {
        await page.screenshot({ path: `/tmp/pixel-fit-${name}.png` });
        shots += 1;
      }
    }
  }
} finally {
  await browser.close();
}
if (failures.length) {
  console.log(failures.join("\n"));
  process.exit(1);
}
console.log(`fit ok (${states.length * 2} screens${shots ? `, ${shots} shots in /tmp` : ""})`);
