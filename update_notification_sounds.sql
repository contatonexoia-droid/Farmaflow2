-- Script para adicionar configuração de alerta sonoro ao banco de dados

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS notification_sound TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS notification_volume NUMERIC DEFAULT 0.5;
