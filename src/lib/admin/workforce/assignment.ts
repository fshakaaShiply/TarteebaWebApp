/*
 * Why a cleaner leaves a visit (workforce §2.7, P5-W06): the codes staff choose when they replace or unassign her, in the
 * order the select lists them. `visit_closed` is written by the system when a booking is cancelled and is never offered
 * (the API answers 422 for it). Without a code the API stores `other`, but the dialogs ask for one so the reason is a
 * fact the workforce figures can use (a `worker_unavailable` release counts as an absence).
 */
export const RELEASE_REASON_CODES = ["worker_unavailable", "worker_late", "operational", "customer_request", "other"] as const;
