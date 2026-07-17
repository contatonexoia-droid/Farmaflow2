-- 1. SQL DO SUPABASE (Migration)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS activation_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token TEXT UNIQUE NOT NULL,
    tenant_id TEXT NOT NULL,
    is_used BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Habilitar RLS
ALTER TABLE activation_tokens ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS
-- Permitir leitura e escrita apenas para a role de serviço (backend)
CREATE POLICY "Service Role Full Access" ON activation_tokens
    FOR ALL
    USING (auth.role() = 'service_role');
