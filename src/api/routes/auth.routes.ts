import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Env } from "../../config/env.js";
import { jwtExpiresInToMaxAgeSec } from "../../modules/auth/jwt-cookie.util.js";
import {
  assertPasswordLoginAllowed,
  clearPasswordThrottle,
  clientIpFromRequest,
  consumeOtpAndGetEmail,
  createOtpChallengeAndEmail,
  DashboardAuthLockedError,
  isDashboardAuthEnabled,
  normalizeEmail,
  parseDashboard2faDeliverMap,
  parseDashboardUsers,
  recordPasswordFailure,
  verifyDashboardPassword,
} from "../../modules/auth/dashboard-auth.service.js";

const loginSchema = z.object({
  email: z.string().min(3).max(320),
  password: z.string().min(1).max(512),
});

const verifySchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().min(4).max(16),
});

const deliverToSchema = z.string().trim().email();

export async function authRoutes(app: FastifyInstance, opts: { env: Env }) {
  const { env } = opts;
  const users = () => parseDashboardUsers(env.DASHBOARD_USERS);
  const deliverMap = () => parseDashboard2faDeliverMap(env.DASHBOARD_2FA_DELIVER_MAP);

  app.get("/status", async () => ({
    authRequired: isDashboardAuthEnabled(env),
    otpTtlMinutes: env.DASHBOARD_OTP_TTL_MINUTES,
  }));

  app.get("/session", async (request) => {
    if (!isDashboardAuthEnabled(env)) {
      return { authRequired: false, session: true };
    }
    const raw = request.cookies[env.DASHBOARD_SESSION_COOKIE_NAME];
    if (!raw || typeof raw !== "string") {
      return { authRequired: true, session: false };
    }
    try {
      request.server.jwt.verify(raw);
      return { authRequired: true, session: true };
    } catch {
      return { authRequired: true, session: false };
    }
  });

  app.post("/logout", async (_request, reply) => {
    if (!isDashboardAuthEnabled(env)) {
      return reply.send({ ok: true });
    }
    reply.clearCookie(env.DASHBOARD_SESSION_COOKIE_NAME, { path: "/" });
    return reply.send({ ok: true });
  });

  app.post("/login", async (request, reply) => {
    if (!isDashboardAuthEnabled(env)) {
      return reply.code(503).send({ error: "dashboard_auth_disabled" });
    }
    const parsed = loginSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "payload_invalid", details: parsed.error.flatten() });
    }
    const emailNorm = normalizeEmail(parsed.data.email);
    const ip = clientIpFromRequest(request.headers, request.socket.remoteAddress);

    try {
      await assertPasswordLoginAllowed(emailNorm, ip);
    } catch (e) {
      if (e instanceof DashboardAuthLockedError) {
        return reply.code(429).send({
          error: "locked",
          lockedUntil: e.lockedUntil.toISOString(),
        });
      }
      throw e;
    }

    const ok = verifyDashboardPassword(users(), emailNorm, parsed.data.password.trim());
    if (!ok) {
      await recordPasswordFailure(env, emailNorm, ip);
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    await clearPasswordThrottle(emailNorm, ip);

    const rawLogin = parsed.data.email.trim();
    const mappedDeliver = deliverMap().get(emailNorm)?.trim();
    const deliverTo = mappedDeliver && mappedDeliver.length > 0 ? mappedDeliver : rawLogin;
    const deliverOk = deliverToSchema.safeParse(deliverTo);
    if (!deliverOk.success) {
      request.log.error(
        { emailNorm, deliverTo },
        "destino 2FA inválido (define DASHBOARD_2FA_DELIVER_MAP=login:email@valido ou usa email válido no login)",
      );
      return reply.code(503).send({ error: "email_send_failed" });
    }

    try {
      const out = await createOtpChallengeAndEmail(env, emailNorm, deliverOk.data, request.log);
      return reply.send({
        step: "otp",
        challengeId: out.challengeId,
        expiresAt: out.expiresAt,
      });
    } catch (err) {
      request.log.error({ err }, "envio 2FA por email falhou");
      return reply.code(503).send({ error: "email_send_failed" });
    }
  });

  app.post("/verify-otp", async (request, reply) => {
    if (!isDashboardAuthEnabled(env)) {
      return reply.code(503).send({ error: "dashboard_auth_disabled" });
    }
    const parsed = verifySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "payload_invalid", details: parsed.error.flatten() });
    }

    const consumed = await consumeOtpAndGetEmail(env, parsed.data.challengeId, parsed.data.code);
    if (!consumed) {
      return reply.code(401).send({ error: "invalid_otp" });
    }

    const token = await reply.jwtSign({ sub: consumed.emailNorm });
    const maxAge = jwtExpiresInToMaxAgeSec(env.DASHBOARD_JWT_EXPIRES_IN);
    reply.setCookie(env.DASHBOARD_SESSION_COOKIE_NAME, token, {
      path: "/",
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge,
    });
    return reply.send({ ok: true });
  });
}
