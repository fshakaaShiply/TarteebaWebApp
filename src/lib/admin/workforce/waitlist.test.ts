import { describe, expect, it } from "vitest";
import { waitlistEntry } from "@/test/workforceFixtures";
import { CUSTOMER_STATES, customerStateKey, entryPhase, isOpen, NOTIFY_BLOCKED_REASONS, notifyAction, notifyBody, statusParams, waitlistHref, WAITLIST_STATUS_CHOICES } from "./waitlist";

describe("waitlist page (waitlist §7.1)", () => {
  it("sends the API's default for no choice, one status for a chip and every status for All", () => {
    expect(statusParams("")).toEqual(["open"]);
    expect(statusParams("open")).toEqual(["open"]);
    expect(statusParams("converted")).toEqual(["converted"]);
    expect(statusParams("all")).toEqual(["waiting", "notified", "converted", "expired", "cancelled"]);
    expect(WAITLIST_STATUS_CHOICES).toContain("all");
  });

  it("says what a request is now from its status, its offer and why it closed", () => {
    expect(entryPhase(waitlistEntry())).toBe("waiting");
    expect(entryPhase(waitlistEntry({ status: "notified", offer: { state: "live", expires_at: "2026-10-23T12:35:00+00:00", offered_at: null, offered_by: null } }))).toBe("live");
    expect(entryPhase(waitlistEntry({ offers_count: 1, offer: { state: "lapsed", expires_at: null, offered_at: null, offered_by: null } }))).toBe("lapsed");
    expect(entryPhase(waitlistEntry({ status: "converted", closed_reason: "booked" }))).toBe("booked");
    expect(entryPhase(waitlistEntry({ status: "expired", closed_reason: "cutoff" }))).toBe("ended");
    expect(entryPhase(waitlistEntry({ status: "cancelled", closed_reason: "customer_left" }))).toBe("left");
    expect(entryPhase(waitlistEntry({ status: "cancelled", closed_reason: "account_closed" }))).toBe("closed");
    expect(isOpen(waitlistEntry())).toBe(true);
    expect(isOpen(waitlistEntry({ status: "converted" }))).toBe(false);
  });

  it("offers Notify now, or Notify again over a live offer, and nothing for a closed request", () => {
    expect(notifyAction(waitlistEntry())).toEqual({ mode: "notify", blocked: null, enabled: true });
    const live = waitlistEntry({ status: "notified", offer: { state: "live", expires_at: "2026-10-23T12:35:00+00:00", offered_at: null, offered_by: null } });
    expect(notifyAction(live)).toEqual({ mode: "again", blocked: null, enabled: true });
    expect(notifyAction(waitlistEntry({ status: "expired" }))).toBeNull();
  });

  it("disables the offer with the API's reason, never deciding it itself", () => {
    for (const reason of NOTIFY_BLOCKED_REASONS) {
      expect(notifyAction(waitlistEntry({ actions: { notify: false, notify_blocked_reason: reason } }))).toEqual({ mode: "notify", blocked: reason, enabled: false });
    }
  });

  it("forces only an offer sent from Notify again (P5-L32)", () => {
    expect(notifyBody("notify")).toEqual({ force: false });
    expect(notifyBody("again")).toEqual({ force: true });
  });

  it("links the capacity view's slot to its open requests of that day, zone and slot", () => {
    expect(waitlistHref("2026-10-26", 3, 13)).toBe("/admin/waitlist?date_from=2026-10-26&date_to=2026-10-26&zone_id=3&slot_template_id=13&status=open");
  });

  it("words the customer's account state from a known list, never the API's token", () => {
    expect(customerStateKey("active")).toBeNull();
    expect(customerStateKey("deleted")).toBeNull();
    expect(customerStateKey("blocked")).toBe("blocked");
    expect(customerStateKey("pending_deletion")).toBe("pending_deletion");
    expect(customerStateKey("suspended")).toBe("other");
    expect(CUSTOMER_STATES).toEqual(["blocked", "pending_deletion", "other"]);
  });
});
