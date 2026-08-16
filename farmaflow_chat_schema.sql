-- =========================================
-- MÓDULO FARMAFLOW CHAT - SUPABASE SCHEMA
-- =========================================

-- 1. whatsapp_instances
CREATE TABLE IF NOT EXISTS whatsapp_instances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_id TEXT NOT NULL, -- Ref to tenants/stores
    instance_name TEXT NOT NULL,
    phone_number TEXT,
    status TEXT DEFAULT 'DISCONNECTED', -- CONNECTED, DISCONNECTED, QRCODE
    qr_code_base64 TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. chat_contacts
CREATE TABLE IF NOT EXISTS chat_contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_number TEXT NOT NULL UNIQUE,
    name TEXT,
    profile_pic_url TEXT,
    farmaflow_customer_id TEXT, -- Pode referenciar a tabela de clientes
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. chat_conversations
CREATE TABLE IF NOT EXISTS chat_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_id TEXT NOT NULL,
    contact_id UUID REFERENCES chat_contacts(id) ON DELETE CASCADE,
    assigned_user_id TEXT,
    status TEXT DEFAULT 'PENDING', -- OPEN, CLOSED, PENDING
    unread_count INTEGER DEFAULT 0,
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. chat_messages
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID REFERENCES chat_conversations(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL, -- CUSTOMER, USER, SYSTEM
    sender_id TEXT, -- UUID do balconista ou ID do cliente
    content TEXT,
    media_url TEXT,
    media_type TEXT,
    is_private BOOLEAN DEFAULT FALSE,
    message_ack TEXT DEFAULT 'SENT', -- SENT, DELIVERED, READ
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. canned_responses
CREATE TABLE IF NOT EXISTS canned_responses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_id TEXT NOT NULL,
    shortcut TEXT NOT NULL, -- ex: /pix
    text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices de Performance
CREATE INDEX idx_whatsapp_instances_store_id ON whatsapp_instances(store_id);
CREATE INDEX idx_chat_contacts_phone_number ON chat_contacts(phone_number);
CREATE INDEX idx_chat_conversations_store_id ON chat_conversations(store_id);
CREATE INDEX idx_chat_conversations_contact_id ON chat_conversations(contact_id);
CREATE INDEX idx_chat_messages_conversation_id ON chat_messages(conversation_id);
CREATE INDEX idx_chat_messages_created_at ON chat_messages(created_at);
CREATE INDEX idx_canned_responses_store_id ON canned_responses(store_id);

-- Row Level Security (RLS)

ALTER TABLE whatsapp_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE canned_responses ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS para whatsapp_instances
CREATE POLICY "Acesso por Loja e Matriz - Instances" ON whatsapp_instances
    FOR ALL
    USING (
        store_id = current_setting('request.jwt.claims', true)::json->>'store_id'
        OR current_setting('request.jwt.claims', true)::json->>'role' = 'administrador_matriz'
    );

-- Políticas de RLS para chat_conversations
CREATE POLICY "Acesso por Loja e Matriz - Conversas" ON chat_conversations
    FOR ALL
    USING (
        store_id = current_setting('request.jwt.claims', true)::json->>'store_id'
        OR current_setting('request.jwt.claims', true)::json->>'role' = 'administrador_matriz'
    );

-- Políticas de RLS para chat_messages (Herda permissão da conversa)
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

-- Políticas de RLS para canned_responses
CREATE POLICY "Acesso por Loja e Matriz - Respostas Rapidas" ON canned_responses
    FOR ALL
    USING (
        store_id = current_setting('request.jwt.claims', true)::json->>'store_id'
        OR current_setting('request.jwt.claims', true)::json->>'role' = 'administrador_matriz'
    );

-- =========================================
-- MÓDULO FARMAFLOW CHAT - ATUALIZAÇÕES MULTI-ATENDENTE
-- =========================================

-- Tabela de histórico de atribuições
CREATE TABLE IF NOT EXISTS conversation_assignments_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID REFERENCES chat_conversations(id) ON DELETE CASCADE,
    assigned_by TEXT, -- UUID do usuário que transferiu/atribuiu
    assigned_to TEXT, -- UUID do usuário que recebeu
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_conversation_assignments_history_conversation_id ON conversation_assignments_history(conversation_id);

ALTER TABLE conversation_assignments_history ENABLE ROW LEVEL SECURITY;

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
