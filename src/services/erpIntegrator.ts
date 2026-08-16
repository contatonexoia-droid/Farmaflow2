import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import dotenv from 'dotenv';

// Tenta carregar o arquivo .env do diretório onde o executável está rodando
dotenv.config({ path: path.join(process.cwd(), '.env') });

// Configurações de ambiente carregadas na inicialização
let supabase: any = null;
let LOCAL_TENANT_ID = '';
let API_BASE_URL = '';

/**
 * Inicializa o cliente do Supabase sob demanda
 */
export function initSupabaseClient(): boolean {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  LOCAL_TENANT_ID = process.env.LOCAL_TENANT_ID || '';
  API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

  if (!SUPABASE_URL || !SUPABASE_KEY || !LOCAL_TENANT_ID) {
    console.error('ERRO: Credenciais do Supabase ou LOCAL_TENANT_ID não configurados no arquivo .env.');
    return false;
  }

  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return true;
}

/**
 * Função principal para iniciar o serviço de escuta do ERP (App Desktop)
 */
export function startERPIntegrator() {
  console.log(`[FarmaFlow ERP Integrator] Iniciando escuta para a farmácia (Tenant ID: ${LOCAL_TENANT_ID})...`);

  // Assina o canal Realtime para a tabela 'orders' (ou 'pedidos', dependendo do schema exato)
  supabase
    .channel('erp-orders-channel')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE', // Escutamos atualizações de pedidos
        schema: 'public',
        table: 'orders',
        filter: `tenant_id=eq.${LOCAL_TENANT_ID}`, // Filtra pelo tenant da farmácia configurada localmente
      },
      async (payload) => {
        const novoPedido = payload.new;
        const pedidoAntigo = payload.old;

        // Verifica se o status mudou para 'enviado_ao_pdv'
        if (
          novoPedido.status === 'enviado_ao_pdv' &&
          pedidoAntigo?.status !== 'enviado_ao_pdv'
        ) {
          console.log(`\n[NOVO PEDIDO] Pedido ID ${novoPedido.id} recebido na fila do PDV via Realtime!`);
          await handleNewOrder(novoPedido.id, novoPedido.tenant_id);
        }
      }
    )
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        console.log('[FarmaFlow ERP Integrator] Conectado com sucesso ao Supabase Realtime!');
      } else if (status === 'CHANNEL_ERROR') {
        console.error('[FarmaFlow ERP Integrator] Erro ao conectar no canal Realtime:', err);
      }
    });

  // Fallback de polling (busca pedidos a cada 15 segundos caso o Realtime falhe)
  setInterval(async () => {
    try {
      const { data: pendingOrders, error } = await supabase
        .from('orders')
        .select('id, tenant_id')
        .eq('tenant_id', LOCAL_TENANT_ID)
        .eq('status', 'enviado_ao_pdv');
      
      if (error) {
        console.error('[FarmaFlow ERP Integrator] Erro no polling de pedidos:', error.message);
        return;
      }
      
      if (pendingOrders && pendingOrders.length > 0) {
        for (const order of pendingOrders) {
          console.log(`\n[NOVO PEDIDO] Pedido ID ${order.id} recebido na fila do PDV via Polling!`);
          await handleNewOrder(order.id, order.tenant_id);
        }
      }
    } catch (e: any) {
      console.error('[FarmaFlow ERP Integrator] Erro no polling:', e.message);
    }
  }, 15000); // A cada 15 segundos
}

/**
 * Fallback local: busca dados diretamente do Supabase e estrutura o payload do pedido
 * idêntico ao que a API da nuvem faria.
 */
