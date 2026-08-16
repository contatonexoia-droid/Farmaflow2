-- =========================================
-- MÓDULO DE GESTÃO DE USUÁRIOS E RBAC
-- =========================================

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    store_id TEXT, -- Ou UUID dependendo da estrutura da tabela tenants
    full_name TEXT,
    role TEXT CHECK (role IN ('ADMIN_MATRIZ', 'GERENTE_LOJA', 'BALCONISTA')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ativa RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ADMIN_MATRIZ: Pode ler e escrever em qualquer registro da tabela profiles
CREATE POLICY "Admin Matriz gerencia todos os perfis" ON public.profiles
    FOR ALL
    USING (
        current_setting('request.jwt.claims', true)::json->>'role' = 'ADMIN_MATRIZ'
    );

-- GERENTE_LOJA: Pode ler e gerenciar perfis onde profiles.store_id = auth.jwt().store_id
CREATE POLICY "Gerente gerencia perfis de sua loja" ON public.profiles
    FOR ALL
    USING (
        store_id = current_setting('request.jwt.claims', true)::json->>'store_id'
        AND current_setting('request.jwt.claims', true)::json->>'role' = 'GERENTE_LOJA'
    );

-- BALCONISTA: Pode ler apenas seu proprio perfil (auth.uid() = id)
CREATE POLICY "Balconista ve apenas seu proprio perfil" ON public.profiles
    FOR SELECT
    USING (
        id = auth.uid()
    );

CREATE POLICY "Balconista atualiza seu proprio perfil" ON public.profiles
    FOR UPDATE
    USING (
        id = auth.uid()
    );

-- Função PostgreSQL + Trigger para criar perfil automaticamente
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, store_id, role)
    VALUES (
        new.id,
        new.raw_user_meta_data->>'full_name',
        new.raw_user_meta_data->>'store_id',
        COALESCE(new.raw_user_meta_data->>'role', 'BALCONISTA')
    );
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Remove se ja existir para evitar erro
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
