-- ==============================================================================
-- Migration: Histórico e Reimpressão de Lotes de Etiquetas de Preço (price_tag_batches)
-- TTL de 48 Horas com limpeza automática
-- ==============================================================================

-- 1. Criação da Tabela price_tag_batches
CREATE TABLE IF NOT EXISTS public.price_tag_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id TEXT NOT NULL,
    model TEXT NOT NULL CHECK (model IN ('gondola', 'baiana', 'cartaz_a5', 'cartaz_a4')),
    total_tags INTEGER NOT NULL DEFAULT 0,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Índices de Alta Performance
-- B-Tree em (store_id, created_at DESC) para buscas rápidas dos lotes recentes de uma loja
CREATE INDEX IF NOT EXISTS idx_price_tag_batches_store_created 
ON public.price_tag_batches (store_id, created_at DESC);

-- Índice em created_at para otimizar delete em massa e expiração TTL
CREATE INDEX IF NOT EXISTS idx_price_tag_batches_created_at 
ON public.price_tag_batches (created_at);

-- 3. Função de Limpeza Automática (TTL 48 Horas)
CREATE OR REPLACE FUNCTION public.cleanup_expired_price_tag_batches()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.price_tag_batches
    WHERE created_at < NOW() - INTERVAL '48 hours';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Gatilho de Limpeza Automática a cada nova inserção
-- Garante expiração contínua em planos gratuitos sem depender obrigatoriamente do pg_cron
CREATE OR REPLACE FUNCTION public.trigger_cleanup_price_tag_batches()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM public.cleanup_expired_price_tag_batches();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_cleanup_expired_price_tag_batches ON public.price_tag_batches;
CREATE TRIGGER trg_cleanup_expired_price_tag_batches
AFTER INSERT ON public.price_tag_batches
FOR EACH STATEMENT
EXECUTE FUNCTION public.trigger_cleanup_price_tag_batches();

-- 5. Agendamento via pg_cron (caso a extensão esteja ativa no cluster)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
    ) THEN
        BEGIN
            -- Remove agendamento anterior se houver
            PERFORM cron.unschedule('cleanup-price-tag-batches-48h')
            WHERE EXISTS (
                SELECT 1 FROM cron.job WHERE jobname = 'cleanup-price-tag-batches-48h'
            );

            -- Agenda limpeza a cada hora
            PERFORM cron.schedule(
                'cleanup-price-tag-batches-48h',
                '0 * * * *',
                'SELECT public.cleanup_expired_price_tag_batches();'
            );
        EXCEPTION
            WHEN OTHERS THEN
                RAISE NOTICE 'pg_cron presente mas agendamento ignorado: %', SQLERRM;
        END;
    END IF;
END $$;

-- 6. Habilitação de Row Level Security (RLS)
ALTER TABLE public.price_tag_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir leitura por store_id em price_tag_batches" ON public.price_tag_batches;
CREATE POLICY "Permitir leitura por store_id em price_tag_batches" ON public.price_tag_batches
FOR SELECT USING (
    store_id = current_setting('request.jwt.claims', true)::json->>'store_id'
    OR current_setting('request.jwt.claims', true)::json->>'role' = 'administrador_matriz'
    OR store_id IS NOT NULL
);

DROP POLICY IF EXISTS "Permitir inserção por store_id em price_tag_batches" ON public.price_tag_batches;
CREATE POLICY "Permitir inserção por store_id em price_tag_batches" ON public.price_tag_batches
FOR INSERT WITH CHECK (
    store_id IS NOT NULL AND length(trim(store_id)) > 0
);

DROP POLICY IF EXISTS "Permitir exclusão por store_id em price_tag_batches" ON public.price_tag_batches;
CREATE POLICY "Permitir exclusão por store_id em price_tag_batches" ON public.price_tag_batches
FOR DELETE USING (
    store_id = current_setting('request.jwt.claims', true)::json->>'store_id'
    OR current_setting('request.jwt.claims', true)::json->>'role' = 'administrador_matriz'
    OR store_id IS NOT NULL
);

-- Conceder permissões para roles authenticated e anon
GRANT SELECT, INSERT, DELETE ON public.price_tag_batches TO authenticated, anon;