async function buildOrderPayloadLocally(orderId: string, tenantId: string): Promise<any> {
  // 1. Tenta buscar com joins (relacionamento completo)
  let { data: order, error: fetchError } = await supabase
    .from('orders')
    .select(`
      *,
      order_items (
        quantity,
        unit_price,
        products (
          barcode,
          ean
        )
      ),
      customers (
        name,
        phone,
        cpf,
        address,
        address_number,
        neighborhood,
        city
      )
    `)
    .eq('id', orderId)
    .eq('tenant_id', tenantId)
    .single();

  let targetOrder = order;

  // Se falhar a busca completa, tenta de forma fragmentada para evitar problemas de RLS/relações
  if (fetchError || !order) {
    console.log('[Fallback Local] Busca estruturada falhou ou não retornou dados, tentando busca fragmentada...');
    
    const { data: orderJson, error: fetchJsonError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .eq('tenant_id', tenantId)
      .single();
      
    if (fetchJsonError || !orderJson) {
       throw new Error(`Pedido não encontrado no Supabase: ${fetchJsonError?.message || 'Sem dados'}`);
    }
    
    targetOrder = orderJson;

    // Busca itens
    const { data: orderItems } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId);
      
    if (orderItems && orderItems.length > 0) {
      // Busca produto para cada item
      for (const item of orderItems) {
        if (item.product_id) {
          const { data: prod } = await supabase
            .from('products')
            .select('barcode, ean')
            .eq('id', item.product_id)
            .maybeSingle();
          if (prod) {
            item.products = prod;
          }
        }
      }
      targetOrder.order_items = orderItems;
    }

    // Busca cliente
    if (targetOrder.customer_id) {
      const { data: cust } = await supabase
        .from('customers')
        .select('*')
        .eq('id', targetOrder.customer_id)
        .maybeSingle();
      if (cust) {
        targetOrder.customers = cust;
      }
    }
  }

  const customer = targetOrder.customers || targetOrder.customer || {};
  const items = targetOrder.order_items || targetOrder.items || [];

  const dados_cliente = {
    nome: customer.name || customer.nome || 'Cliente Não Identificado',
    telefone: customer.phone || customer.telefone || '',
    cpf: customer.cpf || '',
    endereco: {
      rua: customer.address || customer.street || customer.rua || '',
      numero: customer.address_number || customer.addressNumber || customer.number || customer.numero || '',
      bairro: customer.neighborhood || customer.bairro || '',
      cidade: customer.city || customer.cidade || ''
    }
  };

  const payload_itens = items.map((item: any) => {
    const barcode = item.products?.barcode || item.products?.ean || item.barcode || item.product?.barcode || item.ean || '';
    const ean = barcode.replace(/[^0-9]/g, '');
    return {
      ean: ean,
      quantidade: item.quantity || item.quantidade || 1,
      preco_unitario: item.unit_price || item.price || item.preco_unitario || 0
    };
  });

  const payload = {
    order_id: targetOrder.id,
    tenant_id: targetOrder.tenant_id,
    dados_cliente,
    itens: payload_itens,
    pagamento: {
      forma_pagamento: targetOrder.paymentMethod || targetOrder.payment_method || targetOrder.forma_pagamento || '',
      taxa_entrega: targetOrder.deliveryFee || targetOrder.delivery_fee || targetOrder.taxa_entrega || 0,
      valor_total: targetOrder.total || targetOrder.total_amount || targetOrder.valor_total || 0
    }
  };

  // Disparo do webhook localmente se configurado
  const { data: tenantSettings } = await supabase
    .from('tenants')
    .select('erp_webhook_url, erp_webhook_secret')
    .eq('id', targetOrder.tenant_id)
    .maybeSingle();

  if (tenantSettings?.erp_webhook_url) {
    try {
      await fetch(tenantSettings.erp_webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(tenantSettings.erp_webhook_secret ? { 'Authorization': `Bearer ${tenantSettings.erp_webhook_secret}` } : {})
        },
        body: JSON.stringify(payload)
      });
    } catch (err: any) {
      console.error('[Fallback Local] Falha ao disparar webhook localmente:', err.message);
    }
  }

  return payload;
}

/**
 * Orquestra o consumo do payload da API Route e a inserção no ERP local
 */
