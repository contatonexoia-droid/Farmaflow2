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

const LOCAL_SUBS_FILE = path.join(process.cwd(), "push_subscriptions_data.json");

let cachedVapidKeys: VapidKeysConfig | null = null;
let isVapidConfigured = false;
let hasWarnedMissingVapid = false;
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
        endpoint TEXT NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_agent TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
        CONSTRAINT push_subscriptions_tenant_id_endpoint_key UNIQUE (tenant_id, endpoint)
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
 * Lê as chaves VAPID fixas exclusivamente das variáveis de ambiente.
 * NUNCA gera chaves aleatórias em memória ou em arquivo local do container,
 * evitando erro HTTP 403 nos inscritos existentes após deploys na Easypanel.
 */
export async function getOrInitVapidKeys(
  _supabaseAdmin?: SupabaseClient
): Promise<VapidKeysConfig | null> {
  const envPublicKey = String(
    process.env.VAPID_PUBLIC_KEY ||
      process.env.WEB_PUSH_PUBLIC_KEY ||
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
      process.env.VITE_VAPID_PUBLIC_KEY ||
      ""
  ).trim();

  const envPrivateKey = String(
    process.env.VAPID_PRIVATE_KEY || process.env.WEB_PUSH_PRIVATE_KEY || ""
  ).trim();

  const envSubject = String(
    process.env.VAPID_SUBJECT ||
      process.env.WEB_PUSH_SUBJECT ||
      "mailto:contato@farmaflow.site"
  ).trim();

  if (!envPublicKey || !envPrivateKey) {
    if (!hasWarnedMissingVapid) {
      hasWarnedMissingVapid = true;
      console.warn(
        "[WebPush] AVISO: Variáveis VAPID_PUBLIC_KEY e/ou VAPID_PRIVATE_KEY não configuradas no ambiente. " +
          "Nenhuma chave aleatória será gerada para não invalidar clientes inscritos. " +
          "Configure VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT (padrão mailto:contato@farmaflow.site) na Easypanel."
      );
    }
    return null;
  }

  if (
    cachedVapidKeys &&
    isVapidConfigured &&
    cachedVapidKeys.publicKey === envPublicKey &&
    cachedVapidKeys.privateKey === envPrivateKey &&
    cachedVapidKeys.subject === envSubject
  ) {
    return cachedVapidKeys;
  }

  try {
    webPush.setVapidDetails(envSubject, envPublicKey, envPrivateKey);
    cachedVapidKeys = {
      publicKey: envPublicKey,
      privateKey: envPrivateKey,
      subject: envSubject,
    };
    isVapidConfigured = true;
    hasWarnedMissingVapid = false;
    return cachedVapidKeys;
  } catch (err: any) {
    console.warn(
      "[WebPush] AVISO: Falha ao configurar chaves VAPID das variáveis de ambiente:",
      err?.message || err
    );
    cachedVapidKeys = null;
    isVapidConfigured = false;
    return null;
  }
}

/**
 * Localiza todos os tenant_id associados a um endpoint antigo
 * (usado na auto-renovação pushsubscriptionchange do Service Worker para preservar múltiplas lojas)
 */
export async function resolveTenantIdsByEndpoint(
  supabaseAdmin: SupabaseClient,
  endpoint: string
): Promise<string[]> {
  const cleanEndpoint = String(endpoint || "").trim();
  if (!cleanEndpoint) return [];

  const tenantIds = new Set<string>();

  try {
    const { data, error } = await supabaseAdmin
      .from("push_subscriptions")
      .select("tenant_id")
      .eq("endpoint", cleanEndpoint);

    if (!error && Array.isArray(data)) {
      for (const row of data) {
        const tid = String(row?.tenant_id || "").trim();
        if (tid) tenantIds.add(tid);
      }
    }
  } catch (_) {}

  if (tenantIds.size === 0) {
    const localRows = loadLocalSubscriptions();
    for (const r of localRows) {
      if (r.endpoint === cleanEndpoint && r.tenant_id) {
        const tid = String(r.tenant_id).trim();
        if (tid) tenantIds.add(tid);
      }
    }
  }

  return Array.from(tenantIds);
}

/**
 * Localiza o primeiro tenant_id associado a um endpoint antigo (compatibilidade)
 */
