import { useId } from "react";

type Props = {
  size?: number;
  className?: string;
};

/**
 * Marca do produto: placa arredondada + “gráfico” ascendente (não é o diamante ◈ antigo).
 */
export function BrandLogo({ size = 52, className = "" }: Props) {
  const uid = useId().replace(/:/g, "");
  const p = `gs-${uid}`;

  return (
    <svg
      className={`brand-logo-svg ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${p}-plate`} x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0f172a" />
          <stop offset="1" stopColor="#1e293b" />
        </linearGradient>
        <linearGradient id={`${p}-ring`} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#22d3ee" />
          <stop offset="0.45" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#818cf8" />
        </linearGradient>
        <linearGradient id={`${p}-bar`} x1="24" y1="36" x2="24" y2="10" gradientUnits="userSpaceOnUse">
          <stop stopColor="#e0f2fe" />
          <stop offset="1" stopColor="#38bdf8" />
        </linearGradient>
        <filter id={`${p}-glow`} x="-35%" y="-35%" width="170%" height="170%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="1.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* anel exterior em gradiente */}
      <rect x="1" y="1" width="46" height="46" rx="14" fill={`url(#${p}-ring)`} />
      {/* interior escuro */}
      <rect x="2.5" y="2.5" width="43" height="43" rx="12.5" fill={`url(#${p}-plate)`} stroke="#334155" strokeOpacity="0.65" strokeWidth="0.75" />
      {/* linha de tendência */}
      <path
        d="M11 32 L18.5 24 L26 28 L37 14"
        stroke={`url(#${p}-bar)`}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#${p}-glow)`}
        opacity="0.95"
      />
      {/* barras volume (silhueta nova vs diamante) */}
      <rect x="11" y="30" width="5" height="10" rx="1.5" fill="#64748b" fillOpacity="0.85" />
      <rect x="18.5" y="25" width="5" height="15" rx="1.5" fill={`url(#${p}-bar)`} fillOpacity="0.75" />
      <rect x="26" y="19" width="5" height="21" rx="1.5" fill={`url(#${p}-bar)`} />
      <rect x="33.5" y="22" width="5" height="18" rx="1.5" fill="#22d3ee" fillOpacity="0.9" />
      {/* ponto no topo da tendência */}
      <circle cx="37" cy="14" r="3" fill="#f0f9ff" stroke="#38bdf8" strokeWidth="1.2" />
    </svg>
  );
}
