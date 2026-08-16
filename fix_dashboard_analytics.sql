-- =================================================================================
-- 1. Melhoria Estrutural: Adicionando flag booleana estrita
-- =================================================================================
ALTER TABLE public.search_logs 
ADD COLUMN IF NOT EXISTS is_success BOOLEAN DEFAULT false;

-- Retroalimentar os dados antigos
UPDATE public.search_logs 
SET is_success = (results_count > 0) 
WHERE is_success = false AND results_count > 0;

-- Criar um índice composto para analytics
CREATE INDEX IF NOT EXISTS idx_search_logs_analytics 
ON public.search_logs (tenant_id, is_success, created_at);

-- =================================================================================
-- 2. SQL de Auditoria (Comparação Manual Banco x Dashboard)
-- =================================================================================
/*
-- Rode este SQL no editor de query do Supabase para aferir os dados
SELECT 
    LOWER(TRIM(term)) AS search_term, 
    COUNT(*) AS search_count
FROM public.search_logs
WHERE tenant_id = 'COLOQUE_AQUI_O_TENANT_ID'
    AND is_success = false
    AND created_at >= NOW() - INTERVAL '48 hours'
GROUP BY LOWER(TRIM(term))
ORDER BY search_count DESC;
*/

-- =================================================================================
-- 3. Stored Procedure Aggregator (Backend Analytics)
-- Esta Function resolve: 
-- A) O teto oculto de limite de 1000 records do client PostgREST
-- B) A divergência de case/trim agrupando previamente
-- C) A precisão do timezone rodando exatamente no server
-- =================================================================================
CREATE OR REPLACE FUNCTION get_dashboard_empty_searches(
    p_tenant_id TEXT,
    p_hours INTEGER DEFAULT 48
)
RETURNS TABLE (
    search_term TEXT,
    search_count BIGINT
) 
LANGUAGE plpgsql SECURITY DEFINER 
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        LOWER(TRIM(term)) AS search_term,
        COUNT(*) AS search_count
    FROM public.search_logs
    WHERE tenant_id = p_tenant_id
        AND is_success = false
        AND created_at >= (NOW() AT TIME ZONE 'UTC' - (p_hours || ' hours')::INTERVAL)
    GROUP BY LOWER(TRIM(term))
    ORDER BY search_count DESC;
END;
$$;
