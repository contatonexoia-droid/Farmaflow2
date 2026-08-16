-- ========================================================
-- DATABASE FIXES FOR FARMAFLOW CHAT & INBOXES
-- ========================================================

-- 1. Ensure store_id on whatsapp_instances is unique for upserts to work correctly
-- First, delete any duplicate rows keeping only the latest one to prevent unique index failure
DELETE FROM public.whatsapp_instances a USING public.whatsapp_instances b 
WHERE a.created_at < b.created_at AND a.store_id = b.store_id;

-- Add a unique constraint if it doesn't exist
ALTER TABLE public.whatsapp_instances DROP CONSTRAINT IF EXISTS whatsapp_instances_store_id_key;
ALTER TABLE public.whatsapp_instances ADD CONSTRAINT whatsapp_instances_store_id_key UNIQUE (store_id);


-- 2. Create security definer helper functions to safely retrieve current user's store_id and role
CREATE OR REPLACE FUNCTION public.get_my_store_id()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    user_store_id text;
BEGIN
    -- Try to get from profiles first (most secure and reliable)
    SELECT store_id INTO user_store_id FROM public.profiles WHERE id = auth.uid();
    
    -- Fallback to JWT metadata if profiles is not updated yet
    IF user_store_id IS NULL THEN
        user_store_id := COALESCE(
            current_setting('request.jwt.claims', true)::json->>'store_id',
            (auth.jwt() -> 'user_metadata') ->> 'store_id',
            (auth.jwt() -> 'user_metadata') ->> 'tenant_id'
        );
    END IF;
    
    RETURN user_store_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    user_role text;
BEGIN
    -- Try to get from profiles first (most secure and reliable)
    SELECT role INTO user_role FROM public.profiles WHERE id = auth.uid();
    
    -- Fallback to JWT metadata
    IF user_role IS NULL THEN
        user_role := COALESCE(
            current_setting('request.jwt.claims', true)::json->>'role',
            (auth.jwt() -> 'user_metadata') ->> 'role',
            'BALCONISTA'
        );
    END IF;
    
    RETURN user_role;
END;
$$;


-- 3. Helper to check if a user is a member of an inbox without triggering RLS recursion
CREATE OR REPLACE FUNCTION public.is_inbox_member(inbox_uuid uuid, user_uuid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.inbox_members
        WHERE inbox_id = inbox_uuid AND user_id = user_uuid
    );
$$;


-- 4. Recreate public.inboxes RLS policies using helpers to avoid infinite recursion
ALTER TABLE public.inboxes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin e Gerente gerenciam inboxes da loja" ON public.inboxes;
DROP POLICY IF EXISTS "Balconista ve inboxes que participa" ON public.inboxes;

CREATE POLICY "Admin e Gerente gerenciam inboxes da loja" ON public.inboxes
    FOR ALL
    USING (
        public.get_my_role() = 'ADMIN_MATRIZ' OR 
        (
            public.get_my_role() = 'GERENTE_LOJA' AND 
            store_id = public.get_my_store_id()
        )
    );

CREATE POLICY "Balconista ve inboxes que participa" ON public.inboxes
    FOR SELECT
    USING (
        public.is_inbox_member(id, auth.uid()) OR
        public.get_my_role() IN ('ADMIN_MATRIZ', 'GERENTE_LOJA')
    );


-- 5. Recreate public.inbox_members RLS policies to prevent circular dependency
ALTER TABLE public.inbox_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin e Gerente gerenciam membros das inboxes" ON public.inbox_members;
DROP POLICY IF EXISTS "Balconista ve seus proprios membros" ON public.inbox_members;

CREATE POLICY "Admin e Gerente gerenciam membros das inboxes" ON public.inbox_members
    FOR ALL
    USING (
        public.get_my_role() = 'ADMIN_MATRIZ' OR 
        (
            public.get_my_role() = 'GERENTE_LOJA' AND 
            EXISTS (
                SELECT 1 FROM public.inboxes 
                WHERE inboxes.id = inbox_members.inbox_id AND inboxes.store_id = public.get_my_store_id()
            )
        )
    );

CREATE POLICY "Balconista ve seus proprios membros" ON public.inbox_members
    FOR SELECT
    USING (user_id = auth.uid());
