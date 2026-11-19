import type { StatusTone } from "@/components/admin";
import { isIsoDate } from "../format";
import type { DocumentFields } from "./endpoints";
import type { DocumentState, DocumentType, WorkerDocument } from "./types";

/*
 * A05 worker documents (workforce §3.1, §5.1): the form model mirroring StoreWorkerDocumentRequest and
 * UpdateWorkerDocumentRequest, and the expiry chip. The API checks everything again; its 422 messages land on the same
 * fields. The number is private: the API answers only its last characters, so an edit never shows the stored number and
 * an empty field keeps it.
 */

export const DOCUMENT_TYPES = ["residency", "emirates_id", "work_permit", "passport", "medical", "insurance", "contract", "other"] as const satisfies readonly DocumentType[];

/** config workforce.documents.mimes and max_kb (10 MB). heic is accepted by the API. */
export const DOCUMENT_FILE_ACCEPT = ["application/pdf", ".pdf", "image/jpeg", ".jpg", ".jpeg", "image/png", ".png", "image/webp", ".webp", "image/heic", ".heic"] as const;
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
/** SetWorkerPhotoRequest: jpg, png or webp up to 2048 KB. */
export const PHOTO_FILE_ACCEPT = ["image/jpeg", ".jpg", ".jpeg", "image/png", ".png", "image/webp", ".webp"] as const;
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

export const documentTone: Record<DocumentState, StatusTone> = { valid: "success", expiring: "pending", expired: "danger", no_expiry: "neutral" };

export type DocumentForm = {
  type: string;
  title: string;
  number: string;
  clearNumber: boolean;
  issued_at: string;
  expires_at: string;
  alert_days_before: string;
  notes: string;
};

export type DocumentErrorKey = "typeRequired" | "titleRequired" | "titleLength" | "numberLength" | "dateInvalid" | "expiryBeforeIssue" | "alertDays" | "notesLength" | "fileRequired";
export type DocumentErrors = Partial<Record<keyof DocumentForm | "file", DocumentErrorKey>>;

export function emptyDocumentForm(): DocumentForm {
  return { type: "", title: "", number: "", clearNumber: false, issued_at: "", expires_at: "", alert_days_before: "", notes: "" };
}

/** The edit form of a document: everything but the private number. */
export function documentFormFrom(doc: WorkerDocument): DocumentForm {
  return {
    type: doc.type,
    title: doc.title ?? "",
    number: "",
    clearNumber: false,
    issued_at: doc.issued_at ?? "",
    expires_at: doc.expires_at ?? "",
    alert_days_before: String(doc.alert_days_before),
    notes: doc.notes ?? "",
  };
}

/** A renewal starts from the document it replaces: its type, title and alert window; dates and number are new. */
export function renewalFormFrom(doc: WorkerDocument): DocumentForm {
  return { ...emptyDocumentForm(), type: doc.type, title: doc.title ?? "", alert_days_before: String(doc.alert_days_before) };
}

/** Only a current document that nothing renewed yet can be renewed. */
export function canRenew(doc: WorkerDocument): boolean {
  return doc.archived_at === null && doc.superseded_by_id === null;
}

export function isArchived(doc: WorkerDocument): boolean {
  return doc.archived_at !== null;
}

type Validated = { ok: true; fields: DocumentFields } | { ok: false; errors: DocumentErrors };

/**
 * Checks the form the way the request does and returns the fields to send. `fileChosen` matters on create only (a
 * file is optional in the API, but the screen asks for it: a document without its scan is a gap HR meant to fill).
 */
export function validateDocumentForm(form: DocumentForm, options: { requireFile: boolean; fileChosen: boolean }): Validated {
  const errors: DocumentErrors = {};
  if (!(DOCUMENT_TYPES as readonly string[]).includes(form.type)) errors.type = "typeRequired";
  const title = form.title.trim();
  if (form.type === "other" && title === "") errors.title = "titleRequired";
  else if (title.length > 100) errors.title = "titleLength";
  const number = form.number.trim();
  if (number.length > 50) errors.number = "numberLength";
  if (form.issued_at !== "" && !isIsoDate(form.issued_at)) errors.issued_at = "dateInvalid";
  if (form.expires_at !== "" && !isIsoDate(form.expires_at)) errors.expires_at = "dateInvalid";
  if (!errors.issued_at && !errors.expires_at && form.issued_at !== "" && form.expires_at !== "" && form.expires_at < form.issued_at) errors.expires_at = "expiryBeforeIssue";
  const alert = form.alert_days_before.trim();
  if (alert !== "" && !(/^\d{1,3}$/.test(alert) && Number(alert) >= 1 && Number(alert) <= 365)) errors.alert_days_before = "alertDays";
  if (form.notes.length > 1000) errors.notes = "notesLength";
  if (options.requireFile && !options.fileChosen) errors.file = "fileRequired";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    fields: {
      type: form.type,
      title: title === "" ? null : title,
      number: number === "" ? null : number,
      issued_at: form.issued_at === "" ? null : form.issued_at,
      expires_at: form.expires_at === "" ? null : form.expires_at,
      alert_days_before: alert === "" ? null : Number(alert),
      notes: form.notes.trim() === "" ? null : form.notes.trim(),
    },
  };
}

/**
 * The PATCH body for an edit: only the fields that differ from the stored document, so nothing is sent for a change of
 * nothing (the API keeps the version then too). A typed number replaces the stored one, "Remove the number" clears it
 * (`null`), an empty field keeps it. An archived document takes its notes only.
 */
export function documentPatch(doc: WorkerDocument, fields: DocumentFields, form: DocumentForm): Partial<DocumentFields> {
  const patch: Partial<DocumentFields> = {};
  if ((fields.notes ?? null) !== (doc.notes ?? null)) patch.notes = fields.notes ?? null;
  if (isArchived(doc)) return patch;
  if ((fields.title ?? null) !== (doc.title ?? null)) patch.title = fields.title ?? null;
  if ((fields.issued_at ?? null) !== (doc.issued_at ?? null)) patch.issued_at = fields.issued_at ?? null;
  if ((fields.expires_at ?? null) !== (doc.expires_at ?? null)) patch.expires_at = fields.expires_at ?? null;
  if (fields.alert_days_before !== null && fields.alert_days_before !== undefined && fields.alert_days_before !== doc.alert_days_before) patch.alert_days_before = fields.alert_days_before;
  if (form.clearNumber) patch.number = null;
  else if ((fields.number ?? null) !== null) patch.number = fields.number;
  return patch;
}

/** "•••• 4821" for the number's last characters (rendered inside an LTR run); null when the document has none. */
export function maskedNumber(last4: string | null | undefined): string | null {
  return last4 ? `•••• ${last4}` : null;
}

/** The title of an `other` document, else the type's label from the API. */
export function documentTitle(doc: Pick<WorkerDocument, "type" | "title" | "type_label">, locale: string): string {
  if (doc.type === "other" && doc.title) return doc.title;
  return locale === "ar" ? doc.type_label.ar : doc.type_label.en;
}
