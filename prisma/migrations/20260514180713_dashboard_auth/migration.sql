-- CreateTable
CREATE TABLE "dashboard_otp_challenges" (
    "id" UUID NOT NULL,
    "email_norm" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "otp_attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_password_throttle" (
    "id" UUID NOT NULL,
    "email_norm" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "fail_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "dashboard_password_throttle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dashboard_otp_challenges_email_norm_created_at_idx" ON "dashboard_otp_challenges"("email_norm", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_password_throttle_email_norm_ip_key" ON "dashboard_password_throttle"("email_norm", "ip");
