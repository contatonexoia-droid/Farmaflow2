-- ==========================================
-- Rotina de Limpeza Automática (Data Purge)
-- Tabela: search_logs (TTL: 48 horas)
-- ==========================================

-- 1. Otimização de Performance
-- A criação imediata deste índice garante que a varredura buscará diretamente
-- e de forma instantânea os registros mais antigos, prevenindo o temido
-- "Full-Table Scan" que consome I/O excessivo.
CREATE INDEX IF NOT EXISTS idx_search_logs_created_at 
ON public.search_logs (created_at);

-- 2. Função de Limpeza (Stored Procedure)
-- Segurança definida como DEFINER (roda com as permissões de quem criou)
CREATE OR REPLACE FUNCTION purge_old_search_logs()
RETURNS void AS $$
BEGIN
    -- Deleta registros de forma limpa que tenham sido criados há mais de 48 horas.
    DELETE FROM public.search_logs
    WHERE created_at < NOW() - INTERVAL '48 hours';
    
    -- Nota: para tabelas com volume extremo (milhões de buscas/dia), ao invés
    -- de DELETE puro (que causa bloat e necessidade de VACUUM massivo), 
    -- o ideal seria o comando nativo do postgres TRUNCATE rodando num modelo de
    -- Particionamento de Tabela por Data (ex: partições diárias).
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Automação do Agendamento (Cron Job Nativo Supabase)
-- Certificando de que a extensão pg_cron está habilitada na org
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove rotina anterior (caso exista) para evitar duplicatas em reexecuções de query
-- Nota: Envolto em try/catch silencioso ou dispensado, pois o cron.schedule
-- com nome já atualiza o job nativamente nas versões recentes do Supabase.

-- Agenda a rotina para execução toda madrugada (03:00 AM)
SELECT cron.schedule(
    'purge_search_logs_daily',     -- Nome / ID descritivo para o cron
    '0 3 * * *',                   -- "A cada minuto 0, da hora 3"
    'SELECT public.purge_old_search_logs();' -- Ação / SQL Command
);

-- ==========================================
-- ESTRATÉGIA ALTERNATIVA PARA ESCALA MASSIVA
-- ==========================================
/*
Se a plataforma assumir centenas de milhões de pesquisas por mês, apagar registros
diariamente (DELETE) via pg_cron pode gerar alta latência e indexação pesada na 
reforma das páginas (bloat - dead tuples), esgotando as conexões do banco de forma agressiva. 

Em uma arquitetura de particionamento:
1. Recriaríamos a pesquisa de forma declarativa dividida por dia:
   CREATE TABLE search_logs ( ... ) PARTITION BY RANGE (created_at);

2. Criaríamos tabelas filhas (partições) por fatiamento de dados:
   CREATE TABLE search_logs_2026_05_25 PARTITION OF search_logs FOR VALUES FROM ('2026-05-25') TO ('2026-05-26');

3. Na exclusão (Rotina Otimizada):
   A Stored Procedure executaria um simples "DROP TABLE search_logs_2026_05_23;"

Resultado: Tempo de apagar desce de (milissegundos) para (microssegundos instantâneo), 
pois remove o bloco cru do disco sem atualizar índices na árvore inteira.
*/
