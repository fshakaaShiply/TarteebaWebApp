// Name set in type until the approved SVG logo is delivered (design-system README: never trace the logo).
export function Wordmark({ inverted = false }: { inverted?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span aria-hidden className={`relative size-9 rounded-md ${inverted ? "bg-surface" : "bg-petrol-700"}`}>
        <span className="absolute end-1.5 top-1.5 size-2 rounded-pill bg-apricot-400" />
        <span
          className={`absolute bottom-2 start-2 h-3 w-4 rounded-t-sm ${inverted ? "bg-petrol-700" : "bg-surface"}`}
        />
      </span>
      <span className="flex flex-col leading-none">
        <span className={`font-arabic text-xl font-bold ${inverted ? "text-white" : "text-petrol-700"}`}>ترتيبة</span>
        <span className={`font-latin text-[11px] font-semibold tracking-wide ${inverted ? "text-sage-300" : "text-ink-600"}`}>
          Tarteeba
        </span>
      </span>
    </span>
  );
}
