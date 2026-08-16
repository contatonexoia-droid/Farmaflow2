CREATE TABLE IF NOT EXISTS flash_deals_schedules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  promotion_id TEXT REFERENCES promotions(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL, -- 'DAILY', 'WEEKLY', 'MONTHLY'
  days_of_week INTEGER[], -- 0=Domingo, 1=Segunda, ..., 6=Sábado
  days_of_month INTEGER[], -- 1-31
  start_time TIME NOT NULL, -- '15:00:00'
  end_time TIME NOT NULL,   -- '16:30:00'
  start_date TIMESTAMP WITH TIME ZONE,
  end_date TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- RLS
ALTER TABLE flash_deals_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Select Flash Deals Schedules" ON flash_deals_schedules;
CREATE POLICY "Public Select Flash Deals Schedules" ON flash_deals_schedules FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Public Insert Flash Deals Schedules" ON flash_deals_schedules;
CREATE POLICY "Public Insert Flash Deals Schedules" ON flash_deals_schedules FOR INSERT TO public WITH CHECK (true);

DROP POLICY IF EXISTS "Public Update Flash Deals Schedules" ON flash_deals_schedules;
CREATE POLICY "Public Update Flash Deals Schedules" ON flash_deals_schedules FOR UPDATE TO public USING (true);

DROP POLICY IF EXISTS "Public Delete Flash Deals Schedules" ON flash_deals_schedules;
CREATE POLICY "Public Delete Flash Deals Schedules" ON flash_deals_schedules FOR DELETE TO public USING (true);
