ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "delivery_mode" TEXT DEFAULT 'delivery';
