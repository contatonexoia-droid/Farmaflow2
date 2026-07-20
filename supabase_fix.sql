-- EXECUTE ESTE COMANDO NO SQL EDITOR DO SUPABASE PARA CORRIGIR O ERRO:

-- 1. Adicionar a coluna de destaque na tabela de produtos
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE;

-- 2. Garantir que as colunas de fabricantes customizados existam na tabela de tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_manufacturers TEXT[];
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS manufacturer_logos JSONB;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS integration_token TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS erp_url TEXT;

-- 2.1 Criar tabela de logs de integração
CREATE TABLE IF NOT EXISTS integration_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  tenant_id TEXT,
  endpoint TEXT,
  payload JSONB,
  status TEXT,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 3. Remover colunas redundantes de imagem (Opcional, mas recomendado para performance)
-- ALTER TABLE products DROP COLUMN IF EXISTS gallery;
-- ALTER TABLE products DROP COLUMN IF EXISTS image_url_2;
-- ALTER TABLE products DROP COLUMN IF EXISTS image_url_3;

-- 4. Criar índices de busca (Full-Text Search) para alta performance
-- Primeiro, criamos uma função auxiliar IMMUTABLE para permitir indexação FTS sem erros de mutabilidade
CREATE OR REPLACE FUNCTION public.farmaflow_to_tsvector(text_val TEXT)
RETURNS tsvector AS $$
  SELECT to_tsvector('portuguese'::regconfig, coalesce(text_val, ''));
$$ LANGUAGE sql IMMUTABLE;

-- Primeiro, criamos uma coluna gerada para busca ou usamos índices individuais
CREATE INDEX IF NOT EXISTS idx_products_name_fts ON products USING gin(public.farmaflow_to_tsvector(name));
CREATE INDEX IF NOT EXISTS idx_products_active_principle_fts ON products USING gin(public.farmaflow_to_tsvector("activePrinciple"));
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_internal_code ON products("internalCode");

-- 5. Notificar o PostgREST para recarregar o esquema
NOTIFY pgrst, 'reload schema';