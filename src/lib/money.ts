// Money arrives from the API as integer fils (spec §4.2). Latin digits in both locales (D-13).
export function formatAed(fils: number, locale: string): string {
  const aed = fils / 100;
  const amount = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Number.isInteger(aed) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(aed);
  return locale === "ar" ? `${amount} د.إ` : `AED ${amount}`;
}
