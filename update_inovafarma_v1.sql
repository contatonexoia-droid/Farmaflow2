-- ============================================================================
-- MIGRAÇÃO OFICIAL: INTEGRAÇÃO API PÚBLICA E-COMMERCE V1 INOVAFARMA (PORTAL PS)
-- Execute este script no SQL Editor do Supabase
-- ============================================================================

-- 1. Colunas de configuração, credenciais seguras, cache de token (30 dias) e watermarks na tabela `tenants`
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS erp_type TEXT DEFAULT 'inovafarma',
  ADD COLUMN IF NOT EXISTS erp_url TEXT DEFAULT 'https://integracao.portalps.app',
  ADD COLUMN IF NOT EXISTS erp_base_url TEXT DEFAULT 'https://integracao.portalps.app',
  ADD COLUMN IF NOT EXISTS erp_route_id TEXT DEFAULT 'homologacao',
  ADD COLUMN IF NOT EXISTS erp_cnpj TEXT,
  ADD COLUMN IF NOT EXISTS erp_login TEXT,
  ADD COLUMN IF NOT EXISTS erp_password TEXT,
  ADD COLUMN IF NOT EXISTS erp_api_login TEXT,
  ADD COLUMN IF NOT EXISTS erp_api_password TEXT,
  ADD COLUMN IF NOT EXISTS erp_api_key TEXT,
  ADD COLUMN IF NOT EXISTS erp_access_token TEXT,
  ADD COLUMN IF NOT EXISTS erp_token_expiration TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_product_sync TEXT,
  ADD COLUMN IF NOT EXISTS last_customer_sync TEXT,
  ADD COLUMN IF NOT EXISTS ignore_erp_prices BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS integration_token TEXT;

-- 2. Colunas de mapeamento de produtos do ERP (`CODIGOPRODUTO` e `UNIDADEMEDIDA`) na tabela `products`
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS internal_code TEXT,
  ADD COLUMN IF NOT EXISTS erp_product_id BIGINT,
  ADD COLUMN IF NOT EXISTS unit_measure VARCHAR(3) DEFAULT 'UN';

CREATE INDEX IF NOT EXISTS idx_products_tenant_internal_code
  ON public.products (tenant_id, internal_code);

CREATE INDEX IF NOT EXISTS idx_products_tenant_barcode
  ON public.products (tenant_id, barcode);

-- 3. Colunas de envio (`POST /Venda`) e conciliação (`GET /vendaporid`) na tabela `orders`
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS codigo_venda_online TEXT,
  ADD COLUMN IF NOT EXISTS codigo_venda_inova BIGINT,
  ADD COLUMN IF NOT EXISTS numero_nota_fiscal BIGINT,
  ADD COLUMN IF NOT EXISTS chave_acesso_nota_fiscal TEXT,
  ADD COLUMN IF NOT EXISTS valor_nota_fiscal NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS divergencia_nota_fiscal BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_orders_codigo_venda_online
  ON public.orders (tenant_id, codigo_venda_online);

-- 4. Tabela de logs de auditoria da integração ERP/PDV (`integration_logs`)
CREATE TABLE IF NOT EXISTS public.integration_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  payload JSONB,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_logs_tenant_created
  ON public.integration_logs (tenant_id, created_at DESC);

-- 5. Recarrega o cache de schema do PostgREST / Supabase API
NOTIFY pgrst, 'reload schema';
