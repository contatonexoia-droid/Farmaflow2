-- Add lightning_discount_percentage to promotions table
ALTER TABLE IF EXISTS promotions
ADD COLUMN IF NOT EXISTS lightning_discount_percentage NUMERIC(5,2);
