-- ==============================================================================
-- AGRUPAMENTO INTELIGENTE DE PRODUTOS (VARIAÇÕES)
-- Execute este script no SQL Editor do Supabase
-- ==============================================================================

-- 1. Adicionando as colunas necessárias para agrupar Fraldas, Cosméticos e Outros
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS grouping_slug TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS variant_attribute TEXT DEFAULT '';

-- 2. Índice para buscar rapidamente produtos do mesmo grupo (Carrossel Rápido)
CREATE INDEX IF NOT EXISTS idx_products_grouping_slug ON public.products(grouping_slug);

-- Notas de Manutenção Opcional:
-- Se precisar rodar no Supabase, basta colar as linhas acima.
-- Elas permitem criar os slugs como 'fralda-huggies-supreme' para o Backend
-- poder agrupar Variações de Tamanho ou Fragrância com performance total.