export async function resolveTenantIdByEndpoint(
  supabaseAdmin: SupabaseClient,
  endpoint: string
): Promise<string | null> {
  const ids = await resolveTenantIdsByEndpoint(supabaseAdmin, endpoint);
  return ids.length > 0 ? ids[0] : null;
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

export function isValidRealPushEndpoint(endpoint: string): boolean {
  const clean = String(endpoint || "").trim();
  if (!clean) return false;
  if (!clean.startsWith("https://")) return false;
  const lower = clean.toLowerCase();
  if (
    lower.includes("preview-fallback.farmaflow.local") ||
    /^https:\/\/[^/]+\.local(\/|$)/i.test(lower)
  ) {
    return false;
  }
  return true;
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

  if (!isValidRealPushEndpoint(cleanEndpoint)) {
    throw new Error(
      "Endpoint Web Push inválido ou fictício (preview-fallback bloqueado)."
    );
  }
  if (!cleanP256dh || !cleanAuth) {
    throw new Error("Chaves p256dh e auth são obrigatórias para inscrição Web Push.");
  }

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

  // 1. Salva na tabela push_subscriptions do Supabase isolado por (tenant_id, endpoint)
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
        { onConflict: "tenant_id,endpoint" }
      )
      .select("*")
      .maybeSingle();

    if (!error && data) {
      row.id = data.id || row.id;
    } else if (error) {
      // Fallback seguro isolado por (tenant_id, endpoint) — nunca sobrescreve outra drogaria
      const { data: existingList } = await supabaseAdmin
        .from("push_subscriptions")
        .select("id")
        .eq("tenant_id", cleanTenantId)
        .eq("endpoint", cleanEndpoint)
        .limit(1);

      const existing = Array.isArray(existingList) ? existingList[0] : null;

      if (existing?.id) {
        await supabaseAdmin
          .from("push_subscriptions")
          .update({
            p256dh: cleanP256dh,
            auth: cleanAuth,
            user_agent: cleanUa || null,
          })
          .eq("id", existing.id)
          .eq("tenant_id", cleanTenantId);
        row.id = existing.id;
      } else {
        const { data: inserted, error: insertError } = await supabaseAdmin
          .from("push_subscriptions")
          .insert(row)
          .select("id")
          .maybeSingle();
        if (!insertError && inserted?.id) {
          row.id = inserted.id;
        } else if (insertError) {
          console.warn(
            "[WebPush] Aviso ao inserir inscrição multi-loja (verifique se a constraint UNIQUE(tenant_id, endpoint) foi aplicada no Supabase):",
            insertError.message || insertError
          );
        }
      }
    }
  } catch (err: any) {
    console.warn("[WebPush] Fallback ativado ao salvar em push_subscriptions:", err?.message || err);
  }

  // 2. Mantém espelho local isolado por (tenant_id, endpoint) para resiliência total
  const localRows = loadLocalSubscriptions();
  const idx = localRows.findIndex(
    (r) => r.tenant_id === cleanTenantId && r.endpoint === cleanEndpoint
  );
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

  const invalidSubsToPurge: Array<{ id?: string; endpoint: string }> = [];

  try {
    const { data, error } = await supabaseAdmin
      .from("push_subscriptions")
      .select("*")
      .eq("tenant_id", cleanTenantId);

    if (!error && Array.isArray(data)) {
      supabaseQuerySucceeded = true;
      for (const item of data) {
        const ep = String(item?.endpoint || "").trim();
        if (!ep) continue;
        if (!isValidRealPushEndpoint(ep)) {
          invalidSubsToPurge.push({ id: item?.id ? String(item.id) : undefined, endpoint: ep });
          continue;
        }
        if (item?.p256dh && item?.auth) {
          byEndpoint.set(ep, {
            id: item.id || crypto.randomUUID(),
            tenant_id: String(item.tenant_id || cleanTenantId),
            endpoint: ep,
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

  if (invalidSubsToPurge.length > 0) {
    console.warn(
      `[WebPush] Removendo ${invalidSubsToPurge.length} endpoint(s) fictício(s)/inválido(s) do tenant ${cleanTenantId}.`
    );
    await Promise.all(
      invalidSubsToPurge.map((item) =>
        removePushSubscriptionByEndpoint(supabaseAdmin, item.endpoint, {
          id: item.id,
          tenantId: cleanTenantId,
        })
      )
    );
  }

  if (supabaseQuerySucceeded) {
    // Mantém o arquivo espelho sincronizado com o Supabase (removendo registros inválidos ou apagados)
    const allLocal = loadLocalSubscriptions();
    const otherTenantsLocal = allLocal.filter(
      (r) => r.tenant_id !== cleanTenantId && isValidRealPushEndpoint(r.endpoint)
    );
    const updatedLocal = [...otherTenantsLocal, ...Array.from(byEndpoint.values())];
    if (updatedLocal.length !== allLocal.length) {
      saveLocalSubscriptions(updatedLocal);
    }
    return Array.from(byEndpoint.values());
  }

  // Fallback apenas se a tabela não existir ou o Supabase estiver inacessível
  const localRows = loadLocalSubscriptions().filter(
    (r) =>
      r.tenant_id === cleanTenantId &&
      isValidRealPushEndpoint(r.endpoint) &&
      r.p256dh &&
      r.auth
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
  if (!isValidRealPushEndpoint(cleanEndpoint)) return false;

  try {
    let query = supabaseAdmin
      .from("push_subscriptions")
      .select("id, endpoint, tenant_id")
      .eq("endpoint", cleanEndpoint);

    if (cleanTenantId) {
      query = query.eq("tenant_id", cleanTenantId);
    }

    const { data, error } = await query.limit(1);

    if (!error) {
      const exists = Array.isArray(data) && data.length > 0 && Boolean(data[0]?.endpoint);
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
 * Remove uma inscrição específica isolada pelo `id` da linha ou pela combinação `(tenant_id, endpoint)`
 * (usado na limpeza de HTTP 404/410 e na troca de oldEndpoint sem afetar outras drogarias).
 */
export async function removePushSubscriptionByEndpoint(
  supabaseAdmin: SupabaseClient,
  endpoint: string,
  options?: { id?: string; tenantId?: string }
): Promise<void> {
  const cleanEndpoint = String(endpoint || "").trim();
  const cleanId = String(options?.id || "").trim();
  const cleanTenantId = String(options?.tenantId || "").trim();

  if (!cleanId && !cleanEndpoint) return;

  try {
    if (cleanId) {
      let query = supabaseAdmin.from("push_subscriptions").delete().eq("id", cleanId);
      if (cleanTenantId) {
        query = query.eq("tenant_id", cleanTenantId);
      }
      await query;
    } else if (cleanTenantId) {
      await supabaseAdmin
        .from("push_subscriptions")
        .delete()
        .eq("tenant_id", cleanTenantId)
        .eq("endpoint", cleanEndpoint);
    } else {
      await supabaseAdmin
        .from("push_subscriptions")
        .delete()
        .eq("endpoint", cleanEndpoint);
    }
  } catch (_) {}

  const localRows = loadLocalSubscriptions();
  const filtered = localRows.filter((r) => {
    if (cleanId && r.id === cleanId && (!cleanTenantId || r.tenant_id === cleanTenantId)) {
      return false;
    }
    if (cleanTenantId && cleanEndpoint) {
      return !(r.tenant_id === cleanTenantId && r.endpoint === cleanEndpoint);
    }
    if (!cleanId && !cleanTenantId && cleanEndpoint) {
      return r.endpoint !== cleanEndpoint;
    }
    return true;
  });
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
  errorStatuses: number[];
  summary: string;
}> {
  const keys = await getOrInitVapidKeys(supabaseAdmin);

  const subscriptions = await getTenantPushSubscriptions(
    supabaseAdmin,
    params.tenantId
  );

  if (!keys) {
    return {
      success: false,
      sentCount: 0,
      failedCount: subscriptions.length,
      removedCount: 0,
      totalSubscribers: subscriptions.length,
      errorStatuses: [],
      summary:
        "Chaves VAPID não configuradas nas variáveis de ambiente (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).",
    };
  }

  let sentCount = 0;
  let failedCount = 0;
  let removedCount = 0;
  const errorStatusesSet = new Set<number>();

  const cleanSlug = String(params.tenantSlug || "").trim();
  const cleanProductId = String(params.productId || "").trim();
  let resolvedUrl = String(params.targetUrl || "").trim();

  if (!resolvedUrl) {
    const baseStoreUrl = cleanSlug ? `/loja/${cleanSlug}` : "/";
    resolvedUrl = cleanProductId
      ? `${baseStoreUrl}?produto=${encodeURIComponent(cleanProductId)}`
      : baseStoreUrl;
  } else if (
    cleanProductId &&
    !resolvedUrl.includes("produto=") &&
    !resolvedUrl.includes("product=") &&
    !resolvedUrl.includes("oferta=")
  ) {
    const sep = resolvedUrl.includes("?") ? "&" : "?";
    resolvedUrl = `${resolvedUrl}${sep}produto=${encodeURIComponent(cleanProductId)}`;
  }

  if (!/[?&]origem=/i.test(resolvedUrl)) {
    const originSep = resolvedUrl.includes("?") ? "&" : "?";
    resolvedUrl = `${resolvedUrl}${originSep}origem=push`;
  }

  const payloadString = JSON.stringify({
    title: params.title,
    body: params.body,
    icon: params.iconUrl || "/icon-192.svg",
    badge: params.iconUrl || "/icon-192.svg",
    image: params.imageUrl || undefined,
    imageUrl: params.imageUrl || undefined,
    url: resolvedUrl,
    link: resolvedUrl,
    targetUrl: resolvedUrl,
    tenantId: params.tenantId,
    tenantSlug: cleanSlug || null,
    productId: cleanProductId || null,
    data: {
      url: resolvedUrl,
      link: resolvedUrl,
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
      if (!isValidRealPushEndpoint(sub.endpoint)) {
        removedCount++;
        console.warn(
          `[WebPush] Removendo endpoint fictício/inválido antes do disparo: ${sub.endpoint}`
        );
        await removePushSubscriptionByEndpoint(supabaseAdmin, sub.endpoint, {
          id: sub.id,
          tenantId: sub.tenant_id || params.tenantId,
        });
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
        const sendResponse = await webPush.sendNotification(
          pushSubscription,
          payloadString,
          {
            TTL: 86400,
            urgency: "high",
          }
        );
        sentCount++;
        console.log(
          `[WebPush] Push entregue com sucesso (HTTP ${sendResponse?.statusCode || 201}) para ${sub.endpoint.slice(0, 60)}...`
        );
      } catch (err: any) {
        const statusCode = Number(err?.statusCode || err?.status || 0);
        if (statusCode > 0) {
          errorStatusesSet.add(statusCode);
        }

        const errDetail = String(err?.body || err?.message || err || "").trim();

        // Limpeza automática: remove do banco APENAS erros definitivos do navegador (404 e 410),
        // filtrando pelo id/tenant_id da linha para não afetar inscrições em outras drogarias.
        // NÃO deleta inscrições quando o erro for 403 (ou 401), preservando os clientes para renovação silenciosa.
        if (statusCode === 404 || statusCode === 410) {
          removedCount++;
          console.log(
            `[WebPush] Assinatura expirada/inexistente removida automaticamente (HTTP ${statusCode}) [id=${sub.id} tenant=${sub.tenant_id || params.tenantId} endpoint=${sub.endpoint.slice(0, 60)}...]`
          );
          await removePushSubscriptionByEndpoint(supabaseAdmin, sub.endpoint, {
            id: sub.id,
            tenantId: sub.tenant_id || params.tenantId,
          });
        } else {
          failedCount++;
          console.warn(
            `[WebPush] Falha no envio para endpoint (HTTP ${statusCode || "N/A"} - assinatura preservada) [endpoint=${sub.endpoint.slice(0, 60)}...]: ${errDetail}`
          );
        }
      }
    })
  );

  const remainingSubscribers = Math.max(0, subscriptions.length - removedCount);
  const parts: string[] = [
    `Enviado para ${sentCount} ${sentCount === 1 ? "aparelho" : "aparelhos"}`,
  ];
  if (removedCount > 0) {
    parts.push(
      `${removedCount} ${
        removedCount === 1
          ? "inválido/expirado removido"
          : "inválidos/expirados removidos"
      }`
    );
  }
  if (failedCount > 0) {
    parts.push(`${failedCount} ${failedCount === 1 ? "falha" : "falhas"}`);
  }
  const summary = parts.join(" • ");

  console.log(
    `[WebPush] Resumo do disparo (tenant=${params.tenantId}): ${summary} | Restantes ativos=${remainingSubscribers}`
  );

  return {
    success: true,
    sentCount,
    failedCount,
    removedCount,
    totalSubscribers: remainingSubscribers,
    errorStatuses: Array.from(errorStatusesSet),
    summary,
  };
}
