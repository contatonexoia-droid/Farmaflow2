-- =========================================
-- ATUALIZAÇÃO 1: FLAG DE CHAT NA LOJA (TENANTS)
-- =========================================
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS is_chat_enabled BOOLEAN DEFAULT false;

-- =========================================
-- ATUALIZAÇÃO 2: MÓDULO DE CAIXAS DE ENTRADA (INBOXES)
-- =========================================
CREATE TABLE IF NOT EXISTS public.inboxes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    whatsapp_instance_id UUID, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.inbox_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inbox_id UUID REFERENCES public.inboxes(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(inbox_id, user_id)
);

ALTER TABLE public.inboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_members ENABLE ROW LEVEL SECURITY;

-- Limpar politicas antigas se houver
DROP POLICY IF EXISTS "Admin e Gerente gerenciam inboxes da loja" ON public.inboxes;
DROP POLICY IF EXISTS "Balconista ve inboxes que participa" ON public.inboxes;
DROP POLICY IF EXISTS "Admin e Gerente gerenciam membros das inboxes" ON public.inbox_members;
DROP POLICY IF EXISTS "Balconista ve seus proprios membros" ON public.inbox_members;

CREATE POLICY "Admin e Gerente gerenciam inboxes da loja" ON public.inboxes
    FOR ALL
    USING (
        current_setting('request.jwt.claims', true)::json->>'role' = 'ADMIN_MATRIZ' OR 
        (
            current_setting('request.jwt.claims', true)::json->>'role' = 'GERENTE_LOJA' AND 
            store_id = current_setting('request.jwt.claims', true)::json->>'store_id'
        )
    );

CREATE POLICY "Balconista ve inboxes que participa" ON public.inboxes
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.inbox_members 
            WHERE inbox_members.inbox_id = inboxes.id AND inbox_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Admin e Gerente gerenciam membros das inboxes" ON public.inbox_members
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.inboxes 
            WHERE inboxes.id = inbox_members.inbox_id AND (
                current_setting('request.jwt.claims', true)::json->>'role' = 'ADMIN_MATRIZ' OR 
                (
                    current_setting('request.jwt.claims', true)::json->>'role' = 'GERENTE_LOJA' AND 
                    inboxes.store_id = current_setting('request.jwt.claims', true)::json->>'store_id'
                )
            )
        )
    );

CREATE POLICY "Balconista ve seus proprios membros" ON public.inbox_members
    FOR SELECT
    USING (user_id = auth.uid());


-- =========================================
-- ATUALIZAÇÃO 3: MÓDULO FARMAFLOW CHAT 
-- =========================================
-- 1. whatsapp_instances
CREATE TABLE IF NOT EXISTS whatsapp_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id TEXT NOT NULL, 
    instance_name TEXT NOT NULL,
    phone_number TEXT,
    status TEXT DEFAULT 'DISCONNECTED',
    qr_code_base64 TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. chat_contacts
CREATE TABLE IF NOT EXISTS chat_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number TEXT NOT NULL UNIQUE,
    name TEXT,
    profile_pic_url TEXT,
    farmaflow_customer_id TEXT, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. chat_conversations
CREATE TABLE IF NOT EXISTS chat_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id TEXT NOT NULL,
    contact_id UUID REFERENCES chat_contacts(id) ON DELETE CASCADE,
    assigned_user_id TEXT,
    inbox_id UUID REFERENCES public.inboxes(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'PENDING',
    unread_count INTEGER DEFAULT 0,
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Se a tabela já existia antes e não tinha o inbox_id:
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'chat_conversations' AND column_name = 'inbox_id') THEN
        ALTER TABLE public.chat_conversations ADD COLUMN inbox_id UUID REFERENCES public.inboxes(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 4. chat_messages
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES chat_conversations(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL, 
    sender_id TEXT, 
    content TEXT,
    media_url TEXT,
    media_type TEXT,
    is_private BOOLEAN DEFAULT FALSE,
    message_ack TEXT DEFAULT 'SENT', 
    reaction TEXT,
    reactions JSONB DEFAULT '[]'::jsonb,
    remote_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Garantir colunas de reações e remote_id em bancos já existentes
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reaction TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reactions JSONB DEFAULT '[]'::jsonb;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS remote_id TEXT;
CREATE INDEX IF NOT EXISTS idx_chat_messages_remote_id ON chat_messages(remote_id);

-- 5. canned_responses
CREATE TABLE IF NOT EXISTS canned_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id TEXT NOT NULL,
    shortcut TEXT NOT NULL, 
    text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. conversation_assignments_history
CREATE TABLE IF NOT EXISTS conversation_assignments_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES chat_conversations(id) ON DELETE CASCADE,
    assigned_by TEXT, 
    assigned_to TEXT,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_store_id ON whatsapp_instances(store_id);
CREATE INDEX IF NOT EXISTS idx_chat_contacts_phone_number ON chat_contacts(phone_number);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_store_id ON chat_conversations(store_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_contact_id ON chat_conversations(contact_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id ON chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_canned_responses_store_id ON canned_responses(store_id);
CREATE INDEX IF NOT EXISTS idx_conversation_assignments_history_conversation_id ON conversation_assignments_history(conversation_id);

-- RLS (Row Level Security)
ALTER TABLE whatsapp_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE canned_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_assignments_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Acesso por Loja e Matriz - Instances" ON whatsapp_instances;
DROP POLICY IF EXISTS "Acesso por Loja e Matriz - Conversas" ON chat_conversations;
DROP POLICY IF EXISTS "Acesso por Loja e Matriz - Mensagens" ON chat_messages;
DROP POLICY IF EXISTS "Acesso por Loja e Matriz - Respostas Rapidas" ON canned_responses;
DROP POLICY IF EXISTS "Acesso por Loja e Matriz - Historico de Atribuicoes" ON conversation_assignments_history;

CREATE POLICY "Acesso por Loja e Matriz - Instances" ON whatsapp_instances
    FOR ALL
    USING (
        store_id = current_setting('request.jwt.claims', true)::json->>'store_id'
        OR current_setting('request.jwt.claims', true)::json->>'role' = 'administrador_matriz'
    );

CREATE POLICY "Acesso por Loja e Matriz - Conversas" ON chat_conversations
    FOR ALL
    USING (
        store_id = current_setting('request.jwt.claims', true)::json->>'store_id'
        OR current_setting('request.jwt.claims', true)::json->>'role' = 'administrador_matriz'
    );

CREATE POLICY "Acesso por Loja e Matriz - Mensagens" ON chat_messages
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM chat_conversations c
            WHERE c.id = chat_messages.conversation_id
            AND (
                c.store_id = current_setting('request.jwt.claims', true)::json->>'store_id'
                OR current_setting('request.jwt.claims', true)::json->>'role' = 'administrador_matriz'
            )
        )
    );

CREATE POLICY "Acesso por Loja e Matriz - Respostas Rapidas" ON canned_responses
    FOR ALL
    USING (
        store_id = current_setting('request.jwt.claims', true)::json->>'store_id'
        OR current_setting('request.jwt.claims', true)::json->>'role' = 'administrador_matriz'
    );

CREATE POLICY "Acesso por Loja e Matriz - Historico de Atribuicoes" ON conversation_assignments_history
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM chat_conversations c
            WHERE c.id = conversation_assignments_history.conversation_id
            AND (
                c.store_id = current_setting('request.jwt.claims', true)::json->>'store_id'
                OR current_setting('request.jwt.claims', true)::json->>'role' = 'administrador_matriz'
            )
        )
    );
