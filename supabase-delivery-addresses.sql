-- Create delivery addresses history table
CREATE TABLE delivery_addresses (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    whatsapp VARCHAR(20) NOT NULL,
    customer_name VARCHAR(100) NOT NULL,
    cep VARCHAR(20) NOT NULL,
    street VARCHAR(150) NOT NULL,
    number VARCHAR(20),
    neighborhood VARCHAR(100) NOT NULL,
    city VARCHAR(100) NOT NULL,
    complement VARCHAR(150),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, whatsapp) -- Ensures one latest address per WhatsApp per tenant
);

-- Index for fast lookup by tenant and whatsapp
CREATE INDEX idx_delivery_addresses_lookup ON delivery_addresses(tenant_id, whatsapp);

-- RLS policies for security and isolation
ALTER TABLE delivery_addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access to delivery_addresses"
    ON delivery_addresses
    FOR ALL
    USING (true)
    WITH CHECK (true);
