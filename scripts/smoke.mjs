// Functional walkthrough against the in-page store mock. Fails on any console error,
// page error, wrong request shape, or visible secret. CHROME=<path> picks the browser.
import fs from "node:fs";
import puppeteer from "puppeteer-core";
import { installMock, seedBoard } from "./mock.mjs";

const base = process.env.BASE || "http://127.0.0.1:5175/";
const secret = fs.readFileSync(new URL("../src/config.ts", import.meta.url), "utf8").match(/STORE_SECRET = "([^"]+)"/)[1];
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const version = await browser.version();
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 650 });
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error" && !/favicon/.test(message.text())) errors.push(`console: ${message.text()}`);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Click by coordinates: the side panel re-renders when a GET lands, which detaches the
// node puppeteer grabbed, but a real click at the same spot still hits the fresh button.
async function click(selector) {
  const box = await page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(box.x, box.y);
}
page.click = click;
const requests = () => page.evaluate(() => window.__requests.filter((r) => r.method !== "GET"));
const note = () => page.$eval(".note", (el) => el.textContent);
const monitorText = () => page.$eval("#monitor", (el) => el.textContent);
const pollCount = async () => Number((await page.$eval("#monitor, #wall-monitor", (el) => el.textContent)).match(/#(\d+)/)[1]);
const cellClass = (i) => page.$eval(`[data-i="${i}"]`, (el) => el.className);
const cellBg = (i) => page.$eval(`[data-i="${i}"]`, (el) => el.style.background);
let step = "";
function check(ok, what) {
  if (!ok) throw new Error(`${step}: ${what}`);
}

try {
  const seed = seedBoard(0.5);
  seed["wall-cooldown"] = 1;
  delete seed["px-0-0"];
  seed["px-1-0"] = "green";
  await page.evaluateOnNewDocument(installMock, seed);
  await page.goto(base, { waitUntil: "domcontentloaded" });

  step = "intro";
  await page.waitForSelector(".intro");
  check(!(await page.content()).includes(secret), "secret visible in page");
  await page.click('[data-act="intro-go"]');
  await page.waitForFunction(() => /#1/.test(document.querySelector("#monitor").textContent));
  check((await cellClass(1)).includes("empty") === false, "seeded pixel not painted");
  check((await cellClass(0)).includes("empty"), "empty pixel painted");
  check(/200 OK/.test(await monitorText()), "monitor missing 200 OK");

  step = "post";
  await page.click('[data-i="0"]');
  check(/empty/.test(await note()), "note should say empty");
  await page.click('[data-act="color"][data-color="blue"]');
  await page.click('[data-verb="POST"]');
  await sleep(150);
  let reqs = await requests();
  check(reqs.length === 1 && reqs[0].method === "POST", `expected one POST, got ${JSON.stringify(reqs)}`);
  check(JSON.stringify(reqs[0].body) === '{"px-0-0":"blue"}', `POST body ${JSON.stringify(reqs[0].body)}`);
  check(reqs[0].url.includes(`secret=${secret}`), "POST missing secret");
  check(/201 Created/.test(await note()), `note after POST: ${await note()}`);
  check(!(await page.content()).includes(secret), "secret visible after POST");
  check((await page.$eval(".exchange", (el) => el.textContent)).includes("••••"), "log should mask the secret");

  step = "cooldown";
  await page.click('[data-verb="DELETE"]');
  await sleep(50);
  check((await requests()).length === 1, "DELETE should be blocked by cooldown");
  check(/Cooldown/.test(await note()), `expected cooldown note, got ${await note()}`);
  await sleep(1100);

  step = "patch";
  await page.click('[data-act="color"][data-color="red"]');
  await page.click('[data-verb="PATCH"]');
  await sleep(150);
  reqs = await requests();
  check(reqs.length === 2 && reqs[1].method === "PATCH", "expected PATCH");
  check(reqs[1].body.action === "set_value_if" && reqs[1].body.data.previous_value === "blue" && reqs[1].body.data.value === "red", `PATCH body ${JSON.stringify(reqs[1].body)}`);
  check(/200 OK/.test(await note()), `note after PATCH: ${await note()}`);
  check((await cellBg(0)).length > 0, "cell should be painted after PATCH");

  step = "patch-conflict";
  await sleep(1100);
  await page.evaluate(() => { window.__store["px-0-0"] = "yellow"; });
  await page.click('[data-act="color"][data-color="pink"]');
  await page.click('[data-verb="PATCH"]');
  await sleep(150);
  check(/Someone changed/.test(await note()), `conflict note: ${await note()}`);
  await page.waitForFunction(() => document.querySelector('[data-i="0"]').title === "yellow", { timeout: 5000 });

  step = "post-blocked";
  await sleep(1100);
  await page.click('[data-verb="POST"]');
  await sleep(50);
  check(/already filled/.test(await note()), `expected already filled, got ${await note()}`);
  check((await requests()).length === 3, "blocked POST must not send");

  step = "delete";
  await page.click('[data-verb="DELETE"]');
  await sleep(150);
  reqs = await requests();
  check(reqs[3].method === "DELETE" && reqs[3].url.includes("key=px-0-0"), `DELETE url ${reqs[3].url}`);
  check((await cellClass(0)).includes("empty"), "cell should be empty after DELETE");
  check(/empty again/.test(await note()), `note after DELETE: ${await note()}`);

  step = "wrong-password";
  await page.click('[data-act="t-mode"]');
  await page.type("#pass", "nope");
  await page.keyboard.press("Enter");
  await sleep(50);
  check(await page.$(".bad-text"), "wrong password should show an error");
  await page.$eval("#pass", (el) => { el.value = ""; });
  await page.type("#pass", "admin");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".admin:not([hidden])");

  step = "pause";
  await page.click('[data-act="pause"]');
  await sleep(150);
  reqs = await requests();
  check(JSON.stringify(reqs.at(-1).body) === '{"wall-paused":true}', `pause body ${JSON.stringify(reqs.at(-1).body)}`);
  check(!(await page.$eval("#paused", (el) => el.hidden)), "paused badge should show");
  await page.click('[data-i="5"]');
  await page.click('[data-verb="POST"]');
  await sleep(50);
  check(/paused/.test(await note()), `paused note: ${await note()}`);
  await page.click('[data-act="pause"]');
  await sleep(150);
  check(JSON.stringify((await requests()).at(-1).body) === '{"wall-paused":false}', "resume body");

  step = "clear-area";
  await page.click('[data-act="tool-clear"]');
  const a = await (await page.$('[data-i="1"]')).boundingBox();
  const b = await (await page.$('[data-i="62"]')).boundingBox();
  await page.mouse.move(a.x + 3, a.y + 3);
  await page.mouse.down();
  await page.mouse.move(b.x + 3, b.y + 3, { steps: 5 });
  await page.mouse.up();
  await sleep(50);
  const pendingText = await page.$eval(".admin .pending", (el) => el.textContent);
  check(/Clear \d+ filled/.test(pendingText), `pending text ${pendingText}`);
  const expectedKeys = await page.evaluate(() => [1, 2, 31, 32, 61, 62].filter((i) => !document.querySelector(`[data-i="${i}"]`).classList.contains("empty")).map((i) => `px-${i % 30}-${Math.floor(i / 30)}`));
  await page.click('[data-act="clear-go"]');
  await sleep(150);
  reqs = await requests();
  check(reqs.at(-1).method === "PATCH" && reqs.at(-1).body.action === "delete", "clear should PATCH delete");
  check(JSON.stringify(reqs.at(-1).body.data.slice().sort()) === JSON.stringify(expectedKeys.slice().sort()), `clear keys ${JSON.stringify(reqs.at(-1).body.data)} vs ${JSON.stringify(expectedKeys)}`);
  check((await cellClass(1)).includes("empty") && (await cellClass(62)).includes("empty"), "cleared cells should be empty");

  step = "cooldown-select";
  await page.select('[data-act="cooldown"]', "5");
  await sleep(150);
  check(JSON.stringify((await requests()).at(-1).body) === '{"wall-cooldown":5}', "cooldown body");

  step = "reset";
  await page.click('[data-act="reset"]');
  await sleep(50);
  await page.click('[data-act="reset-go"]');
  await sleep(150);
  reqs = await requests();
  check(reqs.at(-1).body.action === "delete" && reqs.at(-1).body.data.length > 100, "reset should delete every filled key");
  check(reqs.at(-1).body.data.every((k) => k.startsWith("px-")), "reset must only touch pixels");
  check(await page.evaluate(() => Object.keys(window.__store).filter((k) => k.startsWith("px-")).length) === 0, "store should have no pixels");
  await page.waitForFunction(() => /\b0 \/ 480 filled/.test(document.querySelector("#monitor").textContent), { timeout: 5000 });

  step = "poll-backoff";
  const before = await pollCount();
  await sleep(3300);
  check((await pollCount()) > before, "GET should keep ticking");
  await page.evaluate(() => { window.__fail = true; });
  await page.waitForFunction(() => /403/.test(document.querySelector("#monitor").textContent), { timeout: 5000 });
  check(/every 6s/.test(await monitorText()), `expected backoff to 6s: ${await monitorText()}`);
  await page.evaluate(() => { window.__fail = false; });
  await page.waitForFunction(() => /every 3s/.test(document.querySelector("#monitor").textContent) && /200 OK/.test(document.querySelector("#monitor").textContent), { timeout: 9000 });

  step = "wall";
  const seed2 = seedBoard(0.5);
  seed2["wall-paused"] = true;
  await page.evaluateOnNewDocument(installMock, seed2);
  await page.goto(`${base}wall/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll(".cell:not(.empty)").length > 100);
  check(!(await page.$eval(".side", (el) => getComputedStyle(el).display !== "none")), "wall should hide the side panel");
  check(!(await page.$eval("#paused", (el) => el.hidden)), "wall should show paused");
  check(!(await page.content()).includes(secret), "secret visible on wall");
  await page.click('[data-i="7"]');
  await sleep(50);
  check((await page.evaluate(() => window.__requests.filter((r) => r.method !== "GET").length)) === 0, "wall clicks must not send anything");

  check(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
  console.log(`smoke ok on ${version}`);
} catch (error) {
  await page.screenshot({ path: "/tmp/pixel-smoke-FAIL.png" });
  console.error(error.message);
  if (errors.length) console.error(errors.join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close();
}
