// One real round trip against the live locker from a browser: GET ticks, POST a pixel,
// PATCH it, DELETE it. Leaves the store as it found it. CHROME=<path> picks the browser.
import puppeteer from "puppeteer-core";

const base = process.env.BASE || "http://127.0.0.1:5175/";
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 650 });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function click(selector) {
  const box = await page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(box.x, box.y);
}
const note = () => page.$eval(".note", (el) => el.textContent);

try {
  await page.evaluateOnNewDocument(() => {
    sessionStorage.setItem("pixel-window-intro", "seen");
    sessionStorage.setItem("pixel-window-teacher", "yes"); // skip the cooldown for a quick run
  });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => /200 OK/.test(document.querySelector("#monitor").textContent), { timeout: 15000 });
  const monitor = await page.$eval("#monitor", (el) => el.textContent.replace(/\s+/g, " ").trim());
  const index = await page.evaluate(() => {
    const cells = [...document.querySelectorAll(".cell")];
    return cells.findIndex((cell) => cell.classList.contains("empty"));
  });
  if (index < 0) throw new Error("board is full; nothing to test with");
  const key = `px-${index % 30}-${Math.floor(index / 30)}`;
  await click(`[data-i="${index}"]`);
  await click('[data-act="color"][data-color="teal"]');
  await click('[data-verb="POST"]');
  await page.waitForFunction(() => /201 Created/.test(document.querySelector(".note").textContent), { timeout: 10000 });
  await click('[data-act="color"][data-color="purple"]');
  await click('[data-verb="PATCH"]');
  await page.waitForFunction(() => /200 OK/.test(document.querySelector(".note").textContent), { timeout: 10000 });
  await sleep(3500); // let a real GET confirm it
  const seen = await page.$eval(`[data-i="${index}"]`, (el) => el.title);
  await click('[data-verb="DELETE"]');
  await page.waitForFunction(() => /empty again/.test(document.querySelector(".note").textContent), { timeout: 10000 });
  await sleep(3500);
  const gone = await page.$eval(`[data-i="${index}"]`, (el) => el.classList.contains("empty"));
  if (seen !== "purple") throw new Error(`after PATCH + GET the pixel was ${seen}`);
  if (!gone) throw new Error("pixel still filled after DELETE + GET");
  if (errors.length) throw new Error(errors.join(" | "));
  console.log(`live ok on ${await browser.version()}: ${key} POST -> PATCH -> DELETE, monitor: ${monitor}`);
} catch (error) {
  await page.screenshot({ path: "/tmp/pixel-live-FAIL.png" });
  console.error(error.message, await note().catch(() => ""));
  process.exitCode = 1;
} finally {
  await browser.close();
}
