// Money arrives from the API as integer fils (spec §4.2). Latin digits in both locales (D-13).
// Everything here uses integer math on fils: never multiply or divide AED amounts as floats.

const FILS_PER_AED = 100;

/**
 * "AED 120" / "120 د.إ" (whole dirhams without decimals), or with `fixed` always two decimals: "AED 120.00" /
 * "120.00 د.إ", the form of decision P2-35 and of the printed tax documents (A09 finance uses it).
 */
export function formatAed(fils: number, locale: string, { fixed = false }: { fixed?: boolean } = {}): string {
  const negative = fils < 0;
  const abs = Math.abs(fils);
  const whole = Math.floor(abs / FILS_PER_AED);
  const rest = abs % FILS_PER_AED;
  const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(whole);
  const amount = `${negative ? "-" : ""}${grouped}${rest === 0 && !fixed ? "" : `.${String(rest).padStart(2, "0")}`}`;
  return locale === "ar" ? `${amount} د.إ` : `AED ${amount}`;
}

/** Fils as the plain AED string an input shows: 12050 → "120.50", 12000 → "120.00". No grouping, no currency. */
export function filsToAedInput(fils: number | null | undefined): string {
  if (fils === null || fils === undefined || !Number.isSafeInteger(fils)) return "";
  const negative = fils < 0;
  const abs = Math.abs(fils);
  return `${negative ? "-" : ""}${Math.floor(abs / FILS_PER_AED)}.${String(abs % FILS_PER_AED).padStart(2, "0")}`;
}

export type AedParseError = "empty" | "invalid" | "precision" | "negative" | "too_large";
export type AedParseResult = { ok: true; fils: number } | { ok: false; error: AedParseError };

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EASTERN_ARABIC_INDIC = "۰۱۲۳۴۵۶۷۸۹";

/** Arabic-Indic digits and separators typed on an Arabic keyboard become Latin digits and ".". */
export function normalizeDigits(input: string): string {
  let out = "";
  for (const ch of input) {
    const a = ARABIC_INDIC.indexOf(ch);
    const e = EASTERN_ARABIC_INDIC.indexOf(ch);
    if (a >= 0) out += String(a);
    else if (e >= 0) out += String(e);
    else if (ch === "٫") out += ".";
    else if (ch === "٬") out += ",";
    else out += ch;
  }
  return out;
}

/**
 * Parses what an admin typed in an AED field into integer fils without float math:
 * "120" → 12000, "120.5" → 12050, "1,200.75" → 120075, "٤٥٠٠" → 450000.
 * At most two decimals; negative amounts are refused unless `allowNegative`.
 */
export function parseAedToFils(input: string, options: { allowNegative?: boolean } = {}): AedParseResult {
  const raw = normalizeDigits(input).trim().replace(/\s+/g, "");
  if (raw === "") return { ok: false, error: "empty" };

  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  if (negative && !options.allowNegative) return { ok: false, error: "negative" };

  // Thousands separators are only accepted in groups of three ("1,200", not "12,00").
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d*))?$/.exec(unsigned);
  if (!match || (match[1] === undefined && (match[2] === undefined || match[2] === ""))) {
    return { ok: false, error: "invalid" };
  }

  const wholeDigits = (match[1] ?? "0").replace(/,/g, "");
  const fraction = match[2] ?? "";
  if (fraction.length > 2) return { ok: false, error: "precision" };

  // Keep the whole part in range before converting: 15 digits of AED stay a safe integer in fils.
  const wholeTrimmed = wholeDigits.replace(/^0+(?=\d)/, "");
  if (wholeTrimmed.length > 13) return { ok: false, error: "too_large" };

  const fils = Number(wholeTrimmed) * FILS_PER_AED + Number(fraction.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(fils)) return { ok: false, error: "too_large" };

  return { ok: true, fils: negative && fils !== 0 ? -fils : fils };
}
