import type { Env } from "../../config/env.js";
import type { LiveCycleSummary, LiveCycleWorkerStatus } from "./live-cycle.types.js";

function iso(ms: number | null): string | null {
  if (ms === null) return null;
  return new Date(ms).toISOString();
}

const emptyChecks = (): LiveCycleSummary["checks"] => [];

let summary: LiveCycleSummary = {
  status: "DISABLED",
  enabledByEnv: false,
  lastTickAt: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null,
  consecutiveErrors: 0,
  circuitOpenUntil: null,
  lastDecision: null,
  checks: emptyChecks(),
};

let circuitOpenUntilMs = 0;
let lastDisabledEventMs = 0;
let lastBlockedEventMs = 0;
let lastBlockFingerprint: string | null = null;

export function getLiveCycleSummary(): LiveCycleSummary {
  return {
    ...summary,
    checks: summary.checks.map((c) => ({ ...c })),
    circuitOpenUntil: iso(circuitOpenUntilMs > Date.now() ? circuitOpenUntilMs : null),
  };
}

export function resetLiveCycleCircuitBreaker(): void {
  circuitOpenUntilMs = 0;
  summary.consecutiveErrors = 0;
  summary.lastError = null;
  summary.circuitOpenUntil = null;
  summary.status = "RUNNING";
}

export function isLiveCycleCircuitOpen(): boolean {
  return Date.now() < circuitOpenUntilMs;
}

export function openLiveCycleCircuit(env: Env): void {
  circuitOpenUntilMs = Date.now() + env.AUTO_LIVE_CIRCUIT_BREAKER_COOLDOWN_MS;
  summary.circuitOpenUntil = iso(circuitOpenUntilMs);
  summary.status = "CIRCUIT_OPEN";
}

export function bumpLiveCycleConsecutiveError(): void {
  summary.consecutiveErrors += 1;
}

export function resetLiveCycleConsecutiveErrors(): void {
  summary.consecutiveErrors = 0;
}

export function setLiveCycleSummaryPatch(
  patch: Partial<Omit<LiveCycleSummary, "checks">> & { checks?: LiveCycleSummary["checks"] },
): void {
  summary = {
    ...summary,
    ...patch,
    checks: patch.checks ?? summary.checks,
  };
}

export function recordLiveCycleTickStart(enabledByEnv: boolean): void {
  summary.lastTickAt = new Date().toISOString();
  summary.enabledByEnv = enabledByEnv;
}

export function recordLiveCycleSuccess(): void {
  summary.lastSuccessAt = new Date().toISOString();
  summary.lastError = null;
  resetLiveCycleConsecutiveErrors();
}

export function recordLiveCycleError(message: string, status: LiveCycleWorkerStatus = "ERROR"): void {
  summary.lastErrorAt = new Date().toISOString();
  summary.lastError = message;
  summary.status = status;
  bumpLiveCycleConsecutiveError();
}

export function maybeEmitDisabledThrottle(nowMs: number): boolean {
  if (nowMs - lastDisabledEventMs > 300_000) {
    lastDisabledEventMs = nowMs;
    return true;
  }
  return false;
}

/** Emite LIVE_CYCLE_WORKER_BLOCKED no máximo ~1x / 60s por fingerprint de checks falhadas. */
export function shouldEmitBlockedEvent(nowMs: number, fingerprint: string): boolean {
  if (fingerprint !== lastBlockFingerprint || nowMs - lastBlockedEventMs > 60_000) {
    lastBlockFingerprint = fingerprint;
    lastBlockedEventMs = nowMs;
    return true;
  }
  return false;
}
