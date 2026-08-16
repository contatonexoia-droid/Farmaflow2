CREATE TABLE IF NOT EXISTS tenant_payment_gateways (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
    gateway_name VARCHAR(50) NOT NULL, -- 'stripe', 'picpay', 'infinitepay', 'mercado_pago'
    is_active BOOLEAN DEFAULT false,
    credentials JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, gateway_name)
);

ALTER TABLE tenant_payment_gateways ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for all users" ON tenant_payment_gateways;
CREATE POLICY "Enable read access for all users" ON tenant_payment_gateways FOR SELECT USING (true);

DROP POLICY IF EXISTS "Enable insert access for all users" ON tenant_payment_gateways;
CREATE POLICY "Enable insert access for all users" ON tenant_payment_gateways FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update access for all users" ON tenant_payment_gateways;
CREATE POLICY "Enable update access for all users" ON tenant_payment_gateways FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete access for all users" ON tenant_payment_gateways;
CREATE POLICY "Enable delete access for all users" ON tenant_payment_gateways FOR DELETE USING (true);
