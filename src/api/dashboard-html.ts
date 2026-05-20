import path from "node:path";
import { readFile } from "node:fs/promises";
import type { FastifyReply, FastifyRequest } from "fastify";

const dashboardIndexPath = () => path.join(process.cwd(), "public", "dashboard", "index.html");

/** Rotas React do Bot Spot (shell HTML; JSON fica em /state, /events, etc.). */
export function isBotSpotSpaShellPath(pathname: string): boolean {
  if (pathname === "/bot-spot") return true;
  return /^\/bot-spot\/(chart|cycles|orders|settings|debug)$/.test(pathname);
}

export function requestWantsDashboardHtml(request: FastifyRequest): boolean {
  const dest = request.headers["sec-fetch-dest"];
  if (dest === "document") return true;
  const accept = String(request.headers.accept ?? "").toLowerCase();
  if (!accept.includes("text/html")) return false;
  if (accept.includes("application/json") && !accept.includes("text/html")) return false;
  return true;
}

export async function sendDashboardIndex(reply: FastifyReply) {
  try {
    const html = await readFile(dashboardIndexPath(), "utf8");
    return reply
      .header("Cache-Control", "no-store, max-age=0")
      .type("text/html; charset=utf-8")
      .send(html);
  } catch {
    return reply
      .code(503)
      .type("text/html; charset=utf-8")
      .send(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Genesis SPOT</title></head><body><p>Dashboard não compilado.</p></body></html>",
      );
  }
}
