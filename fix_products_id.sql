-- =================================================================================
-- Correção: Geração de ID Automático na tabela Products
-- =================================================================================
ALTER TABLE public.products 
ALTER COLUMN id SET DEFAULT gen_random_uuid();
