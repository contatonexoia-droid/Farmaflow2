# Enriquecimento Automático de Fotos por EAN com Persistência no Supabase Storage

Implementação de um pipeline de busca em cascata (Waterfall) de imagens de produtos farmacêuticos e cosméticos via código de barras (EAN), salvando as imagens definitivamente no Supabase Storage no caminho global `ean/${cleanEan}.jpg` para reaproveitamento entre farmácias e independência total de APIs externas no carregamento da loja.

## Decisões Confirmadas e Revisão do Usuário

> [!IMPORTANT]
> Decisões alinhadas na Fase 1 com o usuário:
> - **Escopo do Lote**: A sincronização em lote processa estritamente produtos **sem foto cadastrada** (ou com placeholder), preservando 100% das fotos já cadastradas ou personalizadas.
> - **Bucket de Armazenamento**: Utilização do bucket `products` com criação automática (pública) via `supabaseAdmin` caso o bucket ainda não exista no projeto Supabase.

---

### 1. Visão Geral e Conceito Central

- **O que faz**: Identifica o código de barras (EAN/GTIN de 8 a 14 dígitos) do produto, verifica se a imagem já foi persistida no Supabase Storage (`ean/{cleanEan}.jpg`), caso contrário realiza busca sequencial em fontes públicas confiáveis (CDN Bluesoft Cosmos, OpenBeautyFacts, OpenFoodFacts e Bluesoft API oficial), valida o buffer (tamanho mínimo > 3KB, MIME type `image/*`, exclusão de placeholders) e realiza o upload definitivo para o Supabase Storage, associando a `publicUrl` ao cadastro do produto.
- **Público-alvo**: Gestores e balconistas de farmácias que cadastram ou importam catálogos de distribuidores e necessitam de fotos em alta qualidade para a vitrine virtual sem dependência de links externos que expirem.
- **Valor gerado**: Carregamento ultra-rápido na loja virtual sem requisições a servidores de terceiros, fim de imagens quebradas por bloqueios de CORS/hotlink e economia de trabalho manual de busca de imagens.

---

### 2. Experiência do Usuário e Design Visual (SaaS Dashboard)

Em conformidade com a constituição de design do painel FarmaFlow (`frontend-design` e `references/3_saas_dashboard.md`):

#### A. Barra de Ações do Catálogo (`AdminProductManager.tsx`)
- **Botão de Ação em Lote**: Adicionado na barra de ferramentas ao lado do filtro "Sem Foto" e botões de exportação:
  - Estilo discreto e funcional: fundo `bg-purple-50`, borda `border-2 border-purple-200`, texto `text-purple-700 hover:bg-purple-100 font-black text-xs uppercase tracking-wide`.
  - Rótulo claro com contagem dinâmica de candidatos: `Buscar Fotos por EAN (N)` onde N são itens com EAN válido e sem foto.
  - Indicador de estado desabilitado caso não haja itens pendentes.

#### B. Modal de Progresso em Lote
- Card com borda sutil, sem cards aninhados desnecessários:
  - Título editorial claro: `Sincronização de Imagens por EAN`.
  - Barra de progresso percentual fluida com números tabulares (`font-mono tabular-nums`).
  - Contador em tempo real: `Processando 12 de 48 produtos...`.
  - Resumo de conclusão com métricas tabulares:
    - *Fotos salvas no Supabase* (destaque positivo em verde esmeralda).
    - *Já existentes no Storage* (reaproveitamento global).
    - *Não localizadas* (com opção de exportar ou verificar).
  - Botão de cancelamento/interrupção segura para o operador.

#### C. Modal Individual de Produto (`Criar / Editar Produto`)
- Ao lado dos botões existentes de "IA Imagem" e "Upload", inclusão do botão de ação direta:
  - Rótulo: `Foto via EAN` (com ícone `ScanLine` ou `Sparkles`).
  - Comportamento: Valida se o campo `barcode` possui entre 8 e 14 dígitos. Caso não possua, alerta suavemente o operador no próprio campo.
  - Estado de carregamento: `Loader2` animado enquanto consulta o backend e faz o upload.
  - Ao concluir, substitui a pré-visualização da imagem no formulário instantaneamente e notifica sucesso.

