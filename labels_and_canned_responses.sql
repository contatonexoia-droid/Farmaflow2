-- ========================================================
-- FARMAFLOW CHAT - SISTEMA DE ETIQUETAS E MENSAGENS RÁPIDAS (IDEMPOTENTE)
-- ========================================================

-- 1. TABELA DE ETIQUETAS (chat_labels)
CREATE TABLE IF NOT EXISTS chat_labels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL, -- Cor HEX (ex: #EF4444)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_chat_labels_store_id ON chat_labels(store_id);

-- Ativação do RLS (Row Level Security)
ALTER TABLE chat_labels ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS
DROP POLICY IF EXISTS "Acesso por Loja e Matriz - Chat Labels" ON chat_labels;
CREATE POLICY "Acesso por Loja e Matriz - Chat Labels" ON chat_labels
    FOR ALL
    USING (
        store_id = current_setting('request.jwt.claims', true)::json->>'store_id'
        OR current_setting('request.jwt.claims', true)::json->>'role' = 'administrador_matriz'
    );


-- 2. TABELA DE RELACIONAMENTO CONVERSA x ETIQUETAS (chat_conversation_labels)
CREATE TABLE IF NOT EXISTS chat_conversation_labels (
    conversation_id UUID REFERENCES chat_conversations(id) ON DELETE CASCADE,
    label_id UUID REFERENCES chat_labels(id) ON DELETE CASCADE,
    PRIMARY KEY (conversation_id, label_id)
);

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_chat_conversation_labels_conv ON chat_conversation_labels(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversation_labels_lbl ON chat_conversation_labels(label_id);

-- Ativação do RLS (Row Level Security)
ALTER TABLE chat_conversation_labels ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS
DROP POLICY IF EXISTS "Acesso por Loja e Matriz - Chat Conv Labels" ON chat_conversation_labels;
CREATE POLICY "Acesso por Loja e Matriz - Chat Conv Labels" ON chat_conversation_labels
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM chat_conversations c
            WHERE c.id = chat_conversation_labels.conversation_id
            AND (
                c.store_id = current_setting('request.jwt.claims', true)::json->>'store_id'
                OR current_setting('request.jwt.claims', true)::json->>'role' = 'administrador_matriz'
            )
        )
    );


-- 3. TABELA DE RESPOSTAS RÁPIDAS (canned_responses)
CREATE TABLE IF NOT EXISTS canned_responses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_id TEXT NOT NULL,
    shortcut TEXT NOT NULL, -- Atalho digitável (ex: pix, entrega, cadastro)
    text TEXT NOT NULL, -- Texto completo de resposta
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_canned_responses_store_id ON canned_responses(store_id);

-- Ativação do RLS (Row Level Security)
ALTER TABLE canned_responses ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS
DROP POLICY IF EXISTS "Acesso por Loja e Matriz - Respostas Rapidas" ON canned_responses;
CREATE POLICY "Acesso por Loja e Matriz - Respostas Rapidas" ON canned_responses
    FOR ALL
    USING (
        store_id = current_setting('request.jwt.claims', true)::json->>'store_id'
        OR current_setting('request.jwt.claims', true)::json->>'role' = 'administrador_matriz'
    );
