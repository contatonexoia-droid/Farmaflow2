-- Tabela para armazenar as regras de taxa de entrega dinâmica por KM
CREATE TABLE IF NOT EXISTS delivery_fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  min_km NUMERIC NOT NULL,
  max_km NUMERIC NOT NULL,
  fee NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Garante que o min_km seja menor que o max_km
  CONSTRAINT check_min_max_km CHECK (min_km < max_km)
);

-- Indice para buscas rápidas por tenant
CREATE INDEX IF NOT EXISTS idx_delivery_fees_tenant ON delivery_fees(tenant_id);
