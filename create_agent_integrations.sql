CREATE TABLE IF NOT EXISTS agent_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) UNIQUE,
  activation_token TEXT,
  machine_id TEXT,
  is_active BOOLEAN DEFAULT true,
  last_seen TIMESTAMPTZ,
  branch_code TEXT,
  view_name TEXT DEFAULT 'VW_INTEGRACAO_FARMAFLOW',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
