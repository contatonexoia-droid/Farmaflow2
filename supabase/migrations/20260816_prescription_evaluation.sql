-- ==============================================================================
-- MIGRAÇÃO FARMAFLOW: MÓDULO DE AVALIAÇÃO E RECUSA DE RECEITAS MÉDICAS
-- ==============================================================================

-- 1. TABELA DE MOTIVOS DE RECUSA DE RECEITA (Configurável por Farmácia)
CREATE TABLE IF NOT EXISTS public.prescription_rejection_reasons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    message_template TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para alta performance
CREATE INDEX IF NOT EXISTS idx_prescription_reasons_store ON public.prescription_rejection_reasons(store_id);
CREATE INDEX IF NOT EXISTS idx_prescription_reasons_active ON public.prescription_rejection_reasons(store_id, is_active, order_index);

-- 2. TABELA DE RECEITAS MÉDICAS E PARECERES FARMACÊUTICOS
CREATE TABLE IF NOT EXISTS public.medical_prescriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id TEXT NOT NULL,
    conversation_id TEXT,
    customer_id TEXT,
    order_id TEXT,
    file_url TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    rejection_reason_id TEXT,
    rejection_reason_title TEXT,
    rejection_notes TEXT,
    evaluated_by TEXT,
    evaluated_by_name TEXT,
    evaluated_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para buscas rápidas
CREATE INDEX IF NOT EXISTS idx_medical_prescriptions_store ON public.medical_prescriptions(store_id);
CREATE INDEX IF NOT EXISTS idx_medical_prescriptions_conv ON public.medical_prescriptions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_medical_prescriptions_order ON public.medical_prescriptions(order_id);
CREATE INDEX IF NOT EXISTS idx_medical_prescriptions_status ON public.medical_prescriptions(store_id, status);

-- 3. HABILITAÇÃO DE ROW LEVEL SECURITY (RLS)
ALTER TABLE public.prescription_rejection_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_prescriptions ENABLE ROW LEVEL SECURITY;

-- Políticas de Acesso
DROP POLICY IF EXISTS "Allow public read of active rejection reasons" ON public.prescription_rejection_reasons;
CREATE POLICY "Allow public read of active rejection reasons"
    ON public.prescription_rejection_reasons FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Allow all for authenticated/service on rejection reasons" ON public.prescription_rejection_reasons;
CREATE POLICY "Allow all for authenticated/service on rejection reasons"
    ON public.prescription_rejection_reasons FOR ALL
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on medical prescriptions" ON public.medical_prescriptions;
CREATE POLICY "Allow all on medical prescriptions"
    ON public.medical_prescriptions FOR ALL
    USING (true)
    WITH CHECK (true);

-- 4. INSERÇÃO DOS MOTIVOS PADRÃO DA ANVISA (Para todas as lojas ou fallback)
INSERT INTO public.prescription_rejection_reasons (id, store_id, title, description, message_template, is_active, order_index)
VALUES 
(
    gen_random_uuid(),
    'default',
    'Receita Vencida',
    'Prazo de validade do receituário expirado conforme normas sanitárias da ANVISA.',
    '⚠️ *Receita Médica Vencida*

Olá! Analisamos a foto da sua receita médica e identificamos que o prazo de validade está expirado. De acordo com as normas da ANVISA (RDC), não é permitida a dispensação de medicamentos com receita vencida.

Por favor, consulte seu médico para emissão de um novo receituário atualizado. Ficamos à disposição!',
    true,
    1
),
(
    gen_random_uuid(),
    'default',
    'Rasurada ou Ilegível',
    'Foto sem nitidez, dados cortados ou caligrafia ilegível.',
    '📷 *Receita Ilegível ou com Rasuras*

Olá! Recebemos a foto da sua receita, porém a caligrafia, dosagem ou identificação do medicamento não estão nitidamente legíveis para garantir uma dispensação 100% segura.

Você poderia nos enviar uma nova foto com melhor iluminação, foco e enquadramento completo do documento?',
    true,
    2
),
(
    gen_random_uuid(),
    'default',
    'Sem Carimbo ou CRM do Médico',
    'Ausência de assinatura, carimbo legível ou registro CRM do médico prescritor.',
    '👨‍⚕️ *Identificação Médica Incompleta*

Olá! Para validação farmacêutica da receita, é obrigatório constar de forma legível a assinatura, carimbo e número de registro no CRM do médico prescritor.

A imagem enviada não possui esses dados claros. Caso tenha a via completa, por gentileza envie uma nova foto.',
    true,
    3
),
(
    gen_random_uuid(),
    'default',
    'Via Controlada Exige Presença Física',
    'Medicamento controlado com retenção de receita física obrigatória (Portaria 344/98).',
    '📋 *Retenção de Receita Obrigatória*

Olá! O medicamento solicitado requer a retenção da via original física da Notificação de Receita (Portaria 344/98 da ANVISA).

Nossa equipe pode agilizar a separação do seu pedido, porém será indispensável a entrega da receita física original ao nosso entregador ou na retirada no balcão da farmácia.',
    true,
    4
),
(
    gen_random_uuid(),
    'default',
    'Medicamento em Falta / Não Trabalhamos',
    'Item prescrito não disponível no estoque da drogaria ou fora de linha.',
    '💊 *Item Indisponível no Momento*

Olá! Verificamos o item prescrito na sua receita e infelizmente este produto está temporariamente indisponível em nosso estoque.

Gostaria de verificar opções de genéricos ou similares equivalentes?',
    true,
    5
)
ON CONFLICT (id) DO NOTHING;
