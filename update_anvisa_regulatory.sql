-- update_anvisa_regulatory.sql
-- Adiciona colunas para conformidade Anvisa RDC 44/2009 e LGPD na tabela de lojas/tenants

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS razao_social TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS cnpj TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS farmaceutico_responsavel TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS crf TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS horario_funcionamento TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS telefone_contato TEXT;

-- Atualizar o cache de esquema do PostgREST
NOTIFY pgrst, 'reload schema';
