-- 1. Create teams table
CREATE TABLE IF NOT EXISTS public.chat_teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Associate users with teams
CREATE TABLE IF NOT EXISTS public.chat_team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID REFERENCES public.chat_teams(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(team_id, user_id)
);

-- 3. Modify chat_conversations to add team_id
ALTER TABLE public.chat_conversations ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES public.chat_teams(id) ON DELETE SET NULL;
ALTER TABLE public.inboxes ADD COLUMN IF NOT EXISTS channel_type TEXT DEFAULT 'whatsapp';

-- 4. Associate teams with inboxes
CREATE TABLE IF NOT EXISTS public.inbox_teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inbox_id UUID REFERENCES public.inboxes(id) ON DELETE CASCADE,
    team_id UUID REFERENCES public.chat_teams(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(inbox_id, team_id)
);

-- 5. Enable RLS
ALTER TABLE public.chat_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_teams ENABLE ROW LEVEL SECURITY;

-- 6. Policies
CREATE POLICY "Acesso por Loja e Matriz - Teams" ON public.chat_teams
    FOR ALL
    USING (
        store_id = current_setting('request.jwt.claims', true)::json->>'store_id'
        OR current_setting('request.jwt.claims', true)::json->>'role' = 'administrador_matriz'
    );

CREATE POLICY "Acesso por Loja e Matriz - Team Members" ON public.chat_team_members
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.chat_teams
            WHERE chat_teams.id = chat_team_members.team_id AND
            (
                chat_teams.store_id = current_setting('request.jwt.claims', true)::json->>'store_id'
                OR current_setting('request.jwt.claims', true)::json->>'role' = 'administrador_matriz'
            )
        )
    );

CREATE POLICY "Acesso por Loja e Matriz - Inbox Teams" ON public.inbox_teams
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.inboxes
            WHERE inboxes.id = inbox_teams.inbox_id AND
            (
                inboxes.store_id = current_setting('request.jwt.claims', true)::json->>'store_id'
                OR current_setting('request.jwt.claims', true)::json->>'role' = 'administrador_matriz'
            )
        )
    );
