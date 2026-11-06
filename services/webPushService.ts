import webPush from "web-push";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import pkg from "pg";
import { SupabaseClient } from "@supabase/supabase-js";

const { Client } = pkg;

export interface PushSubscriptionRow {
  id: string;
  tenant_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string | null;
  created_at: string;
}

export interface VapidKeysConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const LOCAL_VAPID_FILE = path.join(process.cwd(), "vapid_keys.json");
const LOCAL_SUBS_FILE = path.join(process.cwd(), "push_subscriptions_data.json");
const STORAGE_BUCKET = "backups_empresas";
const STORAGE_VAPID_PATH = "_system/vapid_keys.json";

let cachedVapidKeys: VapidKeysConfig | null = null;
let isVapidConfigured = false;
let isTableChecked = false;

/**
 * Garante a criação da tabela push_subscriptions caso DATABASE_URL esteja configurada
 */
export async function ensurePushSubscriptionsTable(): Promise<void> {
  if (isTableChecked) return;
  isTableChecked = true;

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return;

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();
    await client.query(`
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
    `);
    console.log("[WebPush] Tabela push_subscriptions verificada com sucesso.");
  } catch (err: any) {
    console.warn("[WebPush] Aviso ao verificar tabela via PG direto:", err?.message || err);
  } finally {
    try {
      await client.end();
    } catch (_) {}
  }
}

/**
 * Obtém ou gera e persiste o par de chaves VAPID para não perder inscrições a cada reinicialização
 */
export async function getOrInitVapidKeys(
  supabaseAdmin: SupabaseClient
): Promise<VapidKeysConfig> {
  if (cachedVapidKeys && isVapidConfigured) {
    return cachedVapidKeys;
  }

  const subject =
    process.env.VAPID_SUBJECT || "mailto:contato@farmaflow.online";

  // 1. Variáveis de ambiente (.env)
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    cachedVapidKeys = {
      publicKey: process.env.VAPID_PUBLIC_KEY.trim(),
      privateKey: process.env.VAPID_PRIVATE_KEY.trim(),
      subject,
    };
    webPush.setVapidDetails(
      cachedVapidKeys.subject,
      cachedVapidKeys.publicKey,
      cachedVapidKeys.privateKey
    );
    isVapidConfigured = true;
    return cachedVapidKeys;
  }

  // 2. Arquivo local persistido (vapid_keys.json)
  try {
    if (fs.existsSync(LOCAL_VAPID_FILE)) {
      const raw = fs.readFileSync(LOCAL_VAPID_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed?.publicKey && parsed?.privateKey) {
        cachedVapidKeys = {
          publicKey: String(parsed.publicKey).trim(),
          privateKey: String(parsed.privateKey).trim(),
          subject: parsed.subject || subject,
        };
        webPush.setVapidDetails(
          cachedVapidKeys.subject,
          cachedVapidKeys.publicKey,
          cachedVapidKeys.privateKey
        );
        isVapidConfigured = true;
        return cachedVapidKeys;
      }
    }
  } catch (err) {
    console.warn("[WebPush] Aviso ao ler vapid_keys.json local:", err);
  }

  // 3. Configuração global no Supabase Storage
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .download(STORAGE_VAPID_PATH);

    if (!error && data) {
      const text = await data.text();
      const parsed = JSON.parse(text);
      if (parsed?.publicKey && parsed?.privateKey) {
        cachedVapidKeys = {
          publicKey: String(parsed.publicKey).trim(),
          privateKey: String(parsed.privateKey).trim(),
          subject: parsed.subject || subject,
        };
        try {
          fs.writeFileSync(
            LOCAL_VAPID_FILE,
            JSON.stringify(cachedVapidKeys, null, 2),
            "utf-8"
          );
        } catch (_) {}
        webPush.setVapidDetails(
          cachedVapidKeys.subject,
          cachedVapidKeys.publicKey,
          cachedVapidKeys.privateKey
        );
        isVapidConfigured = true;
        return cachedVapidKeys;
      }
    }
  } catch (_) {}

  // 4. Gera novo par de chaves VAPID válido e persiste globalmente
  const generated = webPush.generateVAPIDKeys();
  cachedVapidKeys = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject,
  };

  try {
    fs.writeFileSync(
      LOCAL_VAPID_FILE,
      JSON.stringify(cachedVapidKeys, null, 2),
      "utf-8"
    );
  } catch (err) {
    console.warn("[WebPush] Não foi possível salvar vapid_keys.json local:", err);
  }

  try {
    await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .upload(
        STORAGE_VAPID_PATH,
        JSON.stringify(cachedVapidKeys, null, 2),
        {
          contentType: "application/json",
          upsert: true,
        }
      );
  } catch (_) {}

  webPush.setVapidDetails(
    cachedVapidKeys.subject,
    cachedVapidKeys.publicKey,
    cachedVapidKeys.privateKey
  );
  isVapidConfigured = true;
  console.log("[WebPush] Par de chaves VAPID gerado e persistido com sucesso.");
  return cachedVapidKeys;
}

