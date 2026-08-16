-- ========================================================
-- FARMAFLOW CHAT - BOAS-VINDAS DA PRIMEIRA MENSAGEM DO DIA
-- ========================================================

-- 1. ADICIONAR COLUNAS NA TABELA TENANTS
ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS welcome_message_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS welcome_message_text TEXT,
ADD COLUMN IF NOT EXISTS welcome_message_format TEXT DEFAULT 'button',
ADD COLUMN IF NOT EXISTS welcome_message_link TEXT;

-- 2. ADICIONAR COLUNA NA TABELA CHAT_CONVERSATIONS
ALTER TABLE chat_conversations
ADD COLUMN IF NOT EXISTS last_welcome_sent_at TIMESTAMP WITH TIME ZONE;

-- (Opcional) Limpar o cache de schema da postgrest se for necessário
NOTIFY pgrst, 'reload schema';
