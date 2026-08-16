-- update_network_features.sql
-- 1. Extensão da tabela de Lojas/Tenants para suportar a arquitetura de rede
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_network_master BOOLEAN DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS network_id TEXT;

-- 2. Extensão das tabelas de Cupons e Promoções para suportar escopo de rede
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT 'SINGLE_STORE';
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT 'SINGLE_STORE';

-- Atualizar o cache do PostgREST para reconhecer as novas colunas
NOTIFY pgrst, 'reload schema';