function loadLocalSubscriptions(): PushSubscriptionRow[] {
  try {
    if (fs.existsSync(LOCAL_SUBS_FILE)) {
      const raw = fs.readFileSync(LOCAL_SUBS_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (_) {}
  return [];
}

function saveLocalSubscriptions(rows: PushSubscriptionRow[]): void {
  try {
    fs.writeFileSync(LOCAL_SUBS_FILE, JSON.stringify(rows, null, 2), "utf-8");
  } catch (_) {}
}

/**
 * Registra ou atualiza uma inscrição Web Push isolada por tenant_id
 */
export async function savePushSubscription(
  supabaseAdmin: SupabaseClient,
  params: {
    tenantId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string;
  }
): Promise<PushSubscriptionRow> {
  await ensurePushSubscriptionsTable();

  const cleanTenantId = String(params.tenantId || "").trim();
  const cleanEndpoint = String(params.endpoint || "").trim();
  const cleanP256dh = String(params.p256dh || "").trim();
  const cleanAuth = String(params.auth || "").trim();
  const cleanUa = String(params.userAgent || "").trim();
  const nowIso = new Date().toISOString();

  const row: PushSubscriptionRow = {
    id: crypto.randomUUID(),
    tenant_id: cleanTenantId,
    endpoint: cleanEndpoint,
    p256dh: cleanP256dh,
    auth: cleanAuth,
    user_agent: cleanUa || null,
    created_at: nowIso,
  };

  // 1. Salva na tabela push_subscriptions do Supabase
  try {
    const { data, error } = await supabaseAdmin
      .from("push_subscriptions")
      .upsert(
        {
          tenant_id: cleanTenantId,
          endpoint: cleanEndpoint,
          p256dh: cleanP256dh,
          auth: cleanAuth,
          user_agent: cleanUa || null,
          created_at: nowIso,
        },
        { onConflict: "endpoint" }
      )
      .select("*")
      .maybeSingle();

    if (!error && data) {
      row.id = data.id || row.id;
    } else if (error) {
      // Caso a constraint unique em endpoint ainda não exista, verifica manualmente
      const { data: existing } = await supabaseAdmin
        .from("push_subscriptions")
        .select("id")
        .eq("endpoint", cleanEndpoint)
        .maybeSingle();

      if (existing?.id) {
        await supabaseAdmin
          .from("push_subscriptions")
          .update({
            tenant_id: cleanTenantId,
            p256dh: cleanP256dh,
            auth: cleanAuth,
            user_agent: cleanUa || null,
          })
          .eq("id", existing.id);
        row.id = existing.id;
      } else {
        await supabaseAdmin.from("push_subscriptions").insert(row);
      }
    }
  } catch (err: any) {
    console.warn("[WebPush] Fallback ativado ao salvar em push_subscriptions:", err?.message || err);
  }

  // 2. Mantém espelho local para resiliência total
  const localRows = loadLocalSubscriptions();
  const idx = localRows.findIndex((r) => r.endpoint === cleanEndpoint);
  if (idx >= 0) {
    localRows[idx] = { ...localRows[idx], ...row };
  } else {
    localRows.push(row);
  }
  saveLocalSubscriptions(localRows);

  return row;
}

/**
 * Busca todas as inscrições ativas de uma loja específica (tenant_id)
 */
export async function getTenantPushSubscriptions(
  supabaseAdmin: SupabaseClient,
  tenantId: string
): Promise<PushSubscriptionRow[]> {
  await ensurePushSubscriptionsTable();

  const cleanTenantId = String(tenantId || "").trim();
  const byEndpoint = new Map<string, PushSubscriptionRow>();
  let supabaseQuerySucceeded = false;

  try {
    const { data, error } = await supabaseAdmin
      .from("push_subscriptions")
      .select("*")
      .eq("tenant_id", cleanTenantId);

    if (!error && Array.isArray(data)) {
      supabaseQuerySucceeded = true;
      for (const item of data) {
        if (item?.endpoint && item?.p256dh && item?.auth) {
          byEndpoint.set(String(item.endpoint), {
            id: item.id || crypto.randomUUID(),
            tenant_id: String(item.tenant_id || cleanTenantId),
            endpoint: String(item.endpoint),
            p256dh: String(item.p256dh),
            auth: String(item.auth),
            user_agent: item.user_agent || null,
            created_at: item.created_at || new Date().toISOString(),
          });
        }
      }
    }
  } catch (err: any) {
    console.warn("[WebPush] Aviso ao consultar push_subscriptions no Supabase:", err?.message || err);
  }

  if (supabaseQuerySucceeded) {
    // Mantém o arquivo espelho sincronizado com o Supabase (removendo registros que foram apagados no banco)
    const allLocal = loadLocalSubscriptions();
    const otherTenantsLocal = allLocal.filter((r) => r.tenant_id !== cleanTenantId);
    const updatedLocal = [...otherTenantsLocal, ...Array.from(byEndpoint.values())];
    if (updatedLocal.length !== allLocal.length) {
      saveLocalSubscriptions(updatedLocal);
    }
    return Array.from(byEndpoint.values());
  }

  // Fallback apenas se a tabela não existir ou o Supabase estiver inacessível
  const localRows = loadLocalSubscriptions().filter(
    (r) => r.tenant_id === cleanTenantId && r.endpoint && r.p256dh && r.auth
  );
  for (const item of localRows) {
    if (!byEndpoint.has(item.endpoint)) {
      byEndpoint.set(item.endpoint, item);
    }
  }

  return Array.from(byEndpoint.values());
}

/**
 * Verifica se um endpoint de push específico existe ativo na tabela push_subscriptions do Supabase para o tenant atual.
 */
export async function verifyPushSubscriptionExists(
  supabaseAdmin: SupabaseClient,
  tenantId: string,
  endpoint: string
): Promise<boolean> {
  await ensurePushSubscriptionsTable();

  const cleanTenantId = String(tenantId || "").trim();
  const cleanEndpoint = String(endpoint || "").trim();
  if (!cleanEndpoint) return false;

  try {
    let query = supabaseAdmin
      .from("push_subscriptions")
      .select("id, endpoint, tenant_id")
      .eq("endpoint", cleanEndpoint);

    if (cleanTenantId) {
      query = query.eq("tenant_id", cleanTenantId);
    }

    const { data, error } = await query.maybeSingle();

    if (!error) {
      const exists = Boolean(data && data.endpoint);
      if (!exists) {
        // Garante remoção também do espelho local caso tenha sido excluído no Supabase
        const localRows = loadLocalSubscriptions();
        const filtered = localRows.filter(
          (r) =>
            !(
              r.endpoint === cleanEndpoint &&
              (!cleanTenantId || r.tenant_id === cleanTenantId)
            )
        );
        if (filtered.length !== localRows.length) {
          saveLocalSubscriptions(filtered);
        }
      }
      return exists;
    }
  } catch (err: any) {
    console.warn("[WebPush] Erro ao verificar existência da subscrição no Supabase:", err?.message || err);
  }

  // Fallback para espelho local caso a tabela ainda não exista no banco
  const localRows = loadLocalSubscriptions();
  return localRows.some(
    (r) =>
      r.endpoint === cleanEndpoint &&
      (!cleanTenantId || r.tenant_id === cleanTenantId)
  );
}

/**
 * Remove um endpoint inválido/expirado (HTTP 404 ou 410)
 */
export async function removePushSubscriptionByEndpoint(
  supabaseAdmin: SupabaseClient,
  endpoint: string
): Promise<void> {
  const cleanEndpoint = String(endpoint || "").trim();
  if (!cleanEndpoint) return;

  try {
    await supabaseAdmin
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", cleanEndpoint);
  } catch (_) {}

  const localRows = loadLocalSubscriptions();
  const filtered = localRows.filter((r) => r.endpoint !== cleanEndpoint);
  if (filtered.length !== localRows.length) {
    saveLocalSubscriptions(filtered);
  }
}

/**
 * Dispara notificação Web Push promocional para todos os dispositivos inscritos na loja (tenant_id)
 */
export async function sendPromotionalPushToTenant(
  supabaseAdmin: SupabaseClient,
  params: {
    tenantId: string;
    tenantSlug?: string;
    productId?: string;
    title: string;
    body: string;
    imageUrl?: string;
    targetUrl?: string;
    iconUrl?: string;
  }
): Promise<{
  success: boolean;
  sentCount: number;
  failedCount: number;
  removedCount: number;
  totalSubscribers: number;
}> {
  await getOrInitVapidKeys(supabaseAdmin);

  const subscriptions = await getTenantPushSubscriptions(
    supabaseAdmin,
    params.tenantId
  );

  let sentCount = 0;
  let failedCount = 0;
  let removedCount = 0;

  const cleanSlug = String(params.tenantSlug || "").trim();
  const cleanProductId = String(params.productId || "").trim();
  let resolvedUrl = String(params.targetUrl || "").trim();

  if (!resolvedUrl) {
    const baseStoreUrl = cleanSlug ? `/loja/${cleanSlug}` : "/";
    resolvedUrl = cleanProductId
      ? `${baseStoreUrl}?product=${encodeURIComponent(cleanProductId)}`
      : baseStoreUrl;
  } else if (
    cleanProductId &&
    !resolvedUrl.includes("product=") &&
    !resolvedUrl.includes("produto=") &&
    !resolvedUrl.includes("oferta=")
  ) {
    const sep = resolvedUrl.includes("?") ? "&" : "?";
    resolvedUrl = `${resolvedUrl}${sep}product=${encodeURIComponent(cleanProductId)}`;
  }

  const payloadString = JSON.stringify({
    title: params.title,
    body: params.body,
    icon: params.iconUrl || "/icon-192.svg",
    badge: params.iconUrl || "/icon-192.svg",
    image: params.imageUrl || undefined,
    imageUrl: params.imageUrl || undefined,
    url: resolvedUrl,
    targetUrl: resolvedUrl,
    tenantId: params.tenantId,
    tenantSlug: cleanSlug || null,
    productId: cleanProductId || null,
    data: {
      url: resolvedUrl,
      targetUrl: resolvedUrl,
      tenantId: params.tenantId,
      tenantSlug: cleanSlug || null,
      productId: cleanProductId || null,
    },
    tag: cleanProductId ? `promo-${cleanProductId}-${Date.now()}` : `promo-${Date.now()}`,
    actionTitle: "Ver Oferta Agora",
  });

  await Promise.all(
    subscriptions.map(async (sub) => {
      if (
        sub.endpoint &&
        sub.endpoint.startsWith("https://preview-fallback.farmaflow.local/")
      ) {
        sentCount++;
        return;
      }

      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };

      try {
        await webPush.sendNotification(pushSubscription, payloadString, {
          TTL: 86400,
          urgency: "high",
        });
        sentCount++;
      } catch (err: any) {
        const statusCode = Number(err?.statusCode || err?.status || 0);
        if (statusCode === 404 || statusCode === 410) {
          removedCount++;
          await removePushSubscriptionByEndpoint(supabaseAdmin, sub.endpoint);
        } else {
          failedCount++;
          console.warn(
            `[WebPush] Falha ao enviar para endpoint (${statusCode}):`,
            err?.message || err
          );
        }
      }
    })
  );

  return {
    success: true,
    sentCount,
    failedCount,
    removedCount,
    totalSubscribers: Math.max(0, subscriptions.length - removedCount),
  };
}
