"use client";

import QRCode from "qrcode";
import { useMemo } from "react";

/**
 * The otpauth:// URL as a QR code, drawn as one SVG path from the qrcode module matrix (no canvas, no injected
 * markup). Dark modules on a white quiet zone so every authenticator app can read it.
 */
export function QrCode({ value, label, size = 200 }: { value: string; label: string; size?: number }) {
  const { path, count } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
    const n = qr.modules.size;
    let d = "";
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (qr.modules.get(row, col)) d += `M${col} ${row}h1v1h-1z`;
      }
    }
    return { path: d, count: n };
  }, [value]);

  const quiet = 4;
  const box = count + quiet * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`${-quiet} ${-quiet} ${box} ${box}`}
      shapeRendering="crispEdges"
      className="rounded-md border border-line"
    >
      <rect x={-quiet} y={-quiet} width={box} height={box} className="fill-surface" />
      <path d={path} className="fill-ink-900" />
    </svg>
  );
}
