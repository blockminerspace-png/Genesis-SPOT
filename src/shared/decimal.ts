import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** CJS entry preserves static helpers like `set` under NodeNext + ESM. */
const Decimal = require("decimal.js") as typeof import("decimal.js").default;

Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -40,
  toExpPos: 40,
});

export { Decimal };
