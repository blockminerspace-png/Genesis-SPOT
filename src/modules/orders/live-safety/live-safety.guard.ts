import type { FastifyBaseLogger } from "fastify";
import type { Env } from "../../../config/env.js";
import { Decimal } from "../../../shared/decimal.js";
import { getMarketDataService } from "../../market-data/market-data.service.js";
import { getMarketSpecService } from "../../market-data/market-spec.service.js";
import { assertValidOrderAmount, floorBaseAmount, floorPrice } from "../../market-data/market-spec.rounding.js";
import type { MarketTickerSnapshot } from "../../market-data/market-data-provider.interface.js";
import type { MarketSpec } from "../../market-data/market-spec.types.js";
import type { RuntimePermission } from "../../runtime/runtime-state.types.js";
import { getLiveDailyQuoteNotional } from "../live-daily-quote-volume.js";
import { getSpotBalancesForLiveGuard } from "../live-coinex-balance-snapshot.js";
import type { AssetBalance } from "../../portfolio/balance.types.js";

export type LivePrecheckCheck = { name: string; ok: boolean; detail?: string };

export type LivePlacePrecheckResult = {
  valid: boolean;
  checks: LivePrecheckCheck[];
  flooredAmount: string;
  flooredPrice: string;
  quoteValue: string;
  spec?: MarketSpec;
  error?: string;
};

function push(checks: LivePrecheckCheck[], name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
  return ok;
}

function parseAllowlist(env: Env): string[] {
  return env.LIVE_MARKET_ALLOWLIST.split(",")
    .map((s: string) => s.trim().toUpperCase())
    .filter(Boolean);
}

function pickBalance(balances: AssetBalance[], asset: string): AssetBalance | null {
  const a = asset.toUpperCase();
  return balances.find((b) => b.asset.toUpperCase() === a) ?? null;
}

