#!/usr/bin/env python3
"""Deploy seguro Bot Spot na VM — sem imprimir valores de .env."""
from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timezone

import paramiko

HOST = os.environ.get("GENESIS_VM_HOST", "89.167.114.67")
USER = os.environ.get("GENESIS_VM_USER", "root")
PASSWORD = os.environ.get("GENESIS_VM_PASSWORD", "")
REMOTE_DIR = "/root/genesis-spot"
COMPOSE_FILE = "docker-compose.vm.yml"
ZIP_LOCAL = os.environ.get("GENESIS_DEPLOY_ZIP", "/tmp/genesis-spot-deploy.zip")

REQUIRED_VARS = [
    "DATABASE_URL",
    "BTC_STRATEGY_ENABLED",
    "BTC_STRATEGY_MARKET",
    "BTC_ORDER_BASE_AMOUNT",
    "BTC_DROP_BUY_STEP_USDT",
    "BTC_TARGET_PROFIT_PCT",
    "ENABLE_AUTO_LIVE_WORKER",
    "AUTO_LIVE_CONFIRM_ENV",
    "COINEX_ACCESS_ID",
    "COINEX_SECRET_KEY",
]


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 600) -> tuple[int, str, str]:
    print(f"\n$ {cmd[:120]}{'…' if len(cmd) > 120 else ''}")
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    code = stdout.channel.recv_exit_status()
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    if out.strip():
        print(out.rstrip())
    if err.strip() and code != 0:
        print(err.rstrip(), file=sys.stderr)
    return code, out, err


def main() -> int:
    if not PASSWORD:
        print("ABORT: defina GENESIS_VM_PASSWORD (não commitar).", file=sys.stderr)
        return 1
    if not os.path.isfile(ZIP_LOCAL):
        print(f"ABORT: zip não encontrado: {ZIP_LOCAL}", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=60)

    rollback: dict[str, str] = {}

    # Rollback snapshot
    code, out, _ = run(client, f"docker inspect genesis-spot-app --format '{{{{.Image}}}}' 2>/dev/null || true")
    rollback["image_before"] = out.strip()
    code, out, _ = run(client, f"test -d {REMOTE_DIR}/.git && cd {REMOTE_DIR} && git rev-parse HEAD || echo no-git")
    rollback["git_before"] = out.strip()

    # Env check (OK/MISSING only)
    check_script = (
        "set -a; [ -f .env ] && . ./.env; set +a; "
        + "; ".join(
            f'if [ -n "${{{v}:-}}" ]; then echo "{v}=OK"; else echo "{v}=MISSING"; fi'
            for v in REQUIRED_VARS
        )
    )
    code, out, _ = run(client, f"cd {REMOTE_DIR} && {check_script}")
    missing = [line.split("=")[0] for line in out.splitlines() if line.endswith("=MISSING")]
    if missing:
        print(f"\nABORT: variáveis ausentes: {', '.join(missing)}")
        client.close()
        return 1

    # Backup Postgres
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup_path = f"/root/backups/backup-before-bot-spot-{ts}.sql"
    run(client, "mkdir -p /root/backups")
    code, _, err = run(
        client,
        f"docker exec genesis-spot-db pg_dump -U bot botspot > {backup_path} 2>&1 && ls -lh {backup_path}",
        timeout=300,
    )
    if code != 0:
        print("ABORT: falha no pg_dump", file=sys.stderr)
        client.close()
        return 1
    rollback["db_backup"] = backup_path

    # Upload + preserve .env
    sftp = client.open_sftp()
    sftp.put(ZIP_LOCAL, "/tmp/genesis-spot-deploy.zip")
    sftp.close()

    deploy_cmd = f"""
set -e
cd {REMOTE_DIR}
if [ -f .env ]; then cp -a .env /tmp/genesis-spot.env.bak; fi
unzip -oq /tmp/genesis-spot-deploy.zip -d {REMOTE_DIR}
if [ -f /tmp/genesis-spot.env.bak ]; then cp -a /tmp/genesis-spot.env.bak .env; fi
docker compose -f {COMPOSE_FILE} build --no-cache
docker compose -f {COMPOSE_FILE} up -d
sleep 8
docker compose -f {COMPOSE_FILE} ps
"""
    code, out, _ = run(client, deploy_cmd, timeout=1800)
    if code != 0:
        print("ABORT: build/up falhou", file=sys.stderr)
        client.close()
        return 1

    # Logs scan (no secrets)
    code, logs, _ = run(client, f"docker compose -f {REMOTE_DIR}/{COMPOSE_FILE} logs --tail=120 app 2>&1")
    critical = [
        "TypeError",
        "ReferenceError",
        "UnhandledPromiseRejection",
        "Prisma error",
        "connection refused",
        "ECONNREFUSED",
    ]
    found = [p for p in critical if p.lower() in logs.lower()]
    if found:
        print(f"ABORT: logs com erro crítico: {found}")
        client.close()
        return 1

    # Health (public)
    code, health, _ = run(
        client,
        f"docker compose -f {REMOTE_DIR}/{COMPOSE_FILE} exec -T app wget -qO- http://127.0.0.1:3000/health",
    )
    if code != 0:
        print("ABORT: /health falhou")
        client.close()
        return 1

    # Auth status
    run(
        client,
        f"docker compose -f {REMOTE_DIR}/{COMPOSE_FILE} exec -T app wget -qO- http://127.0.0.1:3000/auth/status",
    )

    # Internal smoke (bypass JWT)
    code, smoke_out, _ = run(
        client,
        f"docker compose -f {REMOTE_DIR}/{COMPOSE_FILE} exec -T app node scripts/vm-smoke-bot-spot.mjs",
        timeout=120,
    )
    try:
        smoke = json.loads(smoke_out)
    except json.JSONDecodeError:
        smoke = {}
    if smoke.get("issues"):
        print(f"ABORT: state inválido: {smoke['issues']}")
        client.close()
        return 1

    # HTTP smoke (may 401 if auth — report only)
    for path in [
        "/bot-spot/state",
        "/bot-spot/chart?interval=15m",
        "/bot-spot/cycles",
        "/bot-spot/orders",
        "/bot-spot/events",
        "/bot/config",
    ]:
        run(
            client,
            f"docker compose -f {REMOTE_DIR}/{COMPOSE_FILE} exec -T app "
            f"wget -qS -O /tmp/smoke.json http://127.0.0.1:3000{path} 2>&1 | head -5",
        )

    # Reconcile
    code, rec, _ = run(
        client,
        f"docker compose -f {REMOTE_DIR}/{COMPOSE_FILE} exec -T app "
        f"wget -qO- --post-data='{{}}' --header='Content-Type: application/json' "
        f"http://127.0.0.1:3000/bot-spot/reconcile 2>&1 | tail -5",
    )

    # Worker gate: do not enable if critical errors in reconcile or smoke
    worker_hold = bool(smoke.get("errorsCount", 0) > 3)
    if worker_hold:
        print("\nAVISO: worker LIVE não liberado automaticamente (muitos erros no state).")

    report = {
        "rollback": rollback,
        "health": health.strip()[:200],
        "smoke": smoke,
        "deploy_ok": code == 0,
        "worker_auto_release": not worker_hold,
    }
    print("\n=== RELATÓRIO ===")
    print(json.dumps(report, indent=2))
    client.close()
    return 0 if smoke.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
