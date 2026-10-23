import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// The fixtures hard-code dates that were "today" or ahead when the suites were written (21-23 October 2026), so each
// test starts its clock at the instant they were last known green (20:00 in Dubai), whatever the real date. Move it
// forward when the fixtures are refreshed.
const TEST_NOW = Date.parse("2026-10-23T16:00:00Z");

// Only Date is replaced, and it runs on in real time from TEST_NOW. vi.useFakeTimers({ shouldAdvanceTime }) would
// advance it in 20 ms ticks of a real interval, so a long synchronous render would hold it back. Timers stay real; a
// test's own vi.useFakeTimers() starts from this clock and its vi.useRealTimers() returns to it.
const RealDate = Date;
let offsetMs = 0;
const pinnedNow = () => RealDate.now() + offsetMs;
const PinnedDate = new Proxy(RealDate, {
  construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [pinnedNow()], newTarget),
  apply: () => new RealDate(pinnedNow()).toString(),
  get: (target, key, receiver) => (key === "now" ? pinnedNow : Reflect.get(target, key, receiver)),
});

// Per test, so a test that fakes or restores timers itself can't move the next one off TEST_NOW.
beforeEach(() => {
  offsetMs = TEST_NOW - RealDate.now();
  globalThis.Date = PinnedDate;
});

// Testing Library only auto-cleans with test globals; this suite imports from "vitest" explicitly. Fake timers a test
// left on go too, so the next test starts with real ones.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  globalThis.Date = RealDate;
});
