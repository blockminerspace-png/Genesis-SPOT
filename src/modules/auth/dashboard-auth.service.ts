import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import type { FastifyBaseLogger } from "fastify";
import type { Env } from "../../config/env.js";
import { prisma } from "../../infrastructure/database/prisma.js";

export function isDashboardAuthEnabled(env: Env): boolean {
  return env.DASHBOARD_AUTH_ENABLED;
}

export function parseDashboardUsers(raw: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const seg of raw.split("|")) {
    const s = seg.trim();
    if (!s) continue;
    const idx = s.indexOf(":");
    if (idx <= 0) continue;
    const email = s.slice(0, idx).trim().toLowerCase();
    const password = s.slice(idx + 1).trim();
    if (email && password) m.set(email, password);
  }
  return m;
}

/** `loginNorm:destino@email.com|outroLogin:outro@email.com` — só o destinatário do 2FA. */
export function parseDashboard2faDeliverMap(raw: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const seg of raw.split("|")) {
    const s = seg.trim();
    if (!s) continue;
    const idx = s.indexOf(":");
    if (idx <= 0) continue;
    const loginNorm = s.slice(0, idx).trim().toLowerCase();
    const deliverTo = s.slice(idx + 1).trim();
    if (loginNorm && deliverTo) m.set(loginNorm, deliverTo);
  }
  return m;
}

function sha256utf8(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

export function verifyDashboardPassword(users: Map<string, string>, emailNorm: string, password: string): boolean {
  const expected = users.get(emailNorm);
  if (!expected) return false;
  const a = sha256utf8(password);
  const b = sha256utf8(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function normalizeEmail(email: string): string {
  return String(email).trim().toLowerCase();
}

export function clientIpFromRequest(
  headers: Record<string, string | string[] | undefined>,
  socketAddr: string | undefined,
): string {
  const xff = headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    return xff.split(",")[0].trim().slice(0, 128);
  }
  return (socketAddr || "unknown").slice(0, 128);
}

export class DashboardAuthLockedError extends Error {
  readonly code = "LOCKED" as const;
  readonly lockedUntil: Date;

  constructor(lockedUntil: Date) {
    super("Conta temporariamente bloqueada por tentativas falhadas.");
    this.name = "DashboardAuthLockedError";
    this.lockedUntil = lockedUntil;
  }
}

export async function assertPasswordLoginAllowed(emailNorm: string, ip: string): Promise<void> {
  const row = await prisma.dashboardPasswordThrottle.findUnique({
    where: { emailNorm_ip: { emailNorm, ip } },
  });
  if (!row) return;
  if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
    throw new DashboardAuthLockedError(row.lockedUntil);
  }
  if (row.lockedUntil && row.lockedUntil.getTime() <= Date.now()) {
    await prisma.dashboardPasswordThrottle.update({
      where: { emailNorm_ip: { emailNorm, ip } },
      data: { lockedUntil: null, failCount: 0 },
    });
  }
}

export async function recordPasswordFailure(env: Env, emailNorm: string, ip: string): Promise<void> {
  const lockMs = env.DASHBOARD_LOCKOUT_MINUTES * 60_000;
  const maxFails = env.DASHBOARD_PASSWORD_MAX_FAILS;
  const row = await prisma.dashboardPasswordThrottle.upsert({
    where: { emailNorm_ip: { emailNorm, ip } },
    create: { emailNorm, ip, failCount: 1 },
    update: { failCount: { increment: 1 } },
  });
  if (row.failCount >= maxFails) {
    await prisma.dashboardPasswordThrottle.update({
      where: { emailNorm_ip: { emailNorm, ip } },
      data: { lockedUntil: new Date(Date.now() + lockMs) },
    });
  }
}

export async function clearPasswordThrottle(emailNorm: string, ip: string): Promise<void> {
  await prisma.dashboardPasswordThrottle.deleteMany({ where: { emailNorm, ip } });
}

function otpCodeHash(code: string): string {
  return createHash("sha256").update(code.trim(), "utf8").digest("hex");
}

export async function createOtpChallengeAndEmail(
  env: Env,
  emailNorm: string,
  deliverToEmail: string,
  log: FastifyBaseLogger,
): Promise<{ challengeId: string; expiresAt: string }> {
  await prisma.dashboardOtpChallenge.deleteMany({
    where: { emailNorm, consumedAt: null },
  });

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const codeHash = otpCodeHash(code);
  const expiresAt = new Date(Date.now() + env.DASHBOARD_OTP_TTL_MINUTES * 60_000);

  const row = await prisma.dashboardOtpChallenge.create({
    data: { emailNorm, codeHash, expiresAt },
  });

  if (env.SMTP_HOST.trim().toLowerCase() === "console") {
    log.warn(
      {
        kind: "dashboard_2fa_console",
        emailNorm,
        challengeId: row.id,
        deliverTo: deliverToEmail.trim(),
      },
      `[Genesis SPOT] código 2FA (SMTP_HOST=console): ${code} — válido ${env.DASHBOARD_OTP_TTL_MINUTES} min; olha o terminal do servidor.`,
    );
    return { challengeId: row.id, expiresAt: expiresAt.toISOString() };
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 15_000,
  });

  await transporter.sendMail({
    from: env.SMTP_FROM,
    to: deliverToEmail.trim(),
    subject: env.DASHBOARD_2FA_EMAIL_SUBJECT,
    text:
      `Código de verificação Genesis SPOT: ${code}\n\n` +
      `Válido por ${env.DASHBOARD_OTP_TTL_MINUTES} minutos. Se não foste tu, ignora este email.`,
  });

  return { challengeId: row.id, expiresAt: expiresAt.toISOString() };
}

export async function consumeOtpAndGetEmail(
  env: Env,
  challengeId: string,
  code: string,
): Promise<{ emailNorm: string } | null> {
  const challenge = await prisma.dashboardOtpChallenge.findUnique({
    where: { id: challengeId },
  });
  if (!challenge || challenge.consumedAt) return null;
  if (challenge.expiresAt.getTime() < Date.now()) return null;
  if (challenge.otpAttempts >= env.DASHBOARD_OTP_MAX_ATTEMPTS) return null;

  const expectedHex = Buffer.from(challenge.codeHash, "hex");
  const gotHex = Buffer.from(otpCodeHash(code), "hex");
  const match = expectedHex.length === gotHex.length && timingSafeEqual(expectedHex, gotHex);

  if (!match) {
    await prisma.dashboardOtpChallenge.update({
      where: { id: challenge.id },
      data: { otpAttempts: { increment: 1 } },
    });
    return null;
  }

  await prisma.dashboardOtpChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });

  return { emailNorm: challenge.emailNorm };
}
