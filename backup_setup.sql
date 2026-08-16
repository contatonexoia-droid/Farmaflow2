-- SQL para criar as tabelas de estatísticas e logs de backup
-- Execute no SQL Editor do Supabase

-- 1. Tabela de Estatísticas (para manter o rating fixo após o purge)
CREATE TABLE IF NOT EXISTS pharmacy_stats (
  tenantid TEXT PRIMARY KEY,
  averagerating DECIMAL(3,2) DEFAULT 0,
  totalreviews INTEGER DEFAULT 0,
  lastupdated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Tabela de Logs de Backup
CREATE TABLE IF NOT EXISTS backup_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenantid TEXT NOT NULL,
  date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  filename TEXT NOT NULL,
  filesize INTEGER NOT NULL,
  status TEXT NOT NULL, -- 'SUCCESS' | 'FAILED'
  downloadurl TEXT
);

-- 3. Adicionar coluna de configuração de backup na tabela de tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS backupconfig JSONB DEFAULT '{"frequency": "OFF"}'::jsonb;

-- 4. Habilitar RLS (Row Level Security) - Opcional, mas recomendado
ALTER TABLE pharmacy_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_logs ENABLE ROW LEVEL SECURITY;

-- Políticas simples para permitir acesso ao Super Admin (ajuste conforme necessário)
CREATE POLICY "Super Admin full access on pharmacy_stats" ON pharmacy_stats FOR ALL USING (true);
CREATE POLICY "Super Admin full access on backup_logs" ON backup_logs FOR ALL USING (true);
