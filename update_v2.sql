-- EXECUTE ESTE SQL NO EDITOR DO SUPABASE PARA ATUALIZAR O BANCO DE DADOS

-- 1. Criar tabela de logs de busca (para o novo card de insights de produtos não encontrados)
CREATE TABLE IF NOT EXISTS search_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  term TEXT NOT NULL,
  results_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2. Habilitar RLS para search_logs (Segurança de Linha)
ALTER TABLE search_logs ENABLE ROW LEVEL SECURITY;

-- Política para permitir inserção pública (clientes pesquisando)
DROP POLICY IF EXISTS "Public Insert Search Logs" ON search_logs;
CREATE POLICY "Public Insert Search Logs" ON search_logs FOR INSERT TO public WITH CHECK (true);

-- Política para permitir leitura pública (admin visualizando insights)
DROP POLICY IF EXISTS "Public Select Search Logs" ON search_logs;
CREATE POLICY "Public Select Search Logs" ON search_logs FOR SELECT TO public USING (true);

-- 3. Garantir que a coluna receipt_file existe na tabela de orders (para comprovantes de PIX)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS receipt_file TEXT;

-- 4. Criar índices para performance
CREATE INDEX IF NOT EXISTS idx_search_logs_tenant_id ON search_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_search_logs_results_count ON search_logs(results_count);

-- 5. Recarregar esquema do PostgREST
NOTIFY pgrst, 'reload schema';
