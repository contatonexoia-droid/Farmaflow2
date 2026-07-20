-- Habilitar extensão pg_trgm (Trigramas) para busca parcial robusta de termos pequenos ("Vitamina C")
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Índices GIN com gin_trgm_ops garantem que os fallbacks ILIKE / LIKE '%c%' 
-- consertem as pesquisas e não façam full-table scan (performance mantida).
CREATE INDEX IF NOT EXISTS idx_products_name_trgm 
ON products USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_products_desc_trgm 
ON products USING gin (description gin_trgm_ops);

-- Primeiro, criamos uma função auxiliar IMMUTABLE para permitir indexação FTS sem erros de mutabilidade
CREATE OR REPLACE FUNCTION public.farmaflow_to_tsvector(text_val TEXT)
RETURNS tsvector AS $$
  SELECT to_tsvector('portuguese'::regconfig, coalesce(text_val, ''));
$$ LANGUAGE sql IMMUTABLE;

-- Criação de um índice para busca textual (FTS) tradicional, para quando não há termos curtos
-- Assumindo idioma 'portuguese' por padrão para a farmácia local.
CREATE INDEX IF NOT EXISTS idx_products_name_fts
ON products USING GIN (public.farmaflow_to_tsvector(name));

CREATE INDEX IF NOT EXISTS idx_products_desc_fts
ON products USING GIN (public.farmaflow_to_tsvector(description));
