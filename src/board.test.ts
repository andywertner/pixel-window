import assert from "node:assert/strict";
import { checkVerb, colorHex, filledKeys, keyAt, nextPollDelay, parseKey, pixelKey, rectangleIndexes, snapshotFrom, statusHint } from "./board";
import { COLS, ROWS, UNKNOWN_HEX } from "./config";

assert.equal(pixelKey(3, 4), "px-3-4");
assert.equal(parseKey("px-3-4"), 4 * COLS + 3);
assert.equal(parseKey("px-30-0"), null, "x past the edge is ignored");
assert.equal(parseKey(`px-0-${ROWS}`), null, "y past the edge is ignored");
assert.equal(parseKey("wall-paused"), null);
assert.equal(parseKey("px-a-b"), null);
assert.equal(keyAt(parseKey("px-29-15")!), "px-29-15");

const snap = snapshotFrom({ "px-0-0": "red", "px-1-0": "  BLUE ", "px-2-0": 7, "px-5-5": "", "wall-paused": true, "wall-cooldown": 5, junk: 1 });
assert.ok(snap);
assert.equal(snap.cells[0], "red");
assert.equal(snap.cells[1], "blue", "names are normalized");
assert.equal(snap.cells[2], "?", "non-string junk still shows so it can be deleted");
assert.equal(snap.cells[5 * COLS + 5], null, "empty string counts as empty");
assert.equal(snap.paused, true);
assert.equal(snap.cooldown, 5);
assert.equal(snap.keys, 7);
assert.equal(snapshotFrom([]), null);
assert.equal(snapshotFrom({})!.cooldown, 5, "default cooldown");
assert.equal(snapshotFrom({ "wall-paused": "yes" })!.paused, false, "only a real true pauses");
assert.equal(snapshotFrom({ "wall-cooldown": 999 })!.cooldown, 60, "cooldown is capped");

assert.equal(colorHex(null), null);
assert.equal(colorHex("red"), "#e63946");
assert.equal(colorHex("?"), UNKNOWN_HEX);
assert.deepEqual(filledKeys(snap.cells), ["px-0-0", "px-1-0", "px-2-0"]);

assert.deepEqual(rectangleIndexes(1 * COLS + 2, 0), [0, 1, 2, COLS, COLS + 1, COLS + 2], "drag in either direction");
assert.deepEqual(rectangleIndexes(7, 7), [7]);

assert.equal(checkVerb("POST", null, "red").ok, true);
assert.equal(checkVerb("POST", "red", "blue").ok, false);
assert.equal(checkVerb("PATCH", null, "red").ok, false);
assert.equal(checkVerb("PATCH", "red", "red").ok, false);
assert.equal(checkVerb("PATCH", "red", "blue").ok, true);
assert.equal(checkVerb("DELETE", null, "red").ok, false);
assert.equal(checkVerb("DELETE", "red", "red").ok, true);

assert.equal(statusHint(201, ""), "201 Created");
assert.match(statusHint(400, '{"error": "Stored value does not match previous value."}'), /someone else/);
assert.match(statusHint(400, "Expected JSON"), /could not read/);

assert.equal(nextPollDelay(3000, true, 3000, 15000), 3000);
assert.equal(nextPollDelay(3000, false, 3000, 15000), 6000);
assert.equal(nextPollDelay(12000, false, 3000, 15000), 15000);

console.log("board ok");
