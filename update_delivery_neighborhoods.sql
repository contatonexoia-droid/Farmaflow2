-- ==============================================================================
-- FARMAFLOW - MIGRAÇÃO SQL: ATUALIZAÇÃO DA MODALIDADE DE TAXA POR BAIRRO
-- Execute este script no SQL Editor do Supabase (Dashboard > SQL Editor)
-- ==============================================================================

-- 1. Garante que a coluna JSONB delivery_settings existe na tabela tenants com estrutura padrão
ALTER TABLE public.tenants 
ADD COLUMN IF NOT EXISTS delivery_settings JSONB DEFAULT '{
  "enabled": false,
  "delivery_fee_type": "fixed",
  "fee": 0,
  "minOrderForFreeDelivery": 0,
  "neighborhoods": [],
  "defaultNeighborhoodFee": 0,
  "ranges": []
}'::jsonb;

-- 2. Atualiza os tenants existentes que porventura tenham delivery_settings nulo
UPDATE public.tenants
SET delivery_settings = '{
  "enabled": false,
  "delivery_fee_type": "fixed",
  "fee": 0,
  "minOrderForFreeDelivery": 0,
  "neighborhoods": [],
  "defaultNeighborhoodFee": 0,
  "ranges": []
}'::jsonb
WHERE delivery_settings IS NULL;

-- 3. Tabela relacional dedicada para Bairros de Entrega (caso deseje gerenciar via tabela)
CREATE TABLE IF NOT EXISTS public.delivery_neighborhoods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  fee NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  estimated_time TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Evita cadastro de bairros com nomes duplicados para a mesma drogaria
  CONSTRAINT unique_tenant_neighborhood UNIQUE (tenant_id, name)
);

-- 4. Índices para performance em consultas do checkout e do Agente WhatsApp
CREATE INDEX IF NOT EXISTS idx_delivery_neighborhoods_tenant 
  ON public.delivery_neighborhoods(tenant_id);

CREATE INDEX IF NOT EXISTS idx_delivery_neighborhoods_active 
  ON public.delivery_neighborhoods(tenant_id, active);

CREATE INDEX IF NOT EXISTS idx_tenants_delivery_settings_gin 
  ON public.tenants USING gin (delivery_settings);

-- 5. Habilitar Row Level Security (RLS)
ALTER TABLE public.delivery_neighborhoods ENABLE ROW LEVEL SECURITY;

-- 6. Políticas de RLS para delivery_neighborhoods
-- Leitura pública para a loja virtual consultar os bairros e taxas ativas
DROP POLICY IF EXISTS "Permitir leitura pública dos bairros" ON public.delivery_neighborhoods;
CREATE POLICY "Permitir leitura pública dos bairros"
  ON public.delivery_neighborhoods
  FOR SELECT
  TO public
  USING (true);

-- Inserção, atualização e exclusão para usuários autenticados / service role
DROP POLICY IF EXISTS "Permitir gerenciamento de bairros autenticados" ON public.delivery_neighborhoods;
CREATE POLICY "Permitir gerenciamento de bairros autenticados"
  ON public.delivery_neighborhoods
  FOR ALL
  TO authenticated, service_role
  USING (true)
  WITH CHECK (true);

-- 7. Função e Trigger para atualizar automaticamente o updated_at
CREATE OR REPLACE FUNCTION public.handle_delivery_neighborhoods_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_delivery_neighborhoods_updated_at ON public.delivery_neighborhoods;
CREATE TRIGGER trg_delivery_neighborhoods_updated_at
  BEFORE UPDATE ON public.delivery_neighborhoods
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_delivery_neighborhoods_updated_at();

-- 8. Recarregar o cache de esquemas do PostgREST para surtir efeito imediato nas APIs
NOTIFY pgrst, 'reload schema';
