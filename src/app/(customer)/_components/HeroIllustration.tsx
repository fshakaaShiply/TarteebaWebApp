// Flat illustration in sage / apricot / petrol on ivory (design-system README "Iconography").
// No people: staff photos must be authorised (spec §27.6).
export function HeroIllustration() {
  return (
    <svg viewBox="0 0 480 420" role="img" aria-hidden className="h-auto w-full max-w-[480px]">
      <ellipse cx="240" cy="372" rx="210" ry="30" fill="var(--color-sage-100)" />
      <circle cx="372" cy="104" r="64" fill="var(--color-sage-300)" opacity="0.35" />
      <circle cx="96" cy="150" r="40" fill="var(--color-apricot-100)" />

      {/* house */}
      <path d="M120 200 L240 108 L360 200 Z" fill="var(--color-petrol-800)" />
      <rect x="140" y="196" width="200" height="168" rx="10" fill="var(--color-petrol-700)" />
      <rect x="224" y="268" width="56" height="96" rx="8" fill="var(--color-surface)" />
      <circle cx="268" cy="318" r="4" fill="var(--color-petrol-700)" />
      <rect x="164" y="228" width="44" height="40" rx="6" fill="var(--color-petrol-50)" />
      <rect x="296" y="228" width="28" height="40" rx="6" fill="var(--color-petrol-50)" />
      <rect x="164" y="292" width="44" height="6" rx="3" fill="var(--color-sage-300)" />

      {/* tidy stack + bucket */}
      <rect x="372" y="300" width="52" height="12" rx="6" fill="var(--color-sage-300)" />
      <rect x="378" y="286" width="40" height="12" rx="6" fill="var(--color-apricot-400)" />
      <rect x="384" y="272" width="28" height="12" rx="6" fill="var(--color-sage-100)" />
      <path d="M68 300 h48 l-6 64 h-36 z" fill="var(--color-sage-300)" />
      <path d="M72 300 q20 -26 40 0" stroke="var(--color-petrol-700)" strokeWidth="5" fill="none" strokeLinecap="round" />

      {/* sparkles */}
      <path d="M392 168 l7 18 18 7 -18 7 -7 18 -7 -18 -18 -7 18 -7 z" fill="var(--color-apricot-400)" />
      <path d="M108 72 l5 12 12 5 -12 5 -5 12 -5 -12 -12 -5 12 -5 z" fill="var(--color-apricot-400)" />
      <path d="M332 52 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3 z" fill="var(--color-sage-300)" />
    </svg>
  );
}
