import { createHmac } from "node:crypto";

/**
 * Assinatura HTTP CoinEx v2: `METHOD` + `request_path` + `body` + `timestamp`.
 * `request_path` deve incluir o prefixo `/v2` (ex.: `/v2/assets/spot/balance`).
 */
export function coinexV2SignHex(
  secretKey: string,
  method: string,
  requestPath: string,
  body: string,
  timestampMs: string,
): string {
  const prepared = `${method.toUpperCase()}${requestPath}${body}${timestampMs}`;
  return createHmac("sha256", secretKey).update(prepared, "utf8").digest("hex").toLowerCase();
}
