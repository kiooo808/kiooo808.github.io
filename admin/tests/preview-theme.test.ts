import test from "node:test";
import assert from "node:assert/strict";
import { watchTimeTheme } from "../src/preview-theme";

test("an open preview switches at dusk and dawn, resynchronizes on return, and stops on close", (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const browser = new EventTarget();
  const page = new EventTarget();
  let stop: (() => void) | undefined;
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  Object.defineProperty(globalThis, "document", { configurable: true, value: page });
  t.after(() => {
    stop?.();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  });
  const at = (day: number, hour: number, minute = 0, second = 0) =>
    new Date(2026, 10, day, hour, minute, second).getTime();
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: at(2, 17, 59, 59) });
  const modes: boolean[] = [];
  stop = watchTimeTheme((dark) => modes.push(dark));
  assert.deepEqual(modes, [false]);
  t.mock.timers.tick(1000);
  assert.deepEqual(modes, [false, true]);
  t.mock.timers.tick(at(3, 6) - at(2, 18));
  assert.deepEqual(modes, [false, true, false]);

  // A suspended tab or a changed computer clock catches up when it is used again.
  t.mock.timers.setTime(at(3, 23));
  browser.dispatchEvent(new Event("focus"));
  assert.equal(modes.at(-1), true);
  t.mock.timers.setTime(at(4, 12));
  page.dispatchEvent(new Event("visibilitychange"));
  assert.equal(modes.at(-1), false);

  stop();
  const count = modes.length;
  browser.dispatchEvent(new Event("focus"));
  page.dispatchEvent(new Event("visibilitychange"));
  t.mock.timers.tick(24 * 60 * 60 * 1000);
  assert.equal(modes.length, count);
});
