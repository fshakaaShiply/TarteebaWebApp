import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// The fixtures hard-code dates that were "today" or ahead when the suites were written (21-23 October 2026), so the
// clock starts at the instant they were last known green (20:00 in Dubai), whatever the real date. Move it forward
// when the fixtures are refreshed; the first to go stale is the ops screens' vehicle insurance expiry, 2026-11-05.
const TEST_NOW = Date.parse("2026-10-23T16:00:00Z");

// Only Date is replaced, and it runs on in real time from TEST_NOW. vi.useFakeTimers({ shouldAdvanceTime }) would
// advance it in 20 ms ticks of a real interval, so a long synchronous render would hold it back. Timers stay real; a
// test's own vi.useFakeTimers() starts from this clock and its vi.useRealTimers() returns to it. A few reads bypass
// Date and get the real clock: an Intl formatter's format() without a date (pass one, as format.ts does),
// performance.timeOrigin, vi.getRealSystemTime() and vi.setSystemTime() without a date.
const RealDate = Date;
let offsetMs = TEST_NOW - RealDate.now();
const pinnedNow = () => RealDate.now() + offsetMs;
const PinnedDate = new Proxy(RealDate, {
  construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [pinnedNow()], newTarget),
  apply: () => new RealDate(pinnedNow()).toString(),
  get: (target, key, receiver) => (key === "now" ? pinnedNow : Reflect.get(target, key, receiver)),
});
// Installed now, so module scope, describe bodies and beforeAll/afterAll get it too, not only the tests.
globalThis.Date = PinnedDate;

// A file that sets its own clock before its tests (at module scope or in beforeAll) keeps it for all of them: the hooks
// below leave fake timers or a Date other than the pin alone if they were already there when a test started.
let fileClock = false;

// Per test, so a test that fakes or restores timers itself can't move the next one off TEST_NOW.
beforeEach(() => {
  fileClock = vi.isFakeTimers() || globalThis.Date !== PinnedDate;
  offsetMs = TEST_NOW - RealDate.now();
});

// Testing Library only auto-cleans with test globals; this suite imports from "vitest" explicitly. Fake timers a test
// left on go too, so the next test starts with real ones on the pin.
afterEach(() => {
  cleanup();
  if (fileClock) return;
  vi.useRealTimers();
  globalThis.Date = PinnedDate;
});