async function handleNewOrder(orderId: string, tenantId: string) {
  try {
    console.log(`Buscando payload estruturado do pedido ${orderId}...`);
    let payload_enviado = null;
    
    // 1. Tenta fazer fetch na API Route da nuvem passando o order_id para obter o JSON estruturado
    try {
      const response = await fetch(`${API_BASE_URL}/api/integrations/erp/send-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ order_id: orderId, tenant_id: tenantId }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data && data.success && data.payload_enviado) {
          payload_enviado = data.payload_enviado;
          console.log('Payload estruturado obtido com sucesso via API Route da nuvem.');
        }
      } else {
        console.log(`[AVISO] API Route retornou status de erro: ${response.status} ${response.statusText}`);
      }
    } catch (apiErr: any) {
      console.log(`[AVISO] Erro de conexão com a API da nuvem: ${apiErr.message}`);
    }

    // Se falhou por qualquer motivo, aciona o fallback local de busca direta
    if (!payload_enviado) {
      console.log('[Fallback Local] Obtendo dados estruturados diretamente do Supabase localmente...');
      payload_enviado = await buildOrderPayloadLocally(orderId, tenantId);
    }

    if (!payload_enviado) {
      throw new Error('Falha ao obter dados estruturados do pedido pelas vias de nuvem e local.');
    }

    console.log('Iniciando inserção no ERP local...');

    // 2. Tenta inserir no banco local do ERP
    await insertIntoLocalERP(payload_enviado);

    console.log('Pedido integrado com sucesso no ERP local!');

    // 3. Atualiza o status do pedido no Supabase para 'impresso_no_pdv' (ou 'concluido_no_pdv')
    await updateOrderStatus(orderId, tenantId, 'impresso_no_pdv');

  } catch (error: any) {
    console.error(`[ERRO DE INTEGRAÇÃO] Falha ao processar o pedido ${orderId}:`, error.message);
    
    // Em caso de falha, atualiza o status para 'erro_integracao_pdv'
    await updateOrderStatus(orderId, tenantId, 'erro_integracao_pdv');
  }
}

/**
 * Atualiza o status do pedido no Supabase após a tentativa de integração
 */
async function updateOrderStatus(orderId: string, tenantId: string, newStatus: string) {
  const { error } = await supabase
    .from('orders')
    .update({ status: newStatus })
    .eq('id', orderId)
    .eq('tenant_id', tenantId);

  if (error) {
    console.error(`Erro ao atualizar status para '${newStatus}' no Supabase:`, error.message);
  } else {
    console.log(`Status do pedido atualizado no painel Web para: ${newStatus}`);
  }
}

/**
 * Mapeia as formas de pagamento do e-commerce para os IDs padrão do Linx Softpharma
 */
function mapPaymentMethod(method: string): number {
  if (!method) return 99;
  const normalized = method.toLowerCase();
  if (normalized.includes('pix')) return 5; // ID Pix no Softpharma (Exemplo)
  if (normalized.includes('cartão') || normalized.includes('cartao')) return 3; // ID Cartão
  if (normalized.includes('dinheiro')) return 1; // ID Dinheiro
  return 99; // Outros
}

/**
 * Função responsável por exportar os dados do pedido no formato de intercâmbio (JSON) 
 * consumido pelo módulo de integração de e-commerce do Linx Softpharma.
 */
async function insertIntoLocalERP(payload: any): Promise<boolean> {
  return new Promise((resolve, reject) => {
    try {
      // 1. Diretório padrão de integração do Softpharma
      const softpharmaIntegrationPath = process.env.SOFTPHARMA_INTEGRATION_DIR || 'C:\\Softpharma\\Integracao\\Entrada';
      const softpharmaLogsPath = process.env.SOFTPHARMA_LOGS_DIR || 'C:\\Softpharma\\Integracao\\Logs';
      
      // Cria as pastas se não existirem (Útil para testes no mesmo OS ou setups iniciais)
      if (!fs.existsSync(softpharmaIntegrationPath)) {
        fs.mkdirSync(softpharmaIntegrationPath, { recursive: true });
      }
      if (!fs.existsSync(softpharmaLogsPath)) {
        fs.mkdirSync(softpharmaLogsPath, { recursive: true });
      }

      // 2. Mapeamento e estruturação do Payload para o Padrão Softpharma
      const softpharmaPayload = {
        PedidoEcommerce: {
          CodigoPedido: payload.order_id,
          DataHora: new Date().toISOString(),
          Cliente: {
            Nome: payload.dados_cliente.nome,
            CPF: (payload.dados_cliente.cpf || '').replace(/[^0-9]/g, ''),
            Telefone: (payload.dados_cliente.telefone || '').replace(/[^0-9]/g, ''),
            EnderecoTeleEntrega: {
              Logradouro: payload.dados_cliente.endereco.rua,
              Numero: payload.dados_cliente.endereco.numero,
              Bairro: payload.dados_cliente.endereco.bairro,
              Cidade: payload.dados_cliente.endereco.cidade
            }
          },
          Pagamento: {
            IdMeioPagamento: mapPaymentMethod(payload.pagamento.forma_pagamento),
            DescricaoMeio: payload.pagamento.forma_pagamento,
            ValorTotal: payload.pagamento.valor_total,
            TaxaEntrega: payload.pagamento.taxa_entrega
          },
          Itens: payload.itens.map((item: any, index: number) => ({
            Sequencial: index + 1,
            EAN: item.ean, // Código de barras limpo
            Quantidade: item.quantidade,
            PrecoUnitario: item.preco_unitario
          }))
        }
      };

      // 3. Define o nome do arquivo a ser lido pelo ERP
      const fileName = `PED_${payload.order_id}_${Date.now()}.json`;
      const filePath = path.join(softpharmaIntegrationPath, fileName);

      // 4. Escreve o arquivo JSON na pasta de integração
      fs.writeFileSync(filePath, JSON.stringify(softpharmaPayload, null, 2), 'utf-8');
      console.log(`[Softpharma Integrator] Arquivo de integração gerado: ${filePath}`);

      // 5. Registra o log de auditoria
      const logMessage = `[${new Date().toISOString()}] Pedido ID: ${payload.order_id} exportado com sucesso para arquivo: ${fileName}\n`;
      const logFilePath = path.join(softpharmaLogsPath, `integracao_${new Date().toISOString().split('T')[0]}.log`);
      fs.appendFileSync(logFilePath, logMessage, 'utf-8');

      resolve(true);
    } catch (err) {
      console.error('[Softpharma Integrator] Erro ao gerar arquivo de integração:', err);
      reject(err);
    }
  });
}

// Inicia o integrador apenas se conseguir configurar o Supabase (ambiente preparado)
async function bootstrap() {
  const envPath = path.join(process.cwd(), '.env');
  if (!process.env.LOCAL_TENANT_ID) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    console.log("=========================================");
    console.log("  Bem-vindo ao FarmaFlow ERP Integrator  ");
    console.log("=========================================");
    console.log("O arquivo de configuração (.env) não foi encontrado ou está incompleto.");
    console.log("Vamos configurá-lo agora!\n");
    
    const token = await new Promise<string>(resolve => rl.question('Por favor, cole seu Token de Ativacao (Tenant ID / FF-...): ', resolve));
    
    console.log('\nValidando token e buscando configurações na nuvem...');
    
    const AGENT_SUPABASE_URL = "https://nalshjhoiecxooejpiaw.supabase.co";
    const AGENT_SUPABASE_ANON_KEY = "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy";
    
    const tempSupabase = createClient(AGENT_SUPABASE_URL, AGENT_SUPABASE_ANON_KEY);
    
    let config = null;

    try {
      const { data: tokenData, error: fetchError } = await tempSupabase
        .from('activation_tokens')
        .select('*')
        .eq('token', token.trim())
        .eq('is_used', false)
        .single();
        
      if (fetchError || !tokenData) {
        throw new Error('Token inválido ou já utilizado');
      }
      
      const { error: updateError } = await tempSupabase
        .from('activation_tokens')
        .update({ is_used: true })
        .eq('id', tokenData.id);
        
      if (updateError) {
        throw new Error('Erro ao ativar token');
      }
      
      config = {
        tenantId: tokenData.tenant_id,
        supabaseUrl: AGENT_SUPABASE_URL,
        supabaseAnonKey: AGENT_SUPABASE_ANON_KEY
      };
      
      const defaultEnvContent = `LOCAL_TENANT_ID=${config.tenantId}
SUPABASE_URL=${config.supabaseUrl}
SUPABASE_ANON_KEY=${config.supabaseAnonKey}
API_BASE_URL=https://farmaflow.nexoia.online
SOFTPHARMA_INTEGRATION_DIR=C:\\Softpharma\\Integracao\\Entrada
SOFTPHARMA_LOGS_DIR=C:\\Softpharma\\Integracao\\Logs`;

      fs.writeFileSync(envPath, defaultEnvContent);
      
      console.log('\n✅ Token ativado com sucesso! Configurações baixadas e salvas em .env');
      console.log('Reiniciando agente com as novas configurações...\n');
      
      rl.close();
      
      // Carrega as novas vars na memória
      process.env.LOCAL_TENANT_ID = config.tenantId;
      process.env.SUPABASE_URL = config.supabaseUrl;
      process.env.SUPABASE_ANON_KEY = config.supabaseAnonKey;
      process.env.API_BASE_URL = 'https://farmaflow.nexoia.online';
      
      if (initSupabaseClient()) {
        startERPIntegrator();
      }
      
    } catch (err: any) {
      console.log('\n❌ Falha ao ativar o token:', err.message);
      console.log('Fechando em 10 segundos...');
      rl.close();
      await new Promise(resolve => setTimeout(resolve, 10000));
      process.exit(1);
    }

  } else {
    // Ambiente já configurado, tentar iniciar
    if (initSupabaseClient()) {
      startERPIntegrator();
    } else {
      console.log('\nFalha ao iniciar. Verifique seu arquivo .env');
      console.log('Fechando em 10 segundos...');
      await new Promise(resolve => setTimeout(resolve, 10000));
      process.exit(1);
    }
  }
}

// Executa o bootstrap
bootstrap();
