import { describe, expect, it, vi } from "vitest";
import { exportRecord } from "@/test/financeFixtures";
import { EXPORT_REPORTS, ExportStillRunning, exportFilters, waitForExport } from "./exports";

describe("exportFilters", () => {
  it("leaves out what is not set and sends flags as 1", () => {
    expect(exportFilters({ status: "", from: "2026-11-01", phone: undefined, needs_review: true, unresolved: false, list: [], statuses: ["matched"] })).toEqual({
      from: "2026-11-01",
      needs_review: 1,
      statuses: ["matched"],
    });
  });
});

describe("reports and formats", () => {
  it("offers the VAT summary as a PDF too, and the other reports as Excel and CSV", () => {
    expect(EXPORT_REPORTS.vat_summary).toEqual(["xlsx", "csv", "pdf"]);
    for (const [report, formats] of Object.entries(EXPORT_REPORTS)) if (report !== "vat_summary") expect(formats).toEqual(["xlsx", "csv"]);
    expect(Object.keys(EXPORT_REPORTS)).toHaveLength(9);
  });
});

describe("waitForExport", () => {
  const sleeps: number[] = [];
  const sleep = (ms: number) => {
    sleeps.push(ms);
    return Promise.resolve();
  };

  it("polls every 2 seconds until the file is ready", async () => {
    sleeps.length = 0;
    const read = vi
      .fn()
      .mockResolvedValueOnce(exportRecord({ status: "running" }))
      .mockResolvedValueOnce(exportRecord({ status: "ready" }));
    const done = await waitForExport(exportRecord({ status: "queued" }), { read, sleep });
    expect(done.status).toBe("ready");
    expect(sleeps).toEqual([2000, 2000]);
    expect(read).toHaveBeenCalledWith(7);
  });

  it("returns a failed or expired export without polling again", async () => {
    const read = vi.fn();
    expect((await waitForExport(exportRecord({ status: "failed", failure_code: "too_large" }), { read, sleep })).status).toBe("failed");
    expect(read).not.toHaveBeenCalled();
  });

  it("gives up after 3 minutes and says the file is still being prepared", async () => {
    let clock = 0;
    const read = vi.fn().mockResolvedValue(exportRecord({ status: "running" }));
    await expect(
      waitForExport(exportRecord({ status: "queued" }), {
        read,
        sleep: () => {
          clock += 2_000;
          return Promise.resolve();
        },
        now: () => clock,
      }),
    ).rejects.toBeInstanceOf(ExportStillRunning);
    expect(read.mock.calls.length).toBe(90);
  });

  it("stops when the page that asked has gone", async () => {
    const read = vi.fn().mockResolvedValue(exportRecord({ status: "running" }));
    await expect(waitForExport(exportRecord({ status: "queued" }), { read, sleep, signal: { aborted: true } })).rejects.toBeInstanceOf(ExportStillRunning);
    expect(read).not.toHaveBeenCalled();
  });
});
