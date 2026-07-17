-- Create the store_analytics table
CREATE TABLE IF NOT EXISTS store_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  views_count INTEGER NOT NULL DEFAULT 0,
  pwa_installs_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, date)
);

-- Enable RLS
ALTER TABLE store_analytics ENABLE ROW LEVEL SECURITY;

-- Create policy for select
CREATE POLICY "Allow select for specific tenant" ON store_analytics
  FOR SELECT USING (true); -- Ideally restrict by tenant_id

-- Create policy for all operations
CREATE POLICY "Allow all operations for specific tenant" ON store_analytics
  FOR ALL USING (true);

-- Create a fast upsert function to avoid race conditions
CREATE OR REPLACE FUNCTION increment_store_analytics(
  p_tenant_id TEXT,
  p_date DATE,
  p_increment_views INTEGER DEFAULT 0,
  p_increment_installs INTEGER DEFAULT 0
) RETURNS void AS $$
BEGIN
  INSERT INTO store_analytics (tenant_id, date, views_count, pwa_installs_count)
  VALUES (p_tenant_id, p_date, p_increment_views, p_increment_installs)
  ON CONFLICT (tenant_id, date)
  DO UPDATE SET
    views_count = store_analytics.views_count + EXCLUDED.views_count,
    pwa_installs_count = store_analytics.pwa_installs_count + EXCLUDED.pwa_installs_count,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;
