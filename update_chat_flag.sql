ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS is_chat_enabled BOOLEAN DEFAULT false;
