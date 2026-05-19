-- CreateTable
CREATE TABLE "auto_live_market_anchors" (
    "market" TEXT NOT NULL,
    "anchor_price" DECIMAL(30,12) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auto_live_market_anchors_pkey" PRIMARY KEY ("market")
);
