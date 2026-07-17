-- Atualiza a tabela tenants para adicionar os campos de webhook do ERP
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS erp_webhook_url TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS erp_webhook_secret TEXT;