---

### 3. Decisões de Produto e Trade-Offs

1. **Reaproveitamento Global por EAN (`ean/{cleanEan}.jpg`)**:
   - *Abordagem*: O nome do arquivo no Storage é indexado unicamente pelo código EAN limpo.
   - *Por quê*: O mesmo medicamento (ex: Dipirona 500mg 10 comp EAN 7896004700144) é vendido por diversas farmácias da rede FarmaFlow. Quando a Drogaria A sincronizar a foto, a Drogaria B terá a imagem instantaneamente reaproveitada sem novo download externo.
2. **Processamento em Chunks no Backend com Controle de Concorrência**:
   - *Abordagem*: O endpoint processa lotes em blocos de 3 requisições simultâneas com intervalo de 250ms.
   - *Por quê*: Evita saturação de conexões no Supabase Storage e previne bloqueios de IP (HTTP 429) por excesso de requisições nas fontes externas.
3. **Validação Rigorosa de Buffer (> 3KB)**:
   - *Abordagem*: Buffers menores que 3.072 bytes ou com cabeçalho de redirecionamento para placeholders (`no-image`, `default`) são descartados para não poluir o banco com imagens em branco.

---

### 4. Arquitetura Técnica e Fluxo de Dados

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PAINEL ADMINISTRATIVO                           │
│  - Botão individual: "Foto via EAN" no modal de produto                │
│  - Botão em lote: "Buscar Fotos por EAN" na listagem                   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ POST /api/products/sync-ean-images
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                           SERVER.TS / API                              │
│  - Sanitização de EAN (8 a 14 dígitos numéricos)                       │
│  - Validação de tenantId e produtos pendentes                          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│             SERVIÇO DE IMAGENS EAN (eanImageService.ts)                │
│                                                                        │
│  Passo 1: Verificar se existe no Supabase Storage                      │
│           (bucket: 'products' -> 'ean/{cleanEan}.jpg')                 │
│           ├── Se EXISTIR ──> Retorna publicUrl imediatamente           │
│           └── Se NÃO EXISTIR ──> Prossegue cascata externa             │
│                                                                        │
│  Passo 2: Cascata Externa (Waterfall):                                 │
│           ├── Fonte 1: CDN Cosmos (Bluesoft) com headers de navegador  │
│           ├── Fonte 2: OpenBeautyFacts API v2                          │
│           ├── Fonte 3: OpenFoodFacts API v2                            │
│           └── Fonte 4: Bluesoft Cosmos API (se COSMOS_API_TOKEN)       │
│                                                                        │
│  Passo 3: Validação do Buffer (Size > 3KB, Content-Type: image/*)      │
│                                                                        │
│  Passo 4: Upload no Supabase Storage ('products', upsert: true)        │
│                                                                        │
│  Passo 5: Atualização da coluna `image` na tabela `products`           │
└────────────────────────────────────────────────────────────────────────┘
```

---

### 5. Plano de Entrega por Arquivo

1. **`services/eanImageService.ts`**:
   - Função principal `fetchAndStoreProductImageByEan(ean, productName?, tenantId?, productId?)`.
   - Inicialização e checagem de bucket `products` com criação automática se inexistente.
   - Headers apropriados para requisições externas simulando navegador moderno.
   - Persistência e obtenção da `publicUrl`.
2. **`server.ts`**:
   - Endpoint `POST /api/products/sync-ean-images`:
     - Modo individual: `{ productId, ean, tenantId }`.
     - Modo lote: `{ tenantId, maxItems? }` com streaming ou retorno detalhado de progresso e estatísticas.
3. **`components/AdminProductManager.tsx`**:
   - Adição do botão "Buscar Fotos por EAN" na barra de ações.
   - Modal de progresso com porcentagem, contadores tabulares e encerramento limpo.
   - Adição do botão "Foto via EAN" no modal de produto com feedback visual de carregamento.
