-- ==============================================================================
-- FARMAFLOW: SUPABASE MIGRATION - MÓDULO DE ATENDIMENTO KANBAN & IA AGENT
-- ==============================================================================

-- 1. Garante que a coluna kanban_stage existe na tabela chat_conversations
ALTER TABLE chat_conversations 
ADD COLUMN IF NOT EXISTS kanban_stage VARCHAR(30) DEFAULT 'NEW';

-- 2. Garante que os campos do Agente de IA e Transbordo existem
ALTER TABLE chat_conversations 
ADD COLUMN IF NOT EXISTS is_bot_active BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS bot_interaction_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS bot_handoff_reason VARCHAR(100),
ADD COLUMN IF NOT EXISTS bot_handoff_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS last_message_content TEXT;

-- 3. Índices de performance para consultas por estágio no Kanban e tenant
CREATE INDEX IF NOT EXISTS idx_chat_conversations_stage ON chat_conversations(store_id, kanban_stage);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_last_msg ON chat_conversations(store_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_bot_active ON chat_conversations(store_id, is_bot_active);

-- 4. Função para atualizar timestamp updated_at automaticamente
CREATE OR REPLACE FUNCTION update_chat_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_chat_conversation_timestamp ON chat_conversations;
CREATE TRIGGER trg_update_chat_conversation_timestamp
BEFORE UPDATE ON chat_conversations
FOR EACH ROW
EXECUTE FUNCTION update_chat_conversation_timestamp();

-- 5. Row Level Security (RLS) & Policies para Isolamento Multi-Tenant
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;

-- Política de leitura: Usuários autenticados podem ver conversas da sua drogaria
DROP POLICY IF EXISTS "Permitir leitura de conversas por tenant" ON chat_conversations;
CREATE POLICY "Permitir leitura de conversas por tenant"
ON chat_conversations FOR SELECT
TO authenticated
USING (
  store_id = auth.jwt() ->> 'tenant_id'
  OR auth.jwt() ->> 'role' = 'super_admin'
  OR auth.jwt() ->> 'role' = 'admin'
  OR auth.jwt() ->> 'role' = 'gerente'
  OR auth.jwt() ->> 'role' = 'operador'
);

-- Política de atualização: Operadores e Admin podem mover cards no Kanban e atualizar estágios
DROP POLICY IF EXISTS "Permitir atualizacao de estagio do kanban" ON chat_conversations;
CREATE POLICY "Permitir atualizacao de estagio do kanban"
ON chat_conversations FOR UPDATE
TO authenticated
USING (
  store_id = auth.jwt() ->> 'tenant_id'
  OR auth.jwt() ->> 'role' IN ('super_admin', 'admin', 'gerente', 'operador')
)
WITH CHECK (
  store_id = auth.jwt() ->> 'tenant_id'
  OR auth.jwt() ->> 'role' IN ('super_admin', 'admin', 'gerente', 'operador')
);
