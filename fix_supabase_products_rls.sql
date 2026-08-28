-- ==============================================================================
-- FARMAFLOW: DESBLOQUEIO DE RLS E PERMISSÕES DA TABELA PRODUCTS NO SUPABASE
-- ==============================================================================
-- Este script corrige o erro 42501 (row-level security policy violation / HTTP 403)
-- liberando a importação em massa e operações de produtos para a sua farmácia.
--
-- COMO APLICAR:
-- 1. Abra o painel do seu projeto no Supabase (https://supabase.com/dashboard)
-- 2. Vá no menu lateral esquerdo em "SQL Editor"
-- 3. Crie uma "New Query", cole todo o conteúdo deste arquivo e clique em "Run".
-- ==============================================================================

-- 1. Garantir que todas as colunas necessárias existam na tabela products
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS internal_code TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS active_principle TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS drug_type TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS price NUMERIC DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS original_price NUMERIC DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock NUMERIC DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Geral';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS manufacturer TEXT DEFAULT 'Outros';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS presentation TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS indications TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS requires_prescription BOOLEAN DEFAULT FALSE;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS promotion_type TEXT DEFAULT 'NONE';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS buy_x NUMERIC DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS pay_y NUMERIC DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_ai_enriched BOOLEAN DEFAULT FALSE;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS grouping_slug TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS variant_attribute TEXT DEFAULT '';

-- 2. Configurar Índices para Alta Performance na Importação e Busca
CREATE INDEX IF NOT EXISTS idx_products_tenant_id ON public.products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_internal_code ON public.products(internal_code);

-- 3. Habilitar RLS e Configurar Políticas Sem Bloqueios
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Remover políticas antigas restritivas
DROP POLICY IF EXISTS "Public Read on products" ON public.products;
DROP POLICY IF EXISTS "Tenant can insert products" ON public.products;
DROP POLICY IF EXISTS "Tenant can update products" ON public.products;
DROP POLICY IF EXISTS "Tenant can delete products" ON public.products;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.products;
DROP POLICY IF EXISTS "Enable insert for all users" ON public.products;
DROP POLICY IF EXISTS "Enable update for all users" ON public.products;
DROP POLICY IF EXISTS "Enable delete for all users" ON public.products;
DROP POLICY IF EXISTS "Allow all for products" ON public.products;
DROP POLICY IF EXISTS "Allow all operations for anon and authenticated on products" ON public.products;

-- Criar política unificada com permissão total para anon, authenticated e service_role
CREATE POLICY "Allow all operations for anon and authenticated on products"
ON public.products
FOR ALL
TO anon, authenticated, service_role
USING (true)
WITH CHECK (true);

-- 4. Conceder permissões (GRANT)
GRANT ALL ON TABLE public.products TO anon;
GRANT ALL ON TABLE public.products TO authenticated;
GRANT ALL ON TABLE public.products TO service_role;

-- 5. Garantir permissões na tabela integration_logs (utilizada pelo relatório de importação)
CREATE TABLE IF NOT EXISTS public.integration_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT,
    endpoint TEXT,
    payload JSONB,
    status TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.integration_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on integration_logs" ON public.integration_logs;

CREATE POLICY "Allow all on integration_logs"
ON public.integration_logs
FOR ALL
TO anon, authenticated, service_role
USING (true)
WITH CHECK (true);

GRANT ALL ON TABLE public.integration_logs TO anon;
GRANT ALL ON TABLE public.integration_logs TO authenticated;
GRANT ALL ON TABLE public.integration_logs TO service_role;