export async function runLivePlacePrecheck(
  env: Env,
  log: FastifyBaseLogger,
  p: RuntimePermission,
  input: { market: string; side: "BUY" | "SELL"; amount: string; price: string },
  options?: { maxQuotePerOrder?: string; skipMakerOnlyHint?: boolean },
): Promise<LivePlacePrecheckResult> {
  const checks: LivePrecheckCheck[] = [];
  const market = input.market.toUpperCase();
  const maxQuote = options?.maxQuotePerOrder ?? env.LIVE_MAX_ORDER_QUOTE_VALUE;

  if (!push(checks, "enable_live_trading", env.ENABLE_LIVE_TRADING, env.ENABLE_LIVE_TRADING ? undefined : "false")) {
    return { valid: false, checks, flooredAmount: "", flooredPrice: "", quoteValue: "", error: "ENABLE_LIVE_TRADING=false" };
  }

  if (!push(checks, "execution_layer_live", p.executionLayer === "LIVE", `layer=${p.executionLayer}`)) {
    return { valid: false, checks, flooredAmount: "", flooredPrice: "", quoteValue: "", error: "execution_layer !== LIVE" };
  }

  if (!push(checks, "runtime_running", p.runtimeStatus === "RUNNING", `status=${p.runtimeStatus}`)) {
    return { valid: false, checks, flooredAmount: "", flooredPrice: "", quoteValue: "", error: "runtime_status !== RUNNING" };
  }

  const keysOk = Boolean(env.COINEX_ACCESS_ID && env.COINEX_SECRET_KEY);
  if (!push(checks, "coinex_keys", keysOk)) {
    return { valid: false, checks, flooredAmount: "", flooredPrice: "", quoteValue: "", error: "chaves CoinEx" };
  }

  const allow = parseAllowlist(env);
  if (!push(checks, "market_allowlist", allow.includes(market), allow.join(","))) {
    return { valid: false, checks, flooredAmount: "", flooredPrice: "", quoteValue: "", error: "mercado fora da allowlist" };
  }

  if (!push(checks, "market_data_source_coinex", env.MARKET_DATA_SOURCE === "COINEX")) {
    return {
      valid: false,
      checks,
      flooredAmount: "",
      flooredPrice: "",
      quoteValue: "",
      error: "MARKET_DATA_SOURCE deve ser COINEX para ordens LIVE",
    };
  }

  let tickerMeta: { snap: MarketTickerSnapshot; fetchedAtMs: number };
  try {
    tickerMeta = await getMarketDataService().getTickerWithFetchMeta(market);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    push(checks, "fresh_ticker", false, msg);
    return { valid: false, checks, flooredAmount: "", flooredPrice: "", quoteValue: "", error: msg };
  }

  const tickAge = Date.now() - tickerMeta.fetchedAtMs;
  const tickFresh = tickAge <= env.LIVE_MARKET_DATA_MAX_AGE_MS && tickerMeta.snap.priceSource === "COINEX";
  if (
    !push(
      checks,
      "fresh_ticker",
      tickFresh,
      `ageMs=${tickAge} source=${tickerMeta.snap.priceSource}`,
    )
  ) {
    return { valid: false, checks, flooredAmount: "", flooredPrice: "", quoteValue: "", error: "ticker não fresco ou não CoinEx" };
  }

  const { spec, fetchedAtMs: specFetched } = await getMarketSpecService().getSpecWithFetchedAt(market);
  const specAge = Date.now() - specFetched;
  const specFresh = specAge <= env.LIVE_MARKET_SPEC_MAX_AGE_MS && spec.source === "COINEX";
  if (!push(checks, "fresh_market_spec", specFresh, `ageMs=${specAge} source=${spec.source}`)) {
    return { valid: false, checks, flooredAmount: "", flooredPrice: "", quoteValue: "", error: "market spec inválido ou velho" };
  }

  if (!push(checks, "trading_enabled", spec.tradingEnabled)) {
    return { valid: false, checks, flooredAmount: "", flooredPrice: "", quoteValue: "", error: "mercado offline" };
  }
  if (!push(checks, "api_trading_enabled", spec.apiTradingEnabled)) {
    return { valid: false, checks, flooredAmount: "", flooredPrice: "", quoteValue: "", error: "API trading off" };
  }

  let balMeta: { balances: AssetBalance[]; fetchedAtMs: number };
  try {
    balMeta = await getSpotBalancesForLiveGuard(env, log, env.LIVE_BALANCE_MAX_AGE_MS);
    push(checks, "coinex_balance_fetch", true);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    push(checks, "fresh_balance", false, msg);
    return { valid: false, checks, flooredAmount: "", flooredPrice: "", quoteValue: "", error: msg };
  }
  const balAge = Date.now() - balMeta.fetchedAtMs;
  if (!push(checks, "balance_max_age", balAge <= env.LIVE_BALANCE_MAX_AGE_MS, `ageMs=${balAge}`)) {
    return { valid: false, checks, flooredAmount: "", flooredPrice: "", quoteValue: "", error: "saldo CoinEx velho" };
  }

  const a0 = new Decimal(input.amount);
  const p0 = new Decimal(input.price);
  const flooredAmount = floorBaseAmount(a0, spec).toFixed(spec.basePrecision);
  const flooredPrice = floorPrice(p0, spec).toFixed(spec.quotePrecision);
  const quoteValue = new Decimal(flooredAmount).mul(new Decimal(flooredPrice)).toFixed(spec.quotePrecision);

  try {
    assertValidOrderAmount(new Decimal(flooredAmount), new Decimal(flooredPrice), spec);
    push(checks, "min_amount_value", true);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    push(checks, "min_amount_value", false, msg);
    return { valid: false, checks, flooredAmount, flooredPrice, quoteValue, spec, error: msg };
  }

  const maxQ = new Decimal(maxQuote);
  const qv = new Decimal(quoteValue);
  if (!push(checks, "max_order_quote_value", qv.lte(maxQ), `${quoteValue} <= ${maxQ.toFixed()}`)) {
    return {
      valid: false,
      checks,
      flooredAmount,
      flooredPrice,
      quoteValue,
      spec,
      error: "quoteValue acima do máximo por ordem",
    };
  }

  const daily = getLiveDailyQuoteNotional();
  const nextTotal = new Decimal(daily.total).plus(qv);
  if (!push(checks, "max_daily_quote_volume", nextTotal.lte(new Decimal(env.LIVE_MAX_DAILY_QUOTE_VOLUME)), daily.total)) {
    return {
      valid: false,
      checks,
      flooredAmount,
      flooredPrice,
      quoteValue,
      spec,
      error: "limite diário de volume (quote) excedido",
    };
  }

  if (env.LIVE_REQUIRE_MAKER_ONLY && !options?.skipMakerOnlyHint) {
    const last = new Decimal(tickerMeta.snap.last);
    const px = new Decimal(flooredPrice);
    const makerSideOk =
      input.side === "BUY" ? px.lt(last) : px.gt(last);
    if (!push(checks, "maker_only_hint", makerSideOk, `last=${tickerMeta.snap.last} price=${flooredPrice}`)) {
      return {
        valid: false,
        checks,
        flooredAmount,
        flooredPrice,
        quoteValue,
        spec,
        error: "LIVE_REQUIRE_MAKER_ONLY: preço limite não favorece lado maker",
      };
    }
  }

  if (input.side === "BUY") {
    const quoteBal = pickBalance(balMeta.balances, spec.quoteCurrency);
    const need = new Decimal(quoteValue);
    const availStr = quoteBal?.available ?? "0";
    const avail = new Decimal(availStr);
    const ok = quoteBal ? avail.gte(need) : false;
    const detail = quoteBal
      ? `${spec.quoteCurrency} disponível=${availStr} necessário≈${quoteValue} (notional ordem)`
      : `${spec.quoteCurrency} sem linha no snapshot CoinEx (ativos devolvidos: ${balMeta.balances.map((b) => b.asset).join(",") || "—"})`;
    if (!push(checks, "balance_buy_quote", ok, detail)) {
      return {
        valid: false,
        checks,
        flooredAmount,
        flooredPrice,
        quoteValue,
        spec,
        error: `saldo ${spec.quoteCurrency} insuficiente (${detail})`,
      };
    }
  } else {
    const base = pickBalance(balMeta.balances, spec.baseCurrency);
    const need = new Decimal(flooredAmount);
    const availStr = base?.available ?? "0";
    const avail = new Decimal(availStr);
    const ok = base ? avail.gte(need) : false;
    const detail = base
      ? `${spec.baseCurrency} disponível=${availStr} necessário=${flooredAmount}`
      : `${spec.baseCurrency} sem linha no snapshot (ativos: ${balMeta.balances.map((b) => b.asset).join(",") || "—"})`;
    if (!push(checks, "balance_sell_base", ok, detail)) {
      return {
        valid: false,
        checks,
        flooredAmount,
        flooredPrice,
        quoteValue,
        spec,
        error: `saldo ${spec.baseCurrency} insuficiente (${detail})`,
      };
    }
  }

  return { valid: true, checks, flooredAmount, flooredPrice, quoteValue, spec };
}
