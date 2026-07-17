-- Habilitar extensão pg_trgm (Trigramas) para busca parcial robusta de termos pequenos ("Vitamina C")
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Índices GIN com gin_trgm_ops garantem que os fallbacks ILIKE / LIKE '%c%' 
-- consertem as pesquisas e não façam full-table scan (performance mantida).
CREATE INDEX IF NOT EXISTS idx_products_name_trgm 
ON products USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_products_desc_trgm 
ON products USING gin (description gin_trgm_ops);

-- Criação de um índice para busca textual (FTS) tradicional, para quando não há termos curtos
-- Assumindo idioma 'portuguese' por padrão para a farmácia local.
CREATE INDEX IF NOT EXISTS idx_products_name_fts
ON products USING GIN (to_tsvector('portuguese', name));

CREATE INDEX IF NOT EXISTS idx_products_desc_fts
ON products USING GIN (to_tsvector('portuguese', description));
