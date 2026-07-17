import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://nalshjhoiecxooejpiaw.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy';
const supabase = createClient(supabaseUrl, supabaseKey);

export type WebhookMessage = {
  id: string;
  tenantId: string;
  type: 'SALE' | 'PURCHASE';
  ean?: string;
  internalCode?: string;
  quantity: number;
  price_sale?: number;
  retryCount: number;
  createdAt: number;
  originalPayload: any;
};

export class WebhookQueue {
  private queue: WebhookMessage[] = [];
  private processing: number = 0;
  private concurrency: number = 20; // Process up to 20 messages concurrently
  
  // Stats
  public stats = {
    pending: 0,
    processed24h: 0,
    failed: 0,
    memoryUsageMB: 0
  };

  private dlq: WebhookMessage[] = [];

  constructor() {
    if (process.env.VERCEL) return; // Skip intervals on Vercel

    // Reset 24h stats every 24h
    setInterval(() => {
      this.stats.processed24h = 0;
    }, 24 * 60 * 60 * 1000);

    // Update memory usage
    setInterval(() => {
      const used = process.memoryUsage().heapUsed / 1024 / 1024;
      this.stats.memoryUsageMB = Math.round(used * 100) / 100;
      this.stats.pending = this.queue.length;
    }, 5000);
  }

  public getStats() {
    return {
      ...this.stats,
      pending: this.queue.length,
      dlqSize: this.dlq.length
    };
  }

  public async push(message: Omit<WebhookMessage, 'id' | 'retryCount' | 'createdAt'>) {
    const fullMessage: WebhookMessage = {
      ...message,
      id: Math.random().toString(36).substring(2, 15),
      retryCount: 0,
      createdAt: Date.now()
    };

    // Priority: SALE first
    if (message.type === 'SALE') {
      // Find first PURCHASE and insert before it
      const firstPurchaseIndex = this.queue.findIndex(m => m.type === 'PURCHASE');
      if (firstPurchaseIndex === -1) {
        this.queue.push(fullMessage);
      } else {
        this.queue.splice(firstPurchaseIndex, 0, fullMessage);
      }
    } else {
      this.queue.push(fullMessage);
    }
    
    this.stats.pending = this.queue.length;
    this.processNext();
  }

  private async processNext() {
    if (this.processing >= this.concurrency || this.queue.length === 0) {
      return;
    }

    this.processing++;
    const message = this.queue.shift()!;
    this.stats.pending = this.queue.length;

    try {
      await this.processMessage(message);
      this.stats.processed24h++;
    } catch (error: any) {
      console.error(`Error processing message ${message.id}:`, error);
      
      if (message.retryCount < 3) {
        message.retryCount++;
        // Exponential backoff: 2s, 4s, 8s
        const backoff = Math.pow(2, message.retryCount) * 1000;
        setTimeout(() => {
          // Re-insert with priority
          if (message.type === 'SALE') {
             const firstPurchaseIndex = this.queue.findIndex(m => m.type === 'PURCHASE');
             if (firstPurchaseIndex === -1) {
               this.queue.push(message);
             } else {
               this.queue.splice(firstPurchaseIndex, 0, message);
             }
          } else {
             this.queue.push(message);
          }
          this.stats.pending = this.queue.length;
          this.processNext();
        }, backoff);
      } else {
        // DLQ
        this.dlq.push(message);
        this.stats.failed++;
        await this.logCriticalFailure(message, error.message);
      }
    } finally {
      this.processing--;
      this.processNext();
    }
  }

  private async processMessage(message: WebhookMessage) {
    // Busca o produto
    let prodQuery = supabase.from('products').select('*').eq('tenant_id', message.tenantId);
    if (message.ean) {
      prodQuery = prodQuery.eq('barcode', message.ean);
    } else if (message.internalCode) {
      prodQuery = prodQuery.eq('internal_code', message.internalCode);
    } else {
        throw new Error('EAN ou Código Interno não fornecido');
    }

    const { data: products, error: searchError } = await prodQuery;
    if (searchError) throw searchError;

    if (!products || products.length === 0) {
      throw new Error('Produto não encontrado');
    }

    // Busca o tenant para verificar se ignora os preços do ERP
    let ignoreErpPrices = false;
    try {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', message.tenantId)
        .single();
      if (tenant) {
        ignoreErpPrices = tenant.ignore_erp_prices === true || tenant.delivery_settings?.ignore_erp_prices === true;
      }
    } catch (e) {
      console.warn('Erro ao carregar configurações do tenant na fila:', e);
    }

    const product = products[0];
    let newStock = product.stock || 0;
    const updates: any = {};

    if (message.type === 'SALE') {
      newStock = Math.max(0, newStock - message.quantity);
      updates.stock = newStock;
      
      if (newStock === 0 && product.is_featured) {
        updates.is_featured = false;
      }
    } else if (message.type === 'PURCHASE') {
      newStock += message.quantity;
      updates.stock = newStock;
      
      if (!ignoreErpPrices && typeof message.price_sale === 'number' && message.price_sale > 0) {
        updates.price = message.price_sale;
      }
    }

    const { error: updateError } = await supabase
      .from('products')
      .update(updates)
      .eq('id', product.id);

    if (updateError) throw updateError;

    // Log success
    const logData = {
      tenant_id: message.tenantId,
      endpoint: '/sync/inventory',
      payload: message.originalPayload,
      status: 'SUCCESS',
      created_at: new Date().toISOString()
    };
    try {
      await fetch(`${process.env.VITE_APP_URL || 'http://localhost:3000'}/api/v1/integration/logs/internal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logData)
      });
    } catch (e) {
      console.error('Failed to log integration from queue:', e);
    }
  }

  private async logCriticalFailure(message: WebhookMessage, errorMsg: string) {
    const logData = {
      tenant_id: message.tenantId,
      endpoint: '/sync/inventory',
      payload: message.originalPayload,
      status: 'FAILED',
      error_message: `Falha Crítica - Necessita Intervenção: ${errorMsg}`,
      created_at: new Date().toISOString()
    };
    try {
      await fetch(`${process.env.VITE_APP_URL || 'http://localhost:3000'}/api/v1/integration/logs/internal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logData)
      });
    } catch (e) {
      console.error('Failed to log critical failure from queue:', e);
    }
  }
}

export const webhookQueue = new WebhookQueue();
