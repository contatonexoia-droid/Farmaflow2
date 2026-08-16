-- Enable RLS
ALTER TABLE public.inbox_members ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Enable all operations for authenticated users" ON public.inbox_members;
DROP POLICY IF EXISTS "Admin e Gerente gerenciam membros das inboxes" ON public.inbox_members;
DROP POLICY IF EXISTS "Balconista ve seus proprios membros" ON public.inbox_members;

-- Create policy for authenticated users to manage inbox_members
CREATE POLICY "Enable all operations for authenticated users on inbox_members"
ON public.inbox_members
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
