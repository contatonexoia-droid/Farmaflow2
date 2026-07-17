-- EXECUTE ESTE COMANDO NO SQL EDITOR DO SUPABASE PARA CORRIGIR AS TABELAS DE BACKUP

-- 1. Garantir que as tabelas existam com as colunas corretas
CREATE TABLE IF NOT EXISTS backuplogs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenantid TEXT NOT NULL,
  createdat TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  filename TEXT NOT NULL,
  filesize INTEGER NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backupschedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenantid TEXT NOT NULL,
  backupconfig JSONB DEFAULT '{"frequency": "OFF"}'::jsonb,
  updatedat TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Adicionar constraint UNIQUE em tenantid se não existir
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'backupschedules_tenantid_key'
    ) THEN
        ALTER TABLE backupschedules ADD CONSTRAINT backupschedules_tenantid_key UNIQUE (tenantid);
    END IF;
END $$;

-- 2. Habilitar RLS (Row Level Security)
ALTER TABLE backuplogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE backupschedules ENABLE ROW LEVEL SECURITY;

-- 3. Criar políticas para permitir acesso total (já que a API usa a chave anônima)
-- Nota: Em um ambiente de produção real, você deve restringir isso usando a chave de serviço (service_role)
DROP POLICY IF EXISTS "Permitir acesso total backuplogs" ON backuplogs;
CREATE POLICY "Permitir acesso total backuplogs" ON backuplogs FOR ALL USING (true);

DROP POLICY IF EXISTS "Permitir acesso total backupschedules" ON backupschedules;
CREATE POLICY "Permitir acesso total backupschedules" ON backupschedules FOR ALL USING (true);

-- 4. Notificar o PostgREST para recarregar o esquema
NOTIFY pgrst, 'reload schema';
