-- EXECUTE ESTE COMANDO NO SQL EDITOR DO SUPABASE PARA ADICIONAR AS CONFIGURAÇÕES DE ENTREGA:

-- 1. Adicionar a coluna de configurações de entrega na tabela de tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS delivery_settings JSONB DEFAULT '{"enabled": false, "fee": 0, "minOrderForFreeDelivery": 0}'::jsonb;

-- 2. Notificar o PostgREST para recarregar o esquema
NOTIFY pgrst, 'reload schema';
