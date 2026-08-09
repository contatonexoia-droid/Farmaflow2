-- Atualização do Schema para corrigir os erros do Webhook de Chat

-- 1. Tabela chat_contacts: Adicionar store_id e ajustar a constraint de unicidade
ALTER TABLE public.chat_contacts ADD COLUMN IF NOT EXISTS store_id TEXT;

-- Remove a constraint antiga se existir
ALTER TABLE public.chat_contacts DROP CONSTRAINT IF EXISTS chat_contacts_phone_number_key;

-- Adiciona a nova constraint combinada para garantir que um mesmo número possa existir em lojas diferentes
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_contacts_phone_number_store_id_key') THEN
    ALTER TABLE public.chat_contacts ADD CONSTRAINT chat_contacts_phone_number_store_id_key UNIQUE (phone_number, store_id);
  END IF;
END $$;

-- 2. Tabela chat_conversations: Adicionar last_message_content
ALTER TABLE public.chat_conversations ADD COLUMN IF NOT EXISTS last_message_content TEXT;

-- Atualizar o cache do schema no Supabase para que a Data API reconheça as novas colunas
NOTIFY pgrst, 'reload schema';
