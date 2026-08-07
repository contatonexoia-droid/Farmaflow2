-- =========================================
-- MÓDULO DE CAIXAS DE ENTRADA (INBOXES)
-- =========================================

CREATE TABLE IF NOT EXISTS public.inboxes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_id TEXT, -- Ou UUID dependendo da estrutura
    name TEXT NOT NULL,
    description TEXT,
    whatsapp_instance_id UUID, -- FK opcional
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.inbox_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    inbox_id UUID REFERENCES public.inboxes(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(inbox_id, user_id)
);

-- Modificar chat_conversations para adicionar inbox_id
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS inbox_id UUID REFERENCES public.inboxes(id) ON DELETE SET NULL;

-- Habilitar RLS
ALTER TABLE public.inboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_members ENABLE ROW LEVEL SECURITY;

-- Políticas para Inboxes
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

-- Políticas para Inbox Members
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

