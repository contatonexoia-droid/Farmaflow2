-- ============================================================================
-- TABELA DE INSCRIÇÕES WEB PUSH (PWA PUSH NOTIFICATIONS MULTITENANT)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_tenant_id
  ON public.push_subscriptions(tenant_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Insert Push Subscriptions" ON public.push_subscriptions;
CREATE POLICY "Public Insert Push Subscriptions"
  ON public.push_subscriptions
  FOR INSERT
  TO public
  WITH CHECK (true);

DROP POLICY IF EXISTS "Public Select Push Subscriptions" ON public.push_subscriptions;
CREATE POLICY "Public Select Push Subscriptions"
  ON public.push_subscriptions
  FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "Public Update Push Subscriptions" ON public.push_subscriptions;
CREATE POLICY "Public Update Push Subscriptions"
  ON public.push_subscriptions
  FOR UPDATE
  TO public
  USING (true);

DROP POLICY IF EXISTS "Public Delete Push Subscriptions" ON public.push_subscriptions;
CREATE POLICY "Public Delete Push Subscriptions"
  ON public.push_subscriptions
  FOR DELETE
  TO public
  USING (true);
