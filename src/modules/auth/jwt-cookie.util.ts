/** Converte `expiresIn` estilo JWT (`8h`, `15m`, `3600s`) em segundos para `Set-Cookie` Max-Age. */
export function jwtExpiresInToMaxAgeSec(expiresIn: string): number {
  const s = expiresIn.trim().toLowerCase().replace(/\s+/g, "");
  const m = /^(\d+)([smhd])$/.exec(s);
  if (!m) return 28_800;
  const n = Number(m[1]);
  const u = m[2] as "s" | "m" | "h" | "d";
  const mult = u === "s" ? 1 : u === "m" ? 60 : u === "h" ? 3600 : 86400;
  const sec = n * mult;
  return Math.min(Math.max(120, sec), 365 * 86400);
}
