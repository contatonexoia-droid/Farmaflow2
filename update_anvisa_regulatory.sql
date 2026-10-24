-- ============================================================
-- SCRIPT DE ATUALIZAÇÃO DO BANCO DE DADOS (SUPABASE)
-- FarmaFlow - Conformidade Anvisa (RDC 44/2009) e Agente de IA
-- ============================================================

-- 1. Dados Regulatórios e Farmacêuticos (Anvisa RDC 44/2009)
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS razao_social TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS cnpj TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS farmaceutico_responsavel TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS crf TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS horario_funcionamento TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS telefone_contato TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- 2. Campos de Endereço Estruturado (Prevenção de contaminação de CEP)
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS logradouro TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS numero TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS complemento TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS bairro TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS cidade TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS uf TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS cep TEXT;

-- 3. Configurações do Módulo de Inteligência Artificial
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS is_ai_agent_enabled BOOLEAN DEFAULT true;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS ai_agent_config JSONB DEFAULT '{}'::jsonb;

-- 4. Horários de Funcionamento Estruturados por Dia da Semana
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS opening_time_weekdays TEXT DEFAULT '07:00';
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS closing_time_weekdays TEXT DEFAULT '23:00';
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS opening_time_saturdays TEXT DEFAULT '07:00';
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS closing_time_saturdays TEXT DEFAULT '23:00';
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS opening_time_sundays TEXT DEFAULT '07:00';
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS closing_time_sundays TEXT DEFAULT '21:00';
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS closed_on_sundays BOOLEAN DEFAULT false;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS is_24_hours BOOLEAN DEFAULT false;

-- 5. Recarrega o cache do PostgREST para aplicar as alterações imediatamente
NOTIFY pgrst, 'reload schema';

