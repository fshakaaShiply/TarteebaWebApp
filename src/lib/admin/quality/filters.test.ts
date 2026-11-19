import { describe, expect, it } from "vitest";
import { filtersFromParams, filtersToParams } from "../finance/filters";
import { CASE_FILTERS, COMPENSATION_FILTERS, RATING_FILTERS, assigneeParam, caseQuery, compensationQuery, customerParam, ratingQuery, statusParam } from "./filters";

const parse = <S extends Parameters<typeof filtersFromParams>[0]>(spec: S, query: string) => filtersFromParams(spec, new URLSearchParams(query));

describe("A10 URL filters", () => {
  it("keep the API's own parameter names and drop what a URL got wrong", () => {
    const filters = parse(CASE_FILTERS, "status=resolved&priority=urgent&assignee=me&sla=breached&awaiting_approval=1&sort=created&type=bogus&worker_id=abc&page=3");
    expect(filters).toMatchObject({ status: "resolved", priority: "urgent", assignee: "me", sla: "breached", awaiting_approval: "1", sort: "created", type: "", worker_id: "", page: 3 });
    expect(filtersToParams(CASE_FILTERS, filters).toString()).toBe("status=resolved&priority=urgent&assignee=me&sla=breached&awaiting_approval=1&sort=created&page=3");
  });

  it("send the active cases by default, one status, or all five", () => {
    expect(statusParam("")).toBeUndefined();
    expect(statusParam("resolved")).toEqual(["resolved"]);
    expect(statusParam("all")).toEqual(["open", "in_review", "awaiting_customer", "resolved", "closed"]);
    expect(statusParam("nope")).toBeUndefined();
  });

  it("read an assignee as me, unassigned or a staff id, and a customer as a ULID", () => {
    expect(["me", "unassigned", "14", "0", "x", "1;2"].map(assigneeParam)).toEqual(["me", "unassigned", "14", undefined, undefined, undefined]);
    expect(customerParam("01jc0000000000000000000001")).toBe("01JC0000000000000000000001");
    expect(customerParam("14")).toBeUndefined();
  });

  it("build the inbox query: flags as true only when set, links by id", () => {
    const filters = parse(CASE_FILTERS, "q=lila&category=billing&customer_replied=1&zone_id=2&worker_id=1&customer_id=01JC0000000000000000000001&assignee=9");
    expect(caseQuery(filters, "lila", 25)).toEqual({
      page: 1,
      perPage: 25,
      q: "lila",
      type: undefined,
      status: undefined,
      priority: undefined,
      category: "billing",
      assignee: "9",
      sla: undefined,
      awaitingApproval: false,
      customerReplied: true,
      sort: undefined,
      from: undefined,
      to: undefined,
      workerId: 1,
      zoneId: 2,
      customerId: "01JC0000000000000000000001",
    });
  });

  it("build the queue's query: waiting for approval by default, every state on request", () => {
    expect(compensationQuery(parse(COMPENSATION_FILTERS, ""), 25).status).toBeUndefined();
    expect(compensationQuery(parse(COMPENSATION_FILTERS, "status=failed&type=refund"), 25)).toMatchObject({ status: ["failed"], type: "refund" });
    expect(compensationQuery(parse(COMPENSATION_FILTERS, "status=all"), 25).status).toHaveLength(5);
  });

  it("build the ratings query", () => {
    const filters = parse(RATING_FILTERS, "low=1&has_comment=1&kind=live_out_day&from=2026-10-01&to=2026-10-20&q=TRB");
    expect(ratingQuery(filters, "TRB", 25)).toMatchObject({ low: true, excluded: false, hasComment: true, kind: "live_out_day", from: "2026-10-01", to: "2026-10-20", q: "TRB" });
  });
});
