import { Decimal } from "../../shared/decimal.js";
import type { MarketSpec } from "./market-spec.types.js";
import { OrderRejectedMinAmountError, OrderRejectedMinValueError } from "./market-spec.types.js";

type D = InstanceType<typeof Decimal>;

export function floorBaseAmount(amount: D, spec: MarketSpec): D {
  return amount.toDecimalPlaces(spec.basePrecision, Decimal.ROUND_FLOOR);
}

export function floorQuoteValue(value: D, spec: MarketSpec): D {
  return value.toDecimalPlaces(spec.quotePrecision, Decimal.ROUND_FLOOR);
}

export function floorPrice(price: D, spec: MarketSpec): D {
  return price.toDecimalPlaces(spec.quotePrecision, Decimal.ROUND_FLOOR);
}

export function assertValidOrderAmount(amount: D, price: D, spec: MarketSpec): void {
  if (amount.lte(0)) {
    throw new OrderRejectedMinAmountError("quantidade base <= 0");
  }
  const minB = new Decimal(spec.minAmount || "0");
  if (minB.gt(0) && amount.lt(minB)) {
    throw new OrderRejectedMinAmountError(
      `quantidade ${amount.toFixed()} < min_amount ${spec.minAmount}`,
    );
  }
  if (spec.minValue != null && spec.minValue !== "") {
    const minV = new Decimal(spec.minValue);
    const notional = amount.mul(price);
    if (notional.lt(minV)) {
      throw new OrderRejectedMinValueError(
        `notional ${notional.toFixed()} < min_value ${spec.minValue}`,
      );
    }
  }
}
