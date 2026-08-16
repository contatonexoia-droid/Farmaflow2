-- Drop the table if it was created incorrectly
DROP TABLE IF EXISTS tenant_payment_gateways CASCADE;

-- Recreate the table with the correct data type for tenant_id (TEXT, matching tenants.id)
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

-- Habilitar Row Level Security (RLS)
ALTER TABLE tenant_payment_gateways ENABLE ROW LEVEL SECURITY;

-- Limpar quaisquer políticas genéricas anteriores
DROP POLICY IF EXISTS "Enable read access for all users" ON tenant_payment_gateways;
DROP POLICY IF EXISTS "Enable insert access for all users" ON tenant_payment_gateways;
DROP POLICY IF EXISTS "Enable update access for all users" ON tenant_payment_gateways;
DROP POLICY IF EXISTS "Enable delete access for all users" ON tenant_payment_gateways;
DROP POLICY IF EXISTS "Permitir gerenciamento apenas para membros do próprio tenant" ON tenant_payment_gateways;

-- Política restritiva de defesa em profundidade:
-- Apenas o próprio dono do tenant_id (fornecido via metadados do JWT de autenticação do Supabase) 
-- pode ler, inserir ou modificar suas chaves de pagamento. Desta forma o banco de dados blinda qualquer
-- acesso cruzado caso haja vazamento em camadas superiores.
-- Nota: Fallbacks como user.id ou 'tenant_id' no user_metadata podem ser necessários dependendo
-- da modelagem exata do Supabase Auth. Abaixo consideramos a abordagem mais robusta baseada no ID do usuário.

CREATE POLICY "Permitir gerenciamento apenas para membros do próprio tenant" 
ON tenant_payment_gateways
FOR ALL
USING (
  -- Caso o tenant_id da farmácia seja equivalente ao user_id do proprietário:
  tenant_id = auth.uid()::text 
  OR 
  -- Caso exista metadado do JWT
  tenant_id = (auth.jwt() ->> 'user_metadata')::jsonb ->> 'tenant_id'
);
