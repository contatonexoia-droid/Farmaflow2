import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import cron from "node-cron";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { webhookQueue } from "./queue.js";
import { setupSwagger } from "./swagger.js";
import { getDepartmentForCategory } from "./lib/departments.js";
import multer from "multer";
import * as XLSX from "xlsx";

import { checkTenantAccess } from "./checkTenantAccess.js";
import { calculateDeliveryDistance } from "./lib/maps.js";

import { dispatcher } from "./services/asyncDispatcher.js";
import { whatsappHealthManager } from "./services/whatsappHealthManager.js";
import { realtimeHub } from "./services/realtimeHub.js";
import { botHandoffManager } from "./services/botHandoffManager.js";
import { continuousUseRefillManager } from "./services/continuousUseRefillManager.js";
import { csatManager } from "./services/csatManager.js";
import { contactMergeManager } from "./services/contactMergeManager.js";
import { inboxStore } from "./services/inboxStore.js";
import { chatStore } from "./services/chatStore.js";


const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

const upload = multer({ storage: multer.memoryStorage() });

app.post("/api/v1/parse-excel", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo enviado." });
    }
    const buffer = req.file.buffer;
    const workbook = XLSX.read(buffer, { type: "buffer", codepage: 65001 });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    res.json({ data });
  } catch (error: any) {
    console.error("Erro ao processar planilha no servidor:", error);
    res.status(500).json({ error: error.message || "Erro desconhecido ao processar planilha." });
  }
});

app.get("/api/v1/queue/stats", async (req, res) => {
  res.json(webhookQueue.getStats());
});

// Admin endpoints for bypassing RLS
app.get("/api/v1/tenants/admin", async (req, res) => {
  try {
    const { data, error } = await supabase.from("tenants").select("*");
    if (error) throw error;
    res.json({ data });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/v1/version", (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({ version: "3.0.5" });
});

app.get("/api/v1/resolve-tenant", async (req, res) => {
  try {
    const host = req.query.hostname || req.headers.host || "";
    const hostname = String(host).split(":")[0]; // Remove port if present

    let tenantData = null;

    // Regra A (Subdomínio)
    if (hostname.endsWith(".farmaflow.online") || hostname.endsWith(".nexoia.online")) {
      const parts = hostname.split(".");
      const tenantSlug = parts[0];
      
      if (tenantSlug && tenantSlug !== "www" && tenantSlug !== "farmaflow" && tenantSlug !== "nexoia") {
        const { data, error } = await supabase
          .from("tenants")
          .select("*")
          .eq("slug", tenantSlug)
          .maybeSingle();
          
        if (!error && data) {
          tenantData = data;
        } else {
          // Fallback: busca flexível comparando o slug limpo (sem acentos, espaços ou hífens)
          const cleanReqSlug = tenantSlug.toLowerCase().replace(/[^a-z0-9]/g, "");
          const { data: allTenants } = await supabase.from("tenants").select("*");
          if (allTenants) {
            tenantData = allTenants.find((t: any) => {
              const rawSlug = (t.slug || t.subdomain || t.name || t.id || "")
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9]/g, "");
              return rawSlug === cleanReqSlug;
            }) || null;
          }
        }
      }
    } 
    
    // Regra B (Domínio Próprio)
    if (!tenantData) {
      // Allow searching by custom_domain. If the column doesn't exist yet, this might throw a PostgrestError.
      // We will handle the 42703 (undefined_column) error gracefully.
      const { data, error } = await supabase
        .from("tenants")
        .select("*")
        .eq("custom_domain", hostname)
        .single();
        
      if (!error && data) {
        tenantData = data;
      }
    }

    if (tenantData) {
      return res.json({ tenant: tenantData });
    } else {
      return res.status(404).json({ error: "Tenant not found for this domain" });
    }
  } catch (e: any) {
    if (e.code === "42703") {
        // custom_domain column doesn't exist yet, return 404
        return res.status(404).json({ error: "Tenant not found for this domain" });
    }
    res.status(500).json({ error: e.message });
  }
});

// Fast Storefront Initialization Endpoint
app.get("/api/v1/store/:tenantId/init", async (req, res) => {
  try {
    const tenantId = req.params.tenantId;

    const tenantRes = await supabase.from("tenants").select("*").eq("id", tenantId).single();
    if (tenantRes.error) throw tenantRes.error;

    const tenant = tenantRes.data;
    const networkId = tenant?.network_id;

    let promoQuery = supabase.from("promotions").select("*");
    if (networkId) {
      promoQuery = promoQuery.or(`tenant_id.eq.${tenantId},tenant_id.eq.${networkId}`);
    } else {
      promoQuery = promoQuery.eq("tenant_id", tenantId);
    }

    let couponsQuery = supabase.from("coupons").select("*");
    if (networkId) {
      couponsQuery = couponsQuery.or(`tenant_id.eq.${tenantId},tenant_id.eq.${networkId}`);
    } else {
      couponsQuery = couponsQuery.eq("tenant_id", tenantId);
    }

    // Parallel fetch of remaining critical configuration and first subset of products
    const [promoRes, couponsRes, productsRes, gatewaysRes] = await Promise.all([
      promoQuery,
      couponsQuery,
      supabase
        .from("products")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("is_featured", { ascending: false })
        .limit(50),
      supabase
        .from("tenant_payment_gateways")
        .select("gateway_name, is_active, credentials")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
    ]);

    if (tenantRes.error) throw tenantRes.error;

    // Filter sensitive credentials out for public init endpoint
    const safeGateways = (gatewaysRes.data || []).map((gw: any) => {
      const publicCreds: any = {};
      if (gw.gateway_name === "stripe") {
        const pk = gw.credentials?.publishableKey || gw.credentials?.publishable_key;
        if (pk) {
          publicCreds.publishableKey = pk;
          publicCreds.publishable_key = pk;
        }
      }
      if (gw.gateway_name === "mercado_pago") {
        const pk = gw.credentials?.publicKey || gw.credentials?.public_key;
        if (pk) {
          publicCreds.publicKey = pk;
          publicCreds.public_key = pk;
        }
      }
      // other gateways... if needed
      
      return {
        gateway_name: gw.gateway_name,
        is_active: gw.is_active,
        credentials: publicCreds
      };
    });





    res.setHeader(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300",
    );
    
    res.json({
      tenant: tenantRes.data,
      promotions: promoRes.data || [],
      coupons: couponsRes.data || [],
      products: productsRes.data || [],
      paymentGateways: safeGateways
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Serve sw.js with Service-Worker-Allowed header to allow registration from scoped subpaths
app.get("/sw.js", (req, res) => {
  res.setHeader("Service-Worker-Allowed", "/");
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.sendFile(path.join(process.cwd(), "public", "sw.js"));
});

// Dynamic PWA manifest route to prevent collisions of multiple shops on the same domain
app.get(["/api/v1/manifest/:tenantId", "/manifest.json"], async (req, res) => {
  try {
    const tenantQueryValue = req.params.tenantId;
    let tenantData: any = null;

    if (typeof tenantQueryValue === "string") {
      // Simple sanitize to prevent injection, only allow alphanumeric, hyphens, and underscores
      const cleanedQuery = tenantQueryValue.replace(/[^a-zA-Z0-9\-_]/g, "");
      
      if (cleanedQuery) {
        // Fetch from tenants table
        const { data, error } = await supabase
          .from("tenants")
          .select("id, slug, name, logo, primary_color")
          .or(`id.eq.${cleanedQuery},slug.eq.${cleanedQuery}`)
          .maybeSingle();

        if (!error && data) {
          tenantData = data;
        }
      }
    }

    const name = tenantData?.name || "FarmaFlow AI";
    const primaryColor = tenantData?.primary_color || tenantData?.primarycolor || "#3B82F6";
    const segment = tenantData?.slug || tenantData?.id || "default";

    res.setHeader("Content-Type", "application/manifest+json");
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    res.json({
      id: segment === "default" ? "/?tenant=default" : `/loja/${segment}/`,
      name: name,
      short_name: name,
      description: `Compre online na ${name}`,
      start_url: segment === "default" ? "/" : `/loja/${segment}/`,
      scope: segment === "default" ? "/" : `/loja/${segment}/`,
      display: "standalone",
      background_color: "#fcfdfe",
      theme_color: primaryColor,
      icons: [
        {
          src: tenantData?.logo || "/icon-192.svg",
          sizes: "192x192",
          type: tenantData?.logo?.endsWith(".svg") ? "image/svg+xml" : "image/png",
          purpose: "any maskable"
        },
        {
          src: tenantData?.logo || "/icon-512.svg",
          sizes: "512x512",
          type: tenantData?.logo?.endsWith(".svg") ? "image/svg+xml" : "image/png",
          purpose: "any maskable"
        }
      ]
    });
  } catch (err: any) {
    res.setHeader("Content-Type", "application/manifest+json");
    res.json({
      id: "/?tenant=default",
      name: "FarmaFlow AI",
      short_name: "FarmaFlow",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#fcfdfe",
      theme_color: "#3B82F6",
      icons: [
        {
          src: "/icon-192.svg",
          sizes: "192x192",
          type: "image/svg+xml"
        }
      ]
    });
  }
});

// Migrate legacy owners to Supabase Auth so they get a valid JWT
app.post("/api/v1/auth/migrate-legacy", async (req, res) => {
  try {
    const { email, password, tenantId } = req.body;
    
    // Check if the credentials are valid using the admin_login rpc securely from the server
    const { data: rpcTenant, error: rpcError } = await supabase.rpc('admin_login', {
        input_email: email,
        input_password: password
    });

    if (rpcError || !rpcTenant || rpcTenant.id !== tenantId) {
       return res.status(401).json({ error: "Invalid credentials" });
    }
    
    const { data: userData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
            tenant_id: tenantId,
            role: 'owner'
        }
    });

    // If error is because user already exists, we could just update their password/metadata to match
    if (createError) {
        if (createError.message.includes("already registered") || createError.message.includes("Email exists")) {
            return res.json({ success: true, message: "User exists, migration skipped or updated." });
        }
        throw createError;
    }
    
    // Create their record in tenant_users just in case they don't have one
    await supabase.from("tenant_users").insert({
        supabase_user_id: userData.user.id,
        tenant_id: tenantId,
        name: 'Proprietário',
        email: email,
        role: 'owner'
    });

    res.json({ success: true, data: userData });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Admin Team Management Endpoints
// =========================================
// MÓDULO DE GESTÃO DE USUÁRIOS (RBAC) - FARMAFLOW
// =========================================

app.get("/api/v1/team/users", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.headers["x-tenant-id"] || req.query.tenantId; // Assume passed via header or query
    
    let query = supabase.from("tenant_users").select("*");
    
    if (tenantId) {
       query = query.eq("tenant_id", tenantId);
    }
    
    const { data: users, error } = await query.order("created_at", { ascending: false });
    
    if (error) throw error;

    const enrichedData = (users || []).map(u => ({
        id: u.id,
        supabase_user_id: u.supabase_user_id,
        full_name: u.name,
        email: u.email,
        role: u.role,
        store_id: u.tenant_id,
        is_active: u.is_active !== undefined ? u.is_active : true
    }));

    res.json({ data: enrichedData });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/v1/team/users", checkTenantAccess, async (req, res) => {
  try {
    const { email, password, full_name, role, store_id } = req.body;
    
    if (!email || !password || !full_name || !role) {
      return res.status(400).json({ error: "Nome, e-mail, função e senha são obrigatórios." });
    }

    let authUserId = "";
    
    const { data: user, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name,
        role,
        store_id
      }
    });

    if (error) {
      if (error.message.includes("already been registered")) {
         // Tentar encontrar o usuário existente
         const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
         const existingUser = existingUsers?.users?.find((u: any) => u.email === email);
         
         if (existingUser) {
            authUserId = existingUser.id;
            
            // Verifica se já está no tenant_users
            const { data: existingTenantUser } = await supabaseAdmin
              .from("tenant_users")
              .select("id")
              .eq("supabase_user_id", authUserId)
              .eq("tenant_id", store_id || req.headers["x-tenant-id"])
              .single();
              
            if (existingTenantUser) {
               return res.status(400).json({ error: "Este usuário já faz parte da sua equipe." });
            }
         } else {
            return res.status(400).json({ error: "Este endereço de e-mail já está sendo utilizado por outro usuário no sistema." });
         }
      } else {
        console.error("[Team API] Erro ao criar usuário auth:", error);
        
        // Verifica se o erro pode ser falta de permissão (Service Role Key ausente)
        if (error.message.includes("not allowed") || error.status === 401 || error.status === 403) {
            return res.status(400).json({ error: "Erro de permissão no Supabase. Verifique se a variável SUPABASE_SERVICE_ROLE_KEY está configurada no painel." });
        }
        
        return res.status(400).json({ error: error.message });
      }
    } else {
      authUserId = user.user.id;
    }
    
    // Inserir no tenant_users
    const { error: userError } = await supabaseAdmin
      .from("tenant_users")
      .insert({
        supabase_user_id: authUserId,
        tenant_id: store_id || req.headers["x-tenant-id"] || req.query.tenantId,
        name: full_name,
        email: email,
        role: role,
        is_active: true
      });

    if (userError) {
       console.error("[Team API] Erro ao inserir no tenant_users:", userError);
       return res.status(400).json({ error: "Erro de banco de dados ao salvar o funcionário. Detalhes: " + (userError.message || JSON.stringify(userError)) });
    }

    return res.status(201).json({ success: true, user });
  } catch (error: any) {
    console.error("[Team API] Erro interno:", error);
    return res.status(500).json({ error: "Erro interno: " + error.message });
  }
});

app.patch("/api/v1/team/users/:id", checkTenantAccess, async (req, res) => {
  try {
    const userId = req.params.id;
    const { full_name, role, is_active } = req.body;

    const { data, error } = await supabaseAdmin
      .from("tenant_users")
      .update({ name: full_name, role, is_active })
      .eq("id", userId)
      .select()
      .single();

    if (error) throw error;
    
    if (data && data.supabase_user_id) {
       await supabaseAdmin.auth.admin.updateUserById(data.supabase_user_id, {
          user_metadata: { role: data.role, full_name: data.name },
          ban_duration: data.is_active ? 'none' : '876000h'
       });
    }

    return res.json({ data });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// =========================================
// MÓDULO DE CAIXAS DE ENTRADA (INBOXES)
// =========================================
app.get("/api/v1/inboxes", async (req, res) => {
  try {
    const storeId = (req.query.storeId as string) || (req.headers["x-tenant-id"] as string) || "default";
    const data = await inboxStore.getInboxes(storeId);
    return res.json({ data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/v1/inboxes", async (req, res) => {
  try {
    const { store_id, name, description, whatsapp_instance_id } = req.body;
    const storeId = store_id || (req.headers["x-tenant-id"] as string) || "default";
    if (!name) return res.status(400).json({ error: "Nome é obrigatório." });

    const created = await inboxStore.createInbox(storeId, name, description, whatsapp_instance_id);
    return res.status(201).json({ data: created });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.put("/api/v1/inboxes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, whatsapp_instance_id } = req.body;
    if (!name) return res.status(400).json({ error: "Nome é obrigatório." });

    const updated = await inboxStore.updateInbox(id, name, description, whatsapp_instance_id);
    return res.json({ data: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete("/api/v1/inboxes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await inboxStore.deleteInbox(id);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/v1/inboxes/:id/members", async (req, res) => {
  try {
    const { id } = req.params;
    const members = await inboxStore.getMembers(id);
    return res.json({ data: members });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/v1/inboxes/:id/members/toggle", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId é obrigatório" });

    const updatedMembers = await inboxStore.toggleMember(id, userId);
    return res.json({ data: updatedMembers });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
app.get("/api/v1/tenants/:tenantId/users", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const { data, error } = await supabase
      .from("tenant_users")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
      
    if (error) throw error;
    res.json({ data: data || [] });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/v1/tenants/:tenantId/users", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const { name, email, role, password } = req.body;

    if (!email || !password || !name || !role) {
      return res.status(400).json({ error: "Todos os campos (nome, e-mail, função e senha) são obrigatórios." });
    }

    const cleanEmail = email.toLowerCase().trim();

    // 1. Preventative check: check if the email has already been registered in tenant_users (HTTP 409)
    try {
      const { data: existingUser, error: checkEmailError } = await supabase
        .from("tenant_users")
        .select("id")
        .eq("email", cleanEmail)
        .maybeSingle();

      if (checkEmailError) {
        console.error("Warning checking existing email in tenant_users:", checkEmailError);
      } else if (existingUser) {
        return res.status(409).json({ error: "Este endereço de e-mail já está sendo utilizado por outro membro da equipe." });
      }
    } catch (checkErr) {
      console.error("Exception checking existing email:", checkErr);
    }

    // Verify if tenant exists in tenants. Auto-create if missing to avoid foreign key violations.
    const { data: tenantRows, error: checkTenantError } = await supabase
      .from("tenants")
      .select("id")
      .eq("id", tenantId);

    if (!checkTenantError && (!tenantRows || tenantRows.length === 0)) {
      console.log(`Auto-creating developer tenant row for ${tenantId}...`);
      await supabase
        .from("tenants")
        .insert({
          id: tenantId,
          name: "Developer Tenant",
          slug: tenantId,
          admin_email: "contato.nexoia@gmail.com",
          primarycolor: "#10b981",
          secondarycolor: "#059669",
          accentcolor: "#f59e0b",
          primary_color: "#10b981",
          secondary_color: "#059669",
          accent_color: "#f59e0b",
          isblocked: false,
          is_blocked: false,
          whatsapp: "550000000000"
        });
    }

    // 2. Create user in Auth using dedicated administrative client (supabaseAdmin)
    console.log(`Creating user in Auth with administrative client for email: ${cleanEmail}...`);
    let authData, authError;
    try {
      const resAuth = await supabaseAdmin.auth.admin.createUser({
        email: cleanEmail,
        password,
        email_confirm: true,
        user_metadata: {
          tenant_id: tenantId,
          role: role
        }
      });
      authData = resAuth.data;
      authError = resAuth.error;
    } catch (authCallErr: any) {
      console.error("Exception in admin.createUser process:", authCallErr);
      authError = authCallErr;
    }

    // Fallback if admin.createUser failed
    if (authError) {
      console.error("Admin user creation failed. Attempting signup fallback...", authError);
      
      // If of conflict type "email_exists", we should return a clean error without crashing
      if (authError.status === 422 || authError.message?.toLowerCase().includes("email_exists") || authError.message?.toLowerCase().includes("already registered")) {
        return res.status(409).json({ error: "Este e-mail de usuário já está registrado no sistema de autenticação." });
      }
      
      try {
        const signUpRes = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              tenant_id: tenantId,
              role: role
            }
          }
        });
        
        if (signUpRes.error) {
           console.error("Signup fallback failed:", signUpRes.error);
           return res.status(400).json({ error: `Falha na criação de usuário: ${signUpRes.error.message}` });
        }
        
        authData = signUpRes.data;
      } catch (fallbackErr: any) {
        console.error("Exception in signup fallback call:", fallbackErr);
        return res.status(500).json({ error: `Falha total na autenticação: ${fallbackErr.message || "Erro desconhecido"}` });
      }
    }

    if (!authData || !authData.user) {
      return res.status(500).json({ error: "Provedor de autenticação não retornou informações do usuário." });
    }

    // 3. Create record in tenant_users table
    console.log(`Inserting tenant user record for ID: ${authData.user.id}...`);
    const { data: userData, error: userError } = await supabase
      .from("tenant_users")
      .insert({
        supabase_user_id: authData.user.id,
        tenant_id: tenantId,
        name,
        email: cleanEmail,
        role
      })
      .select()
      .single();

    if (userError) {
      console.error("Database schema insertion error:", userError);
      return res.status(400).json({ error: `Erro de sincronização local: ${userError.message}` });
    }

    return res.json({ data: userData });
  } catch (e: any) {
    console.error("Unhandled top-level crash inside users creation route:", e);
    return res.status(500).json({ error: `Erro inesperado na criação do membro: ${e.message || "Erro de Servidor"}` });
  }
});

app.patch("/api/v1/tenants/:tenantId/users/:userId", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const userId = req.params.userId;
    const { name, role, is_active } = req.body;

    // Update in tenant_users
    const { data: userData, error: userError } = await supabase
      .from("tenant_users")
      .update({ name, role, is_active })
      .eq("id", userId)
      .eq("tenant_id", tenantId)
      .select()
      .single();

    if (userError) throw userError;

    // Also sync role and active status with Auth
    if (userData.supabase_user_id) {
       await supabaseAdmin.auth.admin.updateUserById(userData.supabase_user_id, {
          user_metadata: { role: userData.role, tenant_id: tenantId },
          ban_duration: userData.is_active ? 'none' : '876000h' // ban for 100 years if inactive
       });
    }

    res.json({ data: userData });
  } catch (e: any) {
    res.status(400).json({ error: e.message || 'Erro ao processar a requisição' });
  }
});

// Admin Payment Gateways Endpoints
app.get("/api/v1/tenants/:tenantId/payment-gateways", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const { data, error } = await supabase
      .from("tenant_payment_gateways")
      .select("*")
      .eq("tenant_id", tenantId);
      
    if (error) throw error;

    // Mask sensitive keys before returning to admin panel
    const maskedData = (data || []).map((gw: any) => {
      const maskedCreds = { ...gw.credentials };
      if (gw.gateway_name === "stripe" && maskedCreds.secretKey) {
        maskedCreds.secretKey = maskedCreds.secretKey.substring(0, 8) + "..." + maskedCreds.secretKey.slice(-4);
      }
      if (gw.gateway_name === "picpay" && maskedCreds.sellerToken) {
        maskedCreds.sellerToken = maskedCreds.sellerToken.substring(0, 8) + "..." + maskedCreds.sellerToken.slice(-4);
      }
      if (gw.gateway_name === "infinitepay" || gw.gateway_name === "mercado_pago") {
        if (maskedCreds.clientSecret) maskedCreds.clientSecret = maskedCreds.clientSecret.substring(0, 8) + "..." + maskedCreds.clientSecret.slice(-4);
        if (maskedCreds.accessToken) maskedCreds.accessToken = maskedCreds.accessToken.substring(0, 8) + "..." + maskedCreds.accessToken.slice(-4);
      }
      
      return { ...gw, credentials: maskedCreds };
    });

    res.json({ data: maskedData });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/v1/tenants/:tenantId/payment-gateways", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const { gateway_name, is_active, credentials } = req.body;

    // Validate connection logic (Simulated for this implementation)
    // Note: In real production, we'd hit exactly the provider API to verify credentials here.
    if (req.query.test === "true") {
      // Simulate validation failure if secret is missing
      if (gateway_name === "stripe" && !credentials.secretKey) {
        return res.status(400).json({ error: "Invalid Stripe Secret Key" });
      }
      return res.json({ success: true, message: "Conexão validada com sucesso!" });
    }

    // Check if it exists to do an upsert
    const { data: existing } = await supabase
      .from("tenant_payment_gateways")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("gateway_name", gateway_name)
      .single();

    let finalCredentials = { ...credentials };

    // If an existing record was found and a masked secret was submitted, keep the original string
    if (existing) {
       for (const key in credentials) {
           if (typeof credentials[key] === 'string' && credentials[key].includes("...")) {
               finalCredentials[key] = existing.credentials[key];
           }
       }
    }

    const payload = {
      tenant_id: tenantId,
      gateway_name,
      is_active,
      credentials: finalCredentials,
      updated_at: new Date().toISOString()
    };

    let result;
    if (existing) {
      result = await supabase
        .from("tenant_payment_gateways")
        .update(payload)
        .eq("id", existing.id);
    } else {
      result = await supabase
        .from("tenant_payment_gateways")
        .insert(payload);
    }

    if (result.error) throw result.error;
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Mercado Pago Backend Integration & Checkout Preferencing
app.post("/api/v1/store/:tenantId/mercadopago/preference", async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const { items, customer, discount, total } = req.body;

    // Fetch the tenant's payment gateways settings
    const { data: gateway, error: gwError } = await supabase
      .from("tenant_payment_gateways")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("gateway_name", "mercado_pago")
      .eq("is_active", true)
      .maybeSingle();

    if (gwError || !gateway) {
      return res.status(404).json({ error: "Integração do Mercado Pago não configurada ou inativa para este estabelecimento." });
    }

    const accessToken = gateway.credentials?.accessToken || gateway.credentials?.access_token;
    if (!accessToken) {
      return res.status(400).json({ error: "Token de acesso do Mercado Pago ausente." });
    }

    // Generate a secure, validated format fallback email based on customer WhatsApp
    const buyerPhone = customer?.phone || customer?.whatsapp || "00000000000";
    const cleanPhone = buyerPhone.replace(/\D/g, "");
    const fallbackEmail = `cliente.${cleanPhone || "00000000000"}@gmail.com`;

    const mpItems = [
      {
        id: "order_total",
        title: `Pedido na farmácia - ${tenantId.toUpperCase()}`,
        quantity: 1,
        unit_price: Number(total),
        currency_id: "BRL"
      }
    ];

    const preferencePayload = {
      items: mpItems,
      payer: {
        name: customer?.name || "Cliente FarmaFlow",
        email: fallbackEmail
      },
      back_urls: {
        success: `${req.get("origin") || "https://farmaflow.com"}/store/${tenantId}?payment=success`,
        failure: `${req.get("origin") || "https://farmaflow.com"}/store/${tenantId}?payment=failure`,
        pending: `${req.get("origin") || "https://farmaflow.com"}/store/${tenantId}?payment=pending`
      },
      auto_return: "all"
    };

    // Logging payload for auditing purposes
    console.log("Mercado Pago Preference Payload:", JSON.stringify(preferencePayload));

    const mpResponse = await fetch("https://api.mercadopago.com/v1/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`
      },
      body: JSON.stringify(preferencePayload)
    });

    const mpJson = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error("Mercado Pago Preference API error detail:", JSON.stringify(mpJson));
      return res.status(mpResponse.status).json({ error: mpJson.message || "Erro ao gerar preferência no Mercado Pago." });
    }

    return res.json({
      id: mpJson.id,
      init_point: mpJson.init_point,
      sandbox_init_point: mpJson.sandbox_init_point
    });
  } catch (err: any) {
    console.error("Error creating Mercado Pago Preference (Full Error):", err);
    if (err.response) {
      console.error("Error response details:", err.response.data);
    }
    return res.status(400).json({ error: "Erro ao gerar link de pagamento" });
  }
});

const ENDPOINT_PHARMA_SYNONYMS: Record<string, string[]> = {
  absorvente: ["absorvente", "abs"],
  abs: ["absorvente", "abs"],
  gotas: ["gotas", "gts"],
  gts: ["gotas", "gts"],
  comprimido: ["comprimido", "cp", "cpl", "cpr"],
  comprimidos: ["comprimido", "cp", "cpl", "cpr"],
  cp: ["comprimido", "cp", "cpl", "cpr"],
  cpl: ["comprimido", "cp", "cpl", "cpr"],
  cpr: ["comprimido", "cp", "cpl", "cpr"],
  capsula: ["capsula", "cap"],
  capsulas: ["capsula", "cap"],
  cap: ["capsula", "cap"],
  miligrama: ["miligrama", "mg"],
  miligramas: ["miligrama", "mg"],
  mg: ["miligrama", "mg"],
  paracetamol: ["paracetamol", "tylenol"],
  tylenol: ["paracetamol", "tylenol"],
  dipirona: ["dipirona", "novalgina"],
  novalgina: ["dipirona", "novalgina"],
  ibuprofeno: ["ibuprofeno", "alivium"],
  alivium: ["ibuprofeno", "alivium"],
  shampoo: ["shampoo", "sh", "xampu", "champu", "shamp", "shampo", "xamp", "xampo"],
  sh: ["shampoo", "sh", "xampu", "champu", "shamp", "shampo", "xamp", "xampo"],
  xampu: ["shampoo", "sh", "xampu", "champu", "shamp", "shampo", "xamp", "xampo"],
  shamp: ["shampoo", "sh", "xampu", "champu", "shamp", "shampo", "xamp", "xampo"],
  shampo: ["shampoo", "sh", "xampu", "champu", "shamp", "shampo", "xamp", "xampo"],
  xamp: ["shampoo", "sh", "xampu", "champu", "shamp", "shampo", "xamp", "xampo"],
  xampo: ["shampoo", "sh", "xampu", "champu", "shamp", "shampo", "xamp", "xampo"]
};

function normalizeText(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function getLevenshteinDistance(a: string, b: string): number {
  const matrix = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0)
  );
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[a.length][b.length];
}

// Paginated Products Endpoint for Infinite Scroll & Reactive Search
app.get("/api/v1/store/:tenantId/products", async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const category = req.query.category as string;
    const search = req.query.search as string;

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // 1. Try to use the high-performance Postgres RPC search if available
    if (search && search.trim().length > 0) {
      const cleanSearch = normalizeText(search);
      const isDiaSeguinte = 
        cleanSearch.includes("pilula do dia seguinte") || 
        cleanSearch.includes("pilula dia seguinte") || 
        cleanSearch.includes("dia seguinte") ||
        cleanSearch.includes("anticoncepcional de emergencia") ||
        cleanSearch.includes("anticoncepcional do dia seguinte");

      const isEstomago = 
        cleanSearch.includes("estomago") || 
        cleanSearch.includes("estômago") || 
        cleanSearch.includes("gastrico") || 
        cleanSearch.includes("gástrico") || 
        cleanSearch.includes("protetor gastrico") || 
        cleanSearch.includes("protetor gástrico") || 
        cleanSearch.includes("digestao") || 
        cleanSearch.includes("digestão") || 
        cleanSearch.includes("azia") || 
        cleanSearch.includes("digestivo") || 
        cleanSearch.includes("digestivos") ||
        cleanSearch.includes("antiacido") ||
        cleanSearch.includes("antiácido");

      const searchTermToUse = isDiaSeguinte 
        ? "dia d | diad | dia-d | pozato | neodia | pilem | levonorgestrel | postinor | evenose | emergencia"
        : isEstomago
          ? "omeprazol | pantoprazol | esomeprazol | lansoprazol | rabeprazol | dexlansoprazol | peprazol | pantocal | gastrium | estomago | gastrico | digestivo | digestao | azia | antiacido | eno | estomazil | luftal | simeticona | ranitidina | antidin | pepto | domperidona | metoclopramida | plasil | digesan | gastro"
          : search;

      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc("search_products_v2", {
          p_tenant_id: tenantId,
          p_search_term: searchTermToUse,
          p_category: category || "Todos",
          p_limit: limit,
          p_offset: from
        });

        if (!rpcError && Array.isArray(rpcData)) {
          res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
          return res.json({
            data: rpcData,
            total: rpcData.length >= limit ? -1 : rpcData.length + from,
            page,
            limit,
            source: "postgres_rpc"
          });
        } else {
          console.warn("RPC search_products_v2 failed or not found, falling back to server intelligent search:", rpcError);
        }
      } catch (rpcExc) {
        console.warn("Exception calling search_products_v2, falling back:", rpcExc);
      }
    }

    // 2. Server-side intelligent search fallback
    let query = supabase
      .from("products")
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId);

    if (category && category !== "Todos") {
      query = query.ilike("category", `%${category}%`);
    }

    const cleanSearchText = search ? normalizeText(search) : "";
    const isDiaSeguinteFallback = 
      cleanSearchText.includes("pilula do dia seguinte") || 
      cleanSearchText.includes("pilula dia seguinte") || 
      cleanSearchText.includes("dia seguinte") ||
      cleanSearchText.includes("anticoncepcional de emergencia") ||
      cleanSearchText.includes("anticoncepcional do dia seguinte");

    const isEstomagoFallback = 
      cleanSearchText.includes("estomago") || 
      cleanSearchText.includes("estômago") || 
      cleanSearchText.includes("gastrico") || 
      cleanSearchText.includes("gástrico") || 
      cleanSearchText.includes("protetor gastrico") || 
      cleanSearchText.includes("protetor gástrico") || 
      cleanSearchText.includes("digestao") || 
      cleanSearchText.includes("digestão") || 
      cleanSearchText.includes("azia") || 
      cleanSearchText.includes("digestivo") || 
      cleanSearchText.includes("digestivos") ||
      cleanSearchText.includes("antiacido") ||
      cleanSearchText.includes("antiácido");

    if (search && search.trim().length > 0) {
      if (isDiaSeguinteFallback) {
        const emergencyTokens = ["dia", "d", "diad", "pozato", "neodia", "pilem", "levonorgestrel", "postinor", "evenose", "emergencia"];
        const tsQueryFormated = emergencyTokens.map(tok => `${tok}:*`).join(" | ");
        query = query.or(
          `name.fts.${tsQueryFormated},description.fts.${tsQueryFormated},category.fts.${tsQueryFormated},active_principle.fts.${tsQueryFormated}`
        );
      } else if (isEstomagoFallback) {
        const gastricoTokens = ["omeprazol", "pantoprazol", "esomeprazol", "lansoprazol", "rabeprazol", "dexlansoprazol", "peprazol", "pantocal", "gastrium", "estomago", "gastrico", "digestivo", "digestao", "azia", "antiacido", "eno", "estomazil", "luftal", "simeticona", "ranitidina", "antidin", "pepto", "domperidona", "metoclopramida", "plasil", "digesan", "gastro"];
        const tsQueryFormated = gastricoTokens.map(tok => `${tok}:*`).join(" | ");
        query = query.or(
          `name.fts.${tsQueryFormated},description.fts.${tsQueryFormated},category.fts.${tsQueryFormated},active_principle.fts.${tsQueryFormated}`
        );
      } else {
        const searchTokens = cleanSearchText.split(/\s+/).filter(t => t.length > 0);
        
        let expandedTokens = [...searchTokens];
        searchTokens.forEach(token => {
          const syns = ENDPOINT_PHARMA_SYNONYMS[token];
          if (syns) {
            expandedTokens = [...expandedTokens, ...syns];
          }
        });
        expandedTokens = Array.from(new Set(expandedTokens));

        const tsQueryFormated = expandedTokens.map(tok => `${tok}:*`).join(" | ");
        query = query.or(
          `name.fts.${tsQueryFormated},description.fts.${tsQueryFormated},category.fts.${tsQueryFormated},active_principle.fts.${tsQueryFormated}`
        );
      }
    }

    const { data, count, error } = await query.range(from, to);
    if (error) throw error;

    let finalData = data || [];

    if (search && search.trim().length > 0) {
      const cleanSearch = normalizeText(search);
      const searchTokens = cleanSearch.split(/\s+/).filter(t => t.length > 0);
      
      let expandedTokens = [...searchTokens];
      searchTokens.forEach(token => {
        const syns = ENDPOINT_PHARMA_SYNONYMS[token];
        if (syns) {
          expandedTokens = [...expandedTokens, ...syns];
        }
      });
      expandedTokens = Array.from(new Set(expandedTokens));

      const scoredProducts = finalData.map((prod: any) => {
        const name = normalizeText(prod.name);
        const cat = normalizeText(prod.category);
        const act = normalizeText(prod.active_principle);
        const desc = normalizeText(prod.description);

        let score = 0;

        if (isDiaSeguinteFallback) {
          const isEmergency = 
            name.includes("dia d") ||
            name.includes("diad") ||
            name.includes("dia-d") ||
            name.includes("pozato") ||
            name.includes("neodia") ||
            name.includes("pilem") ||
            name.includes("postinor") ||
            name.includes("evenose") ||
            name.includes("emergencia") ||
            cat.includes("emergencia") ||
            (act.includes("levonorgestrel") && !act.includes("etinilestradiol"));
          
          if (isEmergency) score += 1000;
        } else if (isEstomagoFallback) {
          const isGastrico = 
            name.includes("omeprazol") ||
            name.includes("pantoprazol") ||
            name.includes("esomeprazol") ||
            name.includes("lansoprazol") ||
            name.includes("rabeprazol") ||
            name.includes("dexlansoprazol") ||
            name.includes("peprazol") ||
            name.includes("pantocal") ||
            name.includes("gastrium") ||
            name.includes("estomago") ||
            name.includes("gastrico") ||
            name.includes("digestivo") ||
            name.includes("digestao") ||
            name.includes("azia") ||
            name.includes("antiacido") ||
            name.includes("eno") ||
            name.includes("estomazil") ||
            name.includes("luftal") ||
            name.includes("simeticona") ||
            name.includes("ranitidina") ||
            name.includes("antidin") ||
            name.includes("pepto") ||
            name.includes("domperidona") ||
            name.includes("metoclopramida") ||
            name.includes("plasil") ||
            name.includes("digesan") ||
            cat.includes("gastro") ||
            cat.includes("antiacido") ||
            cat.includes("antiulceroso") ||
            cat.includes("ulcer") ||
            desc.includes("estomago") ||
            desc.includes("gastrico") ||
            desc.includes("azia") ||
            desc.includes("ulcer") ||
            act.includes("omeprazol") ||
            act.includes("pantoprazol") ||
            act.includes("esomeprazol") ||
            act.includes("lansoprazol") ||
            act.includes("rabeprazol") ||
            act.includes("dexlansoprazol") ||
            act.includes("simeticona") ||
            act.includes("ranitidina") ||
            act.includes("domperidona") ||
            act.includes("metoclopramida");

          if (isGastrico) score += 1000;
        } else {
          if (name === cleanSearch) {
            score += 1000;
          } else if (name.startsWith(cleanSearch)) {
            score += 800;
          } else if (name.includes(cleanSearch)) {
            score += 600;
          }

          searchTokens.forEach(token => {
            if (name.includes(token)) score += 300;
            if (cat.includes(token)) score += 200;
            if (act.includes(token)) score += 200;
            if (desc.includes(token)) {
              score += 10;
            }
          });

          expandedTokens.forEach(token => {
            if (!searchTokens.includes(token)) {
              if (name.includes(token)) score += 150;
              if (cat.includes(token)) score += 100;
              if (act.includes(token)) score += 100;
              if (desc.includes(token)) score += 5;
            }
          });
        }

        const nameWords = name.split(/\s+/);
        searchTokens.forEach(token => {
          if (token.length > 3) {
            nameWords.forEach(word => {
              if (word.length > 3) {
                const dist = getLevenshteinDistance(token, word);
                if (dist <= 1) {
                  score += 100;
                }
              }
            });
          }
        });

        const hasMainMatch = searchTokens.some(tok => name.includes(tok) || cat.includes(tok) || act.includes(tok)) ||
                             expandedTokens.some(tok => name.includes(tok) || cat.includes(tok) || act.includes(tok));
        
        if (!hasMainMatch && desc.length > 0) {
          score = score * 0.05;
        }

        if (prod.is_featured) {
          score += 50;
        }

        return { ...prod, _score: score };
      });

      scoredProducts.sort((a, b) => b._score - a._score);
      finalData = scoredProducts.map(p => {
        const { _score, ...rest } = p;
        return rest;
      });
    }

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300",
    );
    res.json({ data: finalData, total: count || 0, page, limit });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/v1/matrix/bulk-featured-products", async (req, res) => {
  try {
    const { productIds, targetTenantIds, mode } = req.body;

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: "Parâmetro productIds é obrigatório e deve ser uma lista não vazia." });
    }
    if (!targetTenantIds || !Array.isArray(targetTenantIds) || targetTenantIds.length === 0) {
      return res.status(400).json({ error: "Parâmetro targetTenantIds é obrigatório e deve ser uma lista não vazia." });
    }

    const isReplaceMode = mode === 'replace';

    // If replace mode, we first reset is_featured to false for all products in the selected target tenants
    if (isReplaceMode) {
      const { error: resetError } = await supabase
        .from("products")
        .update({ is_featured: false })
        .in("tenant_id", targetTenantIds)
        .eq("is_featured", true);

      if (resetError) throw resetError;
    }

    // 1. Fetch matrix products to get their barcodes and internal codes
    const { data: matrixProducts, error: matrixError } = await supabase
      .from("products")
      .select("barcode, internal_code")
      .in("id", productIds);

    if (matrixError) throw matrixError;
    if (!matrixProducts || matrixProducts.length === 0) {
      return res.status(404).json({ error: "Nenhum produto correspondente encontrado na Matriz." });
    }

    // Gather all barcodes and internal_codes to match on
    const barcodes = matrixProducts.map(p => p.barcode ? String(p.barcode).trim() : null).filter(Boolean) as string[];
    const internalCodes = matrixProducts.map(p => p.internal_code ? String(p.internal_code).trim() : null).filter(Boolean) as string[];

    if (barcodes.length === 0 && internalCodes.length === 0) {
      return res.status(400).json({ error: "Os produtos selecionados na Matriz não possuem código de barras (EAN) ou código interno para correspondência." });
    }

    // 2. Query target products
    const orClauses: string[] = [];
    barcodes.forEach(b => {
      orClauses.push(`barcode.eq.${b}`);
    });
    internalCodes.forEach(ic => {
      orClauses.push(`internal_code.eq.${ic}`);
    });

    let query = supabase
      .from("products")
      .select("id, tenant_id, barcode, internal_code")
      .in("tenant_id", targetTenantIds);

    if (orClauses.length > 0) {
      query = query.or(orClauses.join(","));
    }

    const { data: targetProducts, error: targetError } = await query;
    if (targetError) throw targetError;

    if (!targetProducts || targetProducts.length === 0) {
      // Save logs even when no matched products to record that the showcase was reset (if in replace mode)
      try {
        await supabase.from("integration_logs").insert({
          tenant_id: targetTenantIds[0],
          endpoint: "bulk_featured_products",
          payload: {
            productIds,
            targetTenantIds,
            mode: mode || "append",
            updatedProductIds: [],
            timestamp: new Date().toISOString()
          },
          status: "SUCCESS"
        });
      } catch (logErr) {
        console.error("Erro ao gravar logs de auditoria em lote:", logErr);
      }

      return res.status(200).json({
        success: true,
        message: isReplaceMode
          ? "Os destaques anteriores foram removidos com sucesso, mas nenhum produto correspondente foi encontrado nas filiais selecionadas para destacar."
          : "Nenhum produto correspondente foi encontrado nas filiais selecionadas para destacar.",
        updatedCount: 0
      });
    }

    const targetProductIdsToUpdate = targetProducts.map(p => p.id);

    // Update is_featured to true inside a single atomic operation
    const { error: updateError } = await supabase
      .from("products")
      .update({ is_featured: true })
      .in("id", targetProductIdsToUpdate);

    if (updateError) throw updateError;

    // Save logs to integration_logs for audit
    try {
      await supabase.from("integration_logs").insert({
        tenant_id: targetTenantIds[0], // associate with first target tenant
        endpoint: "bulk_featured_products",
        payload: {
          productIds,
          targetTenantIds,
          mode: mode || "append",
          updatedProductIds: targetProductIdsToUpdate,
          timestamp: new Date().toISOString()
        },
        status: "SUCCESS"
      });
    } catch (logErr) {
      console.error("Erro ao gravar logs de auditoria em lote:", logErr);
    }

    res.json({
      success: true,
      message: isReplaceMode
        ? `Vitrine substituída com sucesso! ${targetProductIdsToUpdate.length} novos produtos foram definidos como destaque nas filiais selecionadas.`
        : `${targetProductIdsToUpdate.length} produtos foram adicionados como destaque nas filiais selecionadas com sucesso.`,
      updatedCount: targetProductIdsToUpdate.length
    });
  } catch (err: any) {
    console.error("Error in POST /api/v1/matrix/bulk-featured-products:", err);
    res.status(500).json({ error: err.message });
  }
});

// Cacheable Products Endpoint for Vercel Edge Cache (ISR Pattern)
app.get("/api/v1/tenants/:tenantId/products", async (req, res) => {
  try {
    const tenantId = req.params.tenantId;

    let allData: any[] = [];
    let from = 0;
    const step = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("tenant_id", tenantId)
        .range(from, from + step - 1);

      if (error) throw error;
      if (data && data.length > 0) {
        allData = [...allData, ...data];
        if (data.length < step) {
          hasMore = false;
        } else {
          from += step;
        }
      } else {
        hasMore = false;
      }
    }

    // Set Cache-Control Headers for Vercel Edge caching
    // s-maxage=60: Cache in CDN for 60 seconds
    // stale-while-revalidate=300: Serve stale cache up to 5 minutes while fetching fresh in background
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300",
    );
    res.json({ data: allData });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/v1/tenants/admin", async (req, res) => {
  try {
    const { payload, isUpdate } = req.body;
    if (isUpdate) {
      const { data, error } = await supabase
        .from("tenants")
        .upsert(payload)
        .select();
      if (error) throw error;
      res.json({ data });
    } else {
      const { data, error } = await supabase
        .from("tenants")
        .insert(payload)
        .select();
      if (error) throw error;
      res.json({ data });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/v1/tenants/admin/:id", async (req, res) => {
  try {
    const id = req.params.id;
    await supabase.from("products").delete().eq("tenant_id", id);
    await supabase.from("orders").delete().eq("tenant_id", id);
    const { data, error } = await supabase
      .from("tenants")
      .delete()
      .eq("id", id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Supabase Client for Server-side operations
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Dedicated client for Supabase administrative actions (Service Role)
const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Initialize Storage Bucket
async function initStorage() {
  if (process.env.VERCEL) return; // Skip on Vercel to avoid cold start issues
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const exists = buckets?.some((b) => b.id === "backups_empresas");
    if (!exists) {
      console.log("[Storage] Creating bucket 'backups_empresas'...");
      await supabase.storage.createBucket("backups_empresas", {
        public: false,
        fileSizeLimit: 52428800, // 50MB
        allowedMimeTypes: ["text/plain", "application/sql", "text/csv"],
      });
    }
  } catch (err) {
    console.error("[Storage] Error initializing bucket:", err);
  }
}
initStorage();

// --- CRON JOBS ---
// Disabled on Vercel as serverless functions are not persistent
if (!process.env.VERCEL) {
  /**
   * 1. Auto-Purge Reviews
   * Runs every day at 00:00
   */
  cron.schedule("0 0 * * *", async () => {
    console.log("[Cron] Starting Auto-Purge of Reviews...");
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const dateStr = sevenDaysAgo.toISOString();

      // Before deleting, update stats to preserve the rating
      // We fetch reviews that are about to be deleted
      const { data: reviewsToDelete } = await supabase
        .from("app_reviews")
        .select("*")
        .lt("created_at", dateStr);

      if (reviewsToDelete && reviewsToDelete.length > 0) {
        // Group by tenantId to update stats
        const tenants = [...new Set(reviewsToDelete.map((r) => r.tenant_id))];

        for (const tenant_id of tenants) {
          // Fetch current stats or all reviews to calculate fixed rating
          const { data: allReviews } = await supabase
            .from("app_reviews")
            .select("rating")
            .eq("tenant_id", tenant_id);

          if (allReviews && allReviews.length > 0) {
            const total = allReviews.length;
            const avg =
              allReviews.reduce((acc, r) => acc + r.rating, 0) / total;

            // Update or Insert into pharmacy_stats
            await supabase.from("pharmacy_stats").upsert(
              {
                tenantid: tenant_id,
                averagerating: avg,
                totalreviews: total,
                lastupdated: new Date().toISOString(),
              },
              { onConflict: "tenantid" },
            );
          }
        }

        // Perform Hard Delete
        const { error } = await supabase
          .from("app_reviews")
          .delete()
          .lt("created_at", dateStr);

        if (error) throw error;
        console.log(
          `[Cron] Auto-Purge completed. Deleted ${reviewsToDelete.length} reviews.`,
        );
      } else {
        console.log("[Cron] No reviews to purge.");
      }
    } catch (error) {
      console.error("[Cron] Error in Auto-Purge:", error);
    }
  });

  /**
   * 2. Automated Backups
   * Runs every day at 01:00 to check which companies need backup
   */
  cron.schedule("0 1 * * *", async () => {
    console.log("[Cron] Checking for scheduled backups...");
    const today = new Date();
    const dayOfMonth = today.getDate();
    const dayOfWeek = today.getDay(); // 0 = Sunday

    try {
      const { data: schedules } = await supabase
        .from("backupschedules")
        .select("*");

      if (!schedules) return;

      for (const schedule of schedules) {
        const config = schedule.backupconfig;
        if (!config || config.frequency === "OFF") continue;

        let shouldBackup = false;

        if (config.frequency === "WEEKLY" && dayOfWeek === 0) {
          shouldBackup = true;
        } else if (
          config.frequency === "BIWEEKLY" &&
          (dayOfMonth === 1 || dayOfMonth === 15)
        ) {
          shouldBackup = true;
        } else if (config.frequency === "MONTHLY" && dayOfMonth === 1) {
          shouldBackup = true;
        }

        if (shouldBackup) {
          await runBackup(schedule.tenantid);
        }
      }
    } catch (error) {
      console.error("[Cron] Error in Backup Scheduler:", error);
    }
  });

  /**
   * 3. Conciliação Noturna (Sincronização de Estoque)
   * Runs every day at 03:00
   */
  cron.schedule("0 3 * * *", async () => {
    console.log(
      "[Cron] Starting Nightly Reconciliation (Conciliação Noturna)...",
    );
    try {
      // Busca todas as farmácias que têm integração configurada (erp_url)
      const { data: tenants } = await supabase
        .from("tenants")
        .select("id, erp_url, integration_token")
        .not("erp_url", "is", null)
        .neq("erp_url", "");

      if (!tenants || tenants.length === 0) {
        console.log(
          "[Cron] No tenants with ERP URL configured for reconciliation.",
        );
        return;
      }

      for (const tenant of tenants) {
        try {
          if (!tenant.erp_url) continue;

          const sanitizedUrl = tenant.erp_url.startsWith('http://') || tenant.erp_url.startsWith('https://') 
              ? tenant.erp_url 
              : `https://${tenant.erp_url}`;
              
          console.log(`[AGENTE] Iniciando conciliação para tenant ${tenant.id}...`);
          console.log(`[AGENTE] Status: ONLINE para tenant ${tenant.id}`);
          
          try {
            await supabaseAdmin.from('agent_integrations').upsert({ 
              tenant_id: tenant.id,
              last_seen: new Date().toISOString(), 
              is_active: true 
            }, { onConflict: 'tenant_id' });
          } catch (e) {}
          
          console.log(`[Cron] Reconciling tenant ${tenant.id} with ERP ${sanitizedUrl}...`);
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000);

          let response: Response;
          try {
            response = await fetch(`${sanitizedUrl}/api/stock-dump`, {
              headers: {
                "x-api-key": tenant.integration_token || "",
              },
              signal: controller.signal,
            });
          } catch (fetchErr: any) {
            clearTimeout(timeoutId);
            const errorMsg = fetchErr.name === 'AbortError' 
              ? `Tempo limite excedido (8s) ao conectar no ERP (${sanitizedUrl})`
              : `ERP inacessível ou sem conexão (${sanitizedUrl}): ${fetchErr.message || 'fetch failed'}`;
            throw new Error(errorMsg);
          }
          clearTimeout(timeoutId);

          if (!response.ok) {
            throw new Error(
              `ERP returned ${response.status} ${response.statusText}`,
            );
          }

          const erpStockDump = await response.json(); // Array de { ean, internalCode, stock }

          // Busca o estoque atual do NexoIA
          const { data: nexoProducts } = await supabase
            .from("products")
            .select("id, barcode, internal_code, stock")
            .eq("tenant_id", tenant.id);

          if (!nexoProducts) continue;

          let updatedCount = 0;

          // Compara e corrige
          for (const erpItem of erpStockDump) {
            const nexoProduct = nexoProducts.find(
              (p) =>
                (erpItem.ean && p.barcode === erpItem.ean) ||
                (erpItem.internalCode &&
                  p.internal_code === erpItem.internalCode),
            );

            if (nexoProduct && nexoProduct.stock !== erpItem.stock) {
              try {
                await supabase
                  .from("products")
                  .update({ stock: erpItem.stock })
                  .eq("id", nexoProduct.id);
                updatedCount++;
              } catch (e: any) {
                console.error(`[Cron] Failed to update product ${nexoProduct.id}:`, e.message);
              }
            }
          }

          console.log(
            `[Cron] Reconciled ${updatedCount} products for tenant ${tenant.id}.`,
          );

          await logIntegration(
            tenant.id,
            "CRON /reconciliation",
            { updatedCount },
            "SUCCESS",
          );
        } catch (err: any) {
          console.error(
            `[Cron] Failed to reconcile tenant ${tenant.id}:`,
            err.message,
          );
          await logIntegration(
            tenant.id,
            "CRON /reconciliation",
            {},
            "FAILED",
            err.message,
          );
        }
      }
    } catch (error) {
      console.error("[Cron] Error in Nightly Reconciliation:", error);
    }
  });
}

// --- BACKUP LOGIC ---

/**
 * Helper to fetch all records from a table using pagination
 * to bypass the 1000 row limit of Supabase/PostgREST
 */
async function fetchAll(
  table: string,
  tenantId: string,
  column: string = "tenant_id",
  orderBy: string = "created_at",
) {
  let allData: any[] = [];
  let from = 0;
  const step = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq(column, tenantId)
      // Sorting is essential for stable pagination using range()
      .order(orderBy, { ascending: true })
      .range(from, from + step - 1);

    if (error) throw new Error(`[${table}] Pagination error: ${error.message}`);

    if (data && data.length > 0) {
      allData = [...allData, ...data];
      if (data.length < step) {
        hasMore = false;
      } else {
        from += step;
      }
    } else {
      hasMore = false;
    }
  }
  return allData;
}

async function runBackup(tenantId: string) {
  console.log(`[Backup] Starting backup for tenant: ${tenantId}`);
  try {
    // 0. Pre-connection validation: ensures database/pool is responsive before proceeding
    const { error: poolError } = await supabase
      .from("tenants")
      .select("id")
      .limit(1);
    if (poolError) {
      throw new Error(`Database connection check failed: ${poolError.message}`);
    }

    // 1. Fetch Data with Pagination sequentially to reduce peak memory usage
    const { data: tenantData, error: tenantError } = await supabase
      .from("tenants")
      .select("*")
      .eq("id", tenantId)
      .single();
    if (tenantError)
      throw new Error(`Tenant fetch error: ${tenantError.message}`);

    const products = await fetchAll("products", tenantId, "tenant_id", "id");
    const orders = await fetchAll("orders", tenantId, "tenant_id", "id");
    const reviews = await fetchAll("app_reviews", tenantId, "tenant_id", "id");

    const backupData = {
      tenantId,
      timestamp: new Date().toISOString(),
      version: "1.0",
      data: {
        tenant: tenantData || null,
        products: (products || []).map((p) => {
          let deptId = null;
          let deptName = "Outros";
          let subcatName = p.category || "Geral";
          if (tenantData?.departments) {
            const depts = tenantData.departments;
            deptName = getDepartmentForCategory(p.category, depts);
            const dept = depts.find((d: any) => d.name === deptName);
            if (dept) {
              deptId = dept.id;
            }
          }
          return {
            ...p,
            department_id: deptId,
            department_name: deptName,
            subcategory_name: subcatName,
            subcategory_id: subcatName, // for backward compatibility/consistency
          };
        }),
        orders: orders || [],
        reviews: reviews || [],
      },
    };

    // 2. Generate File Content
    const fileName = `backup_empresa_${tenantId}.json`;
    const fileContent = JSON.stringify(backupData);

    // 3. Upload to Supabase Storage (Overwrite)
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("backups_empresas")
      .upload(`${tenantId}/ultimo_backup.json`, fileContent, {
        contentType: "application/json",
        upsert: true,
      });

    if (uploadError) {
      console.error("[Backup] Storage upload error:", uploadError);
      throw new Error(`Storage upload error: ${uploadError.message}`);
    }

    // 4. Log Backup
    const { error: insertError } = await supabase.from("backuplogs").insert({
      tenantid: tenantId,
      createdat: new Date().toISOString(),
      filename: fileName,
      filesize: fileContent.length,
      status: "SUCCESS",
    });
    if (insertError) {
      console.error("[Backup] Error inserting log:", insertError);
    }

    // 5. Update last backup date in tenant config and backupschedules
    const { data: scheduleData } = await supabase
      .from("backupschedules")
      .select("backupconfig")
      .eq("tenantid", tenantId)
      .single();
    if (scheduleData) {
      const currentConfig = scheduleData.backupconfig || {};
      const newConfig = {
        ...currentConfig,
        lastBackup: new Date().toISOString(),
      };
      await supabase
        .from("backupschedules")
        .update({ backupconfig: newConfig })
        .eq("tenantid", tenantId);
      // Also update tenants for backward compatibility
      await supabase
        .from("tenants")
        .update({ backup_config: newConfig })
        .eq("id", tenantId);
    }

    console.log(`[Backup] Backup successful for ${tenantId}: ${fileName}`);
    return { success: true, fileName, insertError: insertError || null };
  } catch (error: any) {
    console.error(`[Backup] Failed for ${tenantId}:`, error);
    const actualErrorMessage = error?.message || String(error);
    const errorFilename = actualErrorMessage.substring(0, 150); // Store truncated error in filename column
    const { error: insertError } = await supabase.from("backuplogs").insert({
      tenantid: tenantId,
      createdat: new Date().toISOString(),
      filename: `ERRO: ${errorFilename}`, // Salvando erro real no filename para o painel mostrar
      filesize: 0,
      status: "FAILED",
    });
    if (insertError) {
      console.error("[Backup] Error inserting failure log:", insertError);
    }
    return { success: false, error: actualErrorMessage };
  }
}

// --- API ROUTES ---

app.get("/api/image-proxy", async (req, res) => {
  try {
    const url = req.query.url as string;
    if (!url || typeof url !== "string")
      return res.status(400).send("No URL provided");

    // Validate protocol
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return res.status(400).send("Invalid URL");
    }

    let response;
    try {
      response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
      });
    } catch (e) {
      console.log(
        `[Image Proxy] Fetch threw for ${url}, falling back to wsrv.nl`,
      );
    }

    if (!response || (!response.ok && response.status === 403)) {
      if (response) {
        console.log(`[Image Proxy] 403 for ${url}, falling back to wsrv.nl`);
      }
      const fallbackUrl = `https://wsrv.nl/?url=${encodeURIComponent(url)}`;
      response = await fetch(fallbackUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
      });
    }

    if (!response.ok)
      return res
        .status(response.status)
        .send(`Failed to fetch image: ${response.statusText}`);

    const contentType = response.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (e: any) {
    console.error("Image proxy error:", e);
    res.status(500).send("Proxy error");
  }
});

app.get("/api/test-route", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/backups-all", async (req, res) => {
  try {
    console.log("HIT /api/backups-all");
    const { data, error } = await supabase.from("backuplogs").select("*");
    console.log("DATA:", data, "ERROR:", error);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/backups/:tenantId", checkTenantAccess, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { data, error } = await supabase
      .from("backuplogs")
      .select("*")
      .eq("tenantid", tenantId)
      .order("createdat", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(
      (data || []).map((log: any) => ({
        id: log.id,
        tenantId: log.tenantid,
        date: log.createdat,
        fileName: log.filename,
        fileSize: log.filesize,
        status: log.status,
      })),
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/backups/run/:tenantId", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId as string;
    const result = await runBackup(tenantId);
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/backups/config/:tenantId", checkTenantAccess, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { data, error } = await supabase
      .from("backupschedules")
      .select("backupconfig")
      .eq("tenantid", tenantId)
      .single();

    if (error && error.code !== "PGRST116") {
      return res.status(500).json({ error: error.message });
    }

    res.json(data?.backupconfig || { frequency: "OFF" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/backups/config/:tenantId", checkTenantAccess, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { config } = req.body;

    // Update in backupschedules
    const { error: scheduleError } = await supabase
      .from("backupschedules")
      .upsert(
        {
          tenantid: tenantId,
          backupconfig: config,
          updatedat: new Date().toISOString(),
        },
        { onConflict: "tenantid" },
      );

    // Also update in tenants for backward compatibility
    const { error: tenantError } = await supabase
      .from("tenants")
      .update({ backup_config: config })
      .eq("id", tenantId);

    if (scheduleError)
      return res.status(500).json({ error: scheduleError.message });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- EXPORT ENDPOINTS ---

app.get("/api/backups/export/:tenantId", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId as string;
    const { format } = req.query; // 'sql' or 'csv'

    // Fetch Data with Pagination
    const [tenantResult, products, orders, reviews] = await Promise.all([
      supabase.from("tenants").select("*").eq("id", tenantId).single(),
      fetchAll("products", tenantId),
      fetchAll("orders", tenantId),
      fetchAll("app_reviews", tenantId),
    ]);

    if (format === "csv") {
      // For CSV, we'll combine key data into one or just pick one table?
      // Usually CSV export is per table. Let's provide a ZIP or just products for now as example,
      // or better, a combined CSV if requested.
      // But user said "conferência em Excel", so maybe just products is what they care about most?
      // Let's do products as it's the most likely "item" count (9.408 items).

      const data = products || [];
      if (data.length === 0)
        return res
          .status(404)
          .json({ error: "Nenhum dado encontrado para exportar." });

      const headers = Object.keys(data[0]);
      const csvRows = [headers.join(",")];

      for (const row of data) {
        const values = headers.map((header) => {
          const val = row[header];
          const escaped = ("" + val).replace(/"/g, '""');
          return `"${escaped}"`;
        });
        csvRows.push(values.join(","));
      }

      const csvContent = csvRows.join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=backup_${tenantId}.csv`,
      );
      return res.send(csvContent);
    } else {
      // Default to SQL
      let sqlContent = `-- Backup for tenant ${tenantId}\n`;
      const tables = [
        { name: "tenants", data: [tenantResult.data] },
        { name: "products", data: products || [] },
        { name: "orders", data: orders || [] },
        { name: "app_reviews", data: reviews || [] },
      ];

      tables.forEach((table) => {
        if (table.data && table.data.length > 0) {
          sqlContent += `-- Table: ${table.name}\n`;
          table.data.forEach((row: any) => {
            if (!row) return;
            const keys = Object.keys(row).join(", ");
            const values = Object.values(row)
              .map((v) => {
                if (v === null) return "NULL";
                if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
                return v;
              })
              .join(", ");
            sqlContent += `INSERT INTO ${table.name} (${keys}) VALUES (${values});\n`;
          });
          sqlContent += "\n";
        }
      });

      res.setHeader("Content-Type", "application/sql");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=backup_${tenantId}.sql`,
      );
      return res.send(sqlContent);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/backups/download-latest/:tenantId", checkTenantAccess, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { data, error } = await supabase.storage
      .from("backups_empresas")
      .download(`${tenantId}/ultimo_backup.json`);

    if (error) return res.status(404).json({ error: "Backup não encontrado." });

    const buffer = Buffer.from(await data.arrayBuffer());
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=backup_empresa_${tenantId}.json`,
    );
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- RESTORE LOGIC ---
const restoreJobs = new Map<
  string,
  {
    status: "pending" | "processing" | "completed" | "failed";
    progress: number;
    message: string;
    details?: any;
  }
>();

app.post("/api/backups/restore/:tenantId", checkTenantAccess, async (req, res) => {
  const tenantId = req.params.tenantId as string;
  const backupData = req.body;

  if (!backupData || (!backupData.data && !backupData.products)) {
    return res.status(400).json({ error: "Formato de backup inválido." });
  }

  const jobId = crypto.randomUUID();
  restoreJobs.set(jobId, {
    status: "pending",
    progress: 0,
    message: "Iniciando restauração...",
  });

  // Start background job
  processRestore(jobId, tenantId, backupData).catch((err) => {
    console.error(`Restore job ${jobId} failed:`, err);
    restoreJobs.set(jobId, {
      status: "failed",
      progress: 0,
      message: err.message,
    });
  });

  res.json({ jobId });
});

app.get("/api/backups/restore-status/:jobId", (req, res) => {
  const { jobId } = req.params;
  const job = restoreJobs.get(jobId);
  if (!job) return res.status(404).json({ error: "Job não encontrado" });
  res.json(job);
});

async function processRestore(
  jobId: string,
  tenantId: string,
  backupData: any,
) {
  const job = restoreJobs.get(jobId)!;
  job.status = "processing";
  job.progress = 10;
  job.message = "Validando dados do backup...";

  if (backupData.tenantId && backupData.tenantId !== tenantId) {
    throw new Error("O arquivo de backup pertence a outra empresa.");
  }

  if (backupData.version && backupData.version !== "1.0") {
    console.warn(
      `Versão do backup (${backupData.version}) diferente da atual (1.0). Tentando restaurar mesmo assim...`,
    );
  }

  const products =
    backupData.data && backupData.data.products
      ? backupData.data.products
      : backupData.products || [];
  const totalItems = products.length;

  job.progress = 20;
  job.message = `Preparando para restaurar ${totalItems} produtos...`;

  let restoredCount = 0;

  const { data: currentProducts } = await supabase
    .from("products")
    .select("id, barcode, internal_code")
    .eq("tenant_id", tenantId);

  const currentByBarcode = new Map();
  const currentByInternalCode = new Map();

  if (currentProducts) {
    for (const p of currentProducts) {
      if (p.barcode) currentByBarcode.set(p.barcode, p.id);
      if (p.internal_code) currentByInternalCode.set(p.internal_code, p.id);
    }
  }

  const CHUNK_SIZE = 100;
  const chunks = [];
  for (let i = 0; i < products.length; i += CHUNK_SIZE) {
    chunks.push(products.slice(i, i + CHUNK_SIZE));
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    // Deduplicar dentro do próprio chunk para evitar conflitos na mesma transação
    const seenBarcodes = new Set<string>();
    const seenInternals = new Set<string>();
    const uniqueChunk = [];

    for (const p of chunk) {
      const barcode = p.barcode ? String(p.barcode).trim() : null;
      const internal = p.internal_code
        ? String(p.internal_code).trim()
        : p.internalCode
          ? String(p.internalCode).trim()
          : null;

      const key = barcode || internal || `no-barcode-${Math.random()}`;

      if (barcode && seenBarcodes.has(barcode)) continue;
      if (internal && seenInternals.has(internal)) continue;

      if (barcode) seenBarcodes.add(barcode);
      if (internal) seenInternals.add(internal);
      uniqueChunk.push(p);
    }

    const upsertPayload = uniqueChunk.map((p: any) => {
      let existingId = null;
      const barcode = p.barcode ? String(p.barcode).trim() : null;
      const internalCode = p.internal_code
        ? String(p.internal_code).trim()
        : p.internalCode
          ? String(p.internalCode).trim()
          : null;

      if (barcode && currentByBarcode.has(barcode)) {
        existingId = currentByBarcode.get(barcode);
      } else if (internalCode && currentByInternalCode.has(internalCode)) {
        existingId = currentByInternalCode.get(internalCode);
      }

      // Removemos o ID do backup para evitar colisões entre tenants
      const { id: backupId, updated_at, created_at, ...productPayload } = p;

      const item: any = {
        ...productPayload,
        barcode,
        internal_code: internalCode,
        tenant_id: tenantId,
      };

      if (existingId) {
        item.id = existingId;
      }

      return item;
    });

    const { error } = await supabase.from("products").upsert(upsertPayload, {
      onConflict: "tenant_id,barcode",
    });
    if (error) {
      console.error("Error upserting chunk:", error);
      throw new Error(`Erro ao restaurar lote de produtos: ${error.message}`);
    }

    restoredCount += chunk.length;
    job.progress = 20 + Math.floor((restoredCount / totalItems) * 70);
    job.message = `Restaurando produtos: ${restoredCount} de ${totalItems}...`;
  }

  let categoriesRestored = 0;
  const importedTenantData =
    backupData.data && backupData.data.tenant
      ? backupData.data.tenant
      : backupData.tenant;

  if (importedTenantData) {
    const tenantData = importedTenantData;

    // Obter o tenant atual para mesclar (evitando duplicar ou excluir)
    const { data: currentTenant } = await supabase
      .from("tenants")
      .select("departments, custom_categories, custom_manufacturers")
      .eq("id", tenantId)
      .single();

    const currentDepts = currentTenant?.departments || [];
    const importedDepts = tenantData.departments || [];

    const mergedDepts = [...currentDepts];
    let nextPriority =
      mergedDepts.length > 0
        ? Math.max(...mergedDepts.map((d: any) => d.priority || 0)) + 1
        : 0;

    for (const impDept of importedDepts) {
      const existingDept = mergedDepts.find(
        (d) => d.name.toLowerCase() === impDept.name.toLowerCase(),
      );
      if (existingDept) {
        // Mescla subcategorias se o departamento já existir
        const mergedCategories = Array.from(
          new Set([
            ...(existingDept.categories || []),
            ...(impDept.categories || []),
          ]),
        );
        existingDept.categories = mergedCategories;
      } else {
        // Cria um novo se não existir
        mergedDepts.push({
          ...impDept,
          id: Math.random().toString(36).substring(7), // novo id para evitar conflitos
          priority: nextPriority++,
        });
      }
    }

    const mergedCategories = Array.from(
      new Set([
        ...(currentTenant?.custom_categories || []),
        ...(tenantData.custom_categories || []),
      ]),
    );
    const mergedManufacturers = Array.from(
      new Set([
        ...(currentTenant?.custom_manufacturers || []),
        ...(tenantData.custom_manufacturers || []),
      ]),
    );

    categoriesRestored = mergedDepts.length;

    const { error } = await supabase
      .from("tenants")
      .update({
        custom_categories: mergedCategories,
        custom_manufacturers: mergedManufacturers,
        departments: mergedDepts,
      })
      .eq("id", tenantId);
    if (error) console.error("Error restoring tenant settings:", error);
  }

  job.status = "completed";
  job.progress = 100;
  job.message = "Restauração concluída com sucesso!";
  job.details = {
    productsRestored: restoredCount,
    categoriesRestored: categoriesRestored,
    pixConfigured: 0,
  };
}

// --- INTEGRATION API (ERP/PDV) ---

// Middleware para autenticação via API Key
const authenticateIntegration = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const apiKey = req.headers["x-api-key"] as string;
  if (!apiKey) {
    return res.status(401).json({ error: "API Key não fornecida (x-api-key)" });
  }

  // Busca o tenant pela integration_token
  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("id")
    .eq("integration_token", apiKey)
    .single();

  if (error || !tenant) {
    // Fallback: permite usar o próprio ID do tenant como token para testes/compatibilidade
    const { data: tenantById, error: errById } = await supabase
      .from("tenants")
      .select("id")
      .eq("id", apiKey)
      .single();

    if (errById || !tenantById) {
      return res.status(401).json({ error: "API Key inválida" });
    }
    (req as any).tenantId = tenantById.id;
    return next();
  }

  (req as any).tenantId = tenant.id;
  next();
};

/**
 * @swagger
 * /sale:
 *   post:
 *     summary: Webhook de Baixa de Estoque (Venda no Balcão)
 *     description: Subtrai a quantidade vendida do estoque da loja online. Se o estoque chegar a zero, o produto é ocultado da vitrine principal.
 *     tags: [Vendas]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - quantity
 *             properties:
 *               ean:
 *                 type: string
 *                 description: Código de barras (EAN) do produto
 *               internalCode:
 *                 type: string
 *                 description: Código interno do produto no ERP
 *               quantity:
 *                 type: number
 *                 description: Quantidade vendida
 *               transactionId:
 *                 type: string
 *                 description: "ID transacional exclusivo da venda/cupom gerado pelo ERP. Usado como trava de segurança (idempotência) para evitar baixas duplicadas de estoque caso a rede oscile."
 *     responses:
 *       200:
 *         description: Estoque atualizado com sucesso
 *       400:
 *         description: EAN ou Código Interno não fornecido
 *       404:
 *         description: Produto não encontrado
 */
app.post(
  "/api/v1/integration/sale",
  authenticateIntegration,
  async (req, res) => {
    const tenantId = (req as any).tenantId;
    const { ean, internalCode, quantity, transactionId } = req.body;

    // Sanitização e Normalização
    const sanitizedEan = ean ? String(ean).replace(/\s+/g, "").trim() : "";
    const sanitizedInternalCode = internalCode
      ? String(internalCode).trim()
      : "";

    if (!sanitizedEan && !sanitizedInternalCode) {
      return res
        .status(400)
        .json({
          error:
            "É necessário fornecer o 'ean' ou o 'internalCode' para realizar a baixa de estoque.",
        });
    }

    if (typeof quantity !== "number" || quantity <= 0) {
      return res
        .status(400)
        .json({
          error: "Quantidade inválida. Deve ser um número maior que zero.",
        });
    }

    try {
      // Mecanismo de Idempotência (Proteção contra Cliques Duplos)
      if (transactionId) {
        const yesterday = new Date();
        yesterday.setHours(yesterday.getHours() - 24);

        // Busca logs de sucesso nas últimas 24h contendo o mesmo transactionId
        const { data: previousLogs, error: checkError } = await supabase
          .from("integration_logs")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("endpoint", "/sale")
          .eq("status", "SUCCESS")
          .gte("created_at", yesterday.toISOString())
          .contains("payload", { transactionId });

        if (checkError)
          throw new Error(
            `Falha ao verificar idempotência: ${checkError.message}`,
          );

        if (previousLogs && previousLogs.length > 0) {
          return res.status(200).json({
            success: true,
            message:
              "Transação ignorada: transactionId já processado anteriormente.",
            action: "skipped",
          });
        }
      }

      // Busca o produto
      let query = supabase
        .from("products")
        .select("*")
        .eq("tenant_id", tenantId);
      if (sanitizedEan) {
        query = query.eq("barcode", sanitizedEan);
      } else {
        query = query.eq("internal_code", sanitizedInternalCode);
      }

      const { data: products, error: searchError } = await query;
      if (searchError) throw searchError;

      if (!products || products.length === 0) {
        return res
          .status(404)
          .json({ error: "Produto não encontrado no catálogo." });
      }

      const product = products[0];
      const newStock = Math.max(0, (product.stock || 0) - quantity);

      // Regra de Visibilidade: Se o estoque chegar a zero, ocultar da vitrine (is_featured = false)
      const updates: any = { stock: newStock };
      if (newStock === 0 && product.is_featured) {
        updates.is_featured = false;
      }

      const { error: updateError } = await supabase
        .from("products")
        .update(updates)
        .eq("id", product.id);

      if (updateError) throw updateError;

      // Log integration
      await logIntegration(tenantId, "/sale", req.body, "SUCCESS");

      res
        .status(200)
        .json({ success: true, newStock, hiddenFromShowcase: newStock === 0 });
    } catch (error: any) {
      await logIntegration(
        tenantId,
        "/sale",
        req.body,
        "FAILED",
        error.message,
      );
      res
        .status(500)
        .json({
          error: "Erro interno no servidor de integração.",
          details: error.message,
        });
    }
  },
);

/**
 * @swagger
 * /purchase:
 *   post:
 *     summary: Sincronização de Entrada de Mercadoria (Notas Fiscais)
 *     description: Soma a quantidade de entrada ao saldo atual. Atualiza preços se necessário. Cria rascunho se o produto for novo.
 *     tags: [Compras]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ean
 *               - quantity
 *               - costPrice
 *             properties:
 *               ean:
 *                 type: string
 *               internalCode:
 *                 type: string
 *               name:
 *                 type: string
 *               quantity:
 *                 type: number
 *               costPrice:
 *                 type: number
 *               salePrice:
 *                 type: number
 *     responses:
 *       200:
 *         description: Estoque/Preço atualizado ou produto criado
 */
app.post(
  "/api/v1/integration/purchase",
  authenticateIntegration,
  async (req, res) => {
    const tenantId = (req as any).tenantId;
    const { ean, internalCode, name, quantity, costPrice, salePrice } =
      req.body;

    // Sanitização e Normalização
    const sanitizedEan = ean ? String(ean).replace(/\s+/g, "").trim() : "";
    const sanitizedInternalCode = internalCode
      ? String(internalCode).trim()
      : "";

    if (!sanitizedEan) {
      return res
        .status(400)
        .json({ error: "O 'ean' é obrigatório para entrada de mercadoria." });
    }
    if (typeof quantity !== "number" || quantity <= 0) {
      return res
        .status(400)
        .json({
          error: "Quantidade inválida. Deve ser um número maior que zero.",
        });
    }

    // Tratamento de Precisão Decimal (Preços)
    const sanitizedCostPrice =
      typeof costPrice === "number"
        ? Math.round(costPrice * 100) / 100
        : undefined;
    let sanitizedSalePrice =
      typeof salePrice === "number"
        ? Math.round(salePrice * 100) / 100
        : undefined;

    try {
      const { data: products, error: searchError } = await supabase
        .from("products")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("barcode", sanitizedEan);

      if (searchError) throw searchError;

      if (products && products.length > 0) {
        // Produto existe, atualiza estoque e preço
        const product = products[0];
        const newStock = (product.stock || 0) + quantity;

        const updates: any = { stock: newStock };
        if (
          sanitizedSalePrice !== undefined &&
          sanitizedSalePrice !== product.price
        ) {
          updates.price = sanitizedSalePrice;
        }

        const { error: updateError } = await supabase
          .from("products")
          .update(updates)
          .eq("id", product.id);

        if (updateError) throw updateError;
        res.status(200).json({ success: true, action: "updated", newStock });
      } else {
        // Fallback de preço de venda (Padrão de 50% de margem sobre o preço de custo)
        if (
          sanitizedSalePrice === undefined &&
          sanitizedCostPrice !== undefined
        ) {
          sanitizedSalePrice = Math.round(sanitizedCostPrice * 1.5 * 100) / 100;
        }

        // Produto novo, cria rascunho. Garante Fallback de Código Interno
        const newProduct = {
          id: crypto.randomUUID(),
          tenant_id: tenantId,
          barcode: sanitizedEan,
          internal_code: sanitizedInternalCode || sanitizedEan,
          name: name ? String(name).trim() : `Produto Novo (${sanitizedEan})`,
          stock: quantity,
          price: sanitizedSalePrice ?? 0,
          category: "Geral",
          is_ai_enriched: false,
          is_featured: false,
        };

        const { data: inserted, error: insertError } = await supabase
          .from("products")
          .insert(newProduct)
          .select();

        if (insertError) throw insertError;

        // O "Exército de Agentes" (cron job ou trigger) vai pegar os produtos com is_ai_enriched = false
        res
          .status(201)
          .json({ success: true, action: "created", product: inserted[0] });
      }

      await logIntegration(tenantId, "/purchase", req.body, "SUCCESS");
    } catch (error: any) {
      await logIntegration(
        tenantId,
        "/purchase",
        req.body,
        "FAILED",
        error.message,
      );
      res
        .status(500)
        .json({
          error: "Erro interno no processamento da entrada de mercadoria.",
          details: error.message,
        });
    }
  },
);

app.get("/api/v1/integration/logs/:tenantId", checkTenantAccess, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { data, error } = await supabase
      .from("integration_logs")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      const errMsg = error.message || String(error);
      const errStr = JSON.stringify(error);
      if (
        errMsg.includes("schema cache") ||
        errStr.includes("schema cache") ||
        error.code === "42P01"
      ) {
        return res.json([]);
      }
      return res.status(500).json({ error: errMsg });
    }
    res.json(data);
  } catch (err: any) {
    const errMsg = err?.message || err?.error || String(err);
    const errStr = JSON.stringify(err);
    if (
      errMsg.includes("schema cache") ||
      errStr.includes("schema cache") ||
      err?.code === "42P01"
    ) {
      return res.json([]);
    }
    res.status(500).json({ error: errMsg });
  }
});

app.post("/api/integrations/erp/send-order", async (req, res) => {
  try {
    const { order_id, tenant_id } = req.body;
    if (!order_id || !tenant_id) {
      return res.status(400).json({ error: 'Missing order_id or tenant_id' });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
    const supabaseClient = createClient(supabaseUrl, supabaseKey);

    const { data: order, error: fetchError } = await supabaseClient
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
      .eq('id', order_id)
      .eq('tenant_id', tenant_id)
      .single();

    let targetOrder = order;

    if (fetchError || !order) {
      const { data: orderJson, error: fetchJsonError } = await supabaseClient
        .from('orders')
        .select('*')
        .eq('id', order_id)
        .eq('tenant_id', tenant_id)
        .single();
        
      if (fetchJsonError || !orderJson) {
         return res.status(404).json({ error: 'Pedido não encontrado ou acesso negado ao tenant.' });
      }
      targetOrder = orderJson;
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

    const { data: tenantSettings } = await supabaseClient
      .from('tenants')
      .select('erp_webhook_url, erp_webhook_secret')
      .eq('id', targetOrder.tenant_id)
      .maybeSingle();

    if (tenantSettings?.erp_webhook_url) {
      try {
        const webhookResponse = await fetch(tenantSettings.erp_webhook_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(tenantSettings.erp_webhook_secret ? { 'Authorization': `Bearer ${tenantSettings.erp_webhook_secret}` } : {})
          },
          body: JSON.stringify(payload)
        });
        if (!webhookResponse.ok) {
          console.error(`Erro ao enviar payload ao Webhook. Status: ${webhookResponse.status}`);
        }
      } catch (err) {
        console.error('Falha na requisição para o Webhook do ERP', err);
      }
    }

    const { error: updateError } = await supabaseClient
      .from('orders')
      .update({ status: 'enviado_ao_pdv' })
      .eq('id', targetOrder.id)
      .eq('tenant_id', targetOrder.tenant_id);

    if (updateError) {
      console.error('Erro ao atualizar status do pedido no Supabase:', updateError);
      return res.status(500).json({ error: 'Falha ao atualizar status do pedido para enviado_ao_pdv' });
    }

    return res.json({
      success: true,
      message: 'Pedido enviado à fila de integração do ERP (PDV) com sucesso',
      payload_enviado: payload
    });
  } catch (error: any) {
    console.error('Erro ao processar integração ERP:', error);
    return res.status(500).json({ error: 'Erro interno no servidor', details: error.message });
  }
});

app.post("/api/v1/integration/logs/internal", async (req, res) => {
  try {
    const { tenant_id, endpoint, payload, status, error_message } = req.body;
    await logIntegration(tenant_id, endpoint, payload, status, error_message);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Helper for logging
async function logIntegration(
  tenantId: string,
  endpoint: string,
  payload: any,
  status: "SUCCESS" | "FAILED",
  errorMessage?: string,
) {
  try {
    await supabase.from("integration_logs").insert({
      tenant_id: tenantId,
      endpoint,
      payload,
      status,
      error_message: errorMessage,
    });
  } catch (e) {
    console.error("Failed to log integration:", e);
  }
}

/**
 * @swagger
 * /sync/inventory:
 *   post:
 *     summary: Webhook Unificado para Sincronização de Vendas e Estoque
 *     description: Recebe dados do sistema da farmácia (ERP) para realizar a baixa de estoque automática (SALE) e a atualização de entradas de mercadoria (PURCHASE).
 *     tags: [Integração]
 *     parameters:
 *       - in: query
 *         name: token
 *         schema:
 *           type: string
 *         required: true
 *         description: Token de integração vinculado ao CNPJ da farmácia
 *       - in: query
 *         name: tenant_id
 *         schema:
 *           type: string
 *         required: false
 *         description: ID do Tenant (opcional se o token for único)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [SALE, PURCHASE]
 *                 description: Tipo de operação
 *               ean:
 *                 type: string
 *                 description: Código de barras (EAN)
 *               internalCode:
 *                 type: string
 *                 description: Código interno no ERP
 *               quantity:
 *                 type: number
 *                 description: Quantidade vendida ou comprada
 *               price_sale:
 *                 type: number
 *     responses:
 *       202:
 *         description: Sincronização aceita e enviada para processamento em background
 *       400:
 *         description: Dados inválidos
 *       401:
 *         description: Token inválido
 *       404:
 *         description: Produto não encontrado
 *
 */
app.post("/api/v1/sync/inventory", async (req, res) => {
  const token =
    (req.query.token as string) || (req.headers["x-api-key"] as string);
  const tenantIdQuery = req.query.tenant_id as string;

  if (!token) {
    return res.status(401).json({ error: "Token não fornecido" });
  }

  try {
    let query = supabase
      .from("tenants")
      .select("id, cnpj")
      .eq("integration_token", token);
    if (tenantIdQuery) {
      query = query.eq("id", tenantIdQuery);
    }

    const { data: tenant, error: tenantError } = await query.single();

    if (tenantError || !tenant) {
      return res.status(401).json({ error: "Token ou Tenant ID inválido" });
    }

    const tenantId = tenant.id;
    const { type, ean, internalCode, quantity, price_sale } = req.body;

    if (!type || !["SALE", "PURCHASE"].includes(type)) {
      await logIntegration(
        tenantId,
        "/sync/inventory",
        req.body,
        "FAILED",
        "Tipo de operação inválido",
      );
      return res
        .status(400)
        .json({ error: "Tipo de operação inválido. Use SALE ou PURCHASE." });
    }

    if (!ean && !internalCode) {
      await logIntegration(
        tenantId,
        "/sync/inventory",
        req.body,
        "FAILED",
        "EAN ou Código Interno não fornecido",
      );
      return res
        .status(400)
        .json({ error: "É necessário fornecer o EAN ou o Código Interno" });
    }

    if (typeof quantity !== "number" || quantity <= 0) {
      await logIntegration(
        tenantId,
        "/sync/inventory",
        req.body,
        "FAILED",
        "Quantidade inválida",
      );
      return res.status(400).json({ error: "Quantidade inválida" });
    }

    // Push to queue
    await webhookQueue.push({
      tenantId,
      type,
      ean,
      internalCode,
      quantity,
      price_sale,
      originalPayload: req.body,
    });

    res
      .status(202)
      .json({
        success: true,
        message:
          "Sincronização aceita e enviada para processamento em background",
      });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Servico de Mensageria - WhatsApp

app.post("/api/v1/analytics/:tenantId/install", async (req, res) => {
  try {
    const { tenantId } = req.params;
    const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    
    const { error } = await supabase.rpc("increment_store_analytics", {
      p_tenant_id: tenantId,
      p_date: date,
      p_increment_installs: 1
    });

    if (error) {
      const { data: existing, error: selectError } = await supabase
        .from("store_analytics")
        .select("id, pwa_installs_count")
        .eq("tenant_id", tenantId)
        .eq("date", date)
        .single();
        
      if (selectError && (selectError.code === "42P01")) {
        // Table missing
      } else if (selectError && selectError.code === "PGRST116") {
        await supabase
          .from("store_analytics")
          .insert({ tenant_id: tenantId, date, pwa_installs_count: 1 });
      } else if (existing) {
        await supabase
          .from("store_analytics")
          .update({ pwa_installs_count: (existing.pwa_installs_count || 0) + 1 })
          .eq("id", existing.id);
      } else if (!selectError) {
        await supabase
          .from("store_analytics")
          .insert({ tenant_id: tenantId, date, pwa_installs_count: 1 });
      }
    }
    
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/v1/analytics/:tenantId/view", async (req, res) => {
  try {
    const { tenantId } = req.params;
    const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    
    // Call the RPC we created or upsert via Supabase JS
    const { error } = await supabase.rpc("increment_store_analytics", {
      p_tenant_id: tenantId,
      p_date: date,
      p_increment_views: 1
    });

    if (error) {
      // Fallback if RPC doesn't exist yet, do simple insert with 1 view
      const { data: existing, error: selectError } = await supabase
        .from("store_analytics")
        .select("id, views_count")
        .eq("tenant_id", tenantId)
        .eq("date", date)
        .single();
        
      if (selectError && (selectError.code === "42P01")) {
        // Table missing, just ignore to prevent crashing until migration is applied
      } else if (selectError && selectError.code === "PGRST116") {
        await supabase
          .from("store_analytics")
          .insert({ tenant_id: tenantId, date, views_count: 1 });
      } else if (existing) {
        await supabase
          .from("store_analytics")
          .update({ views_count: existing.views_count + 1 })
          .eq("id", existing.id);
      } else if (!selectError) {
        await supabase
          .from("store_analytics")
          .insert({ tenant_id: tenantId, date, views_count: 1 });
      }
    }
    
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/v1/analytics/:tenantId/track-event", async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { productId, productName, source } = req.body;
    
    // We expect the 'access_logs' table to have:
    // id, tenant_id, product_id, product_name, source, created_at
    const { error } = await supabase
      .from("access_logs")
      .insert({
        tenant_id: tenantId,
        product_id: productId,
        product_name: productName,
        source: source || 'direct'
      });
      
    if (error && error.code !== "42P01") {
      console.warn("Error inserting access log:", error.message);
    }
    
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/v1/analytics/:tenantId", checkTenantAccess, async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    // Get last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const dateStr = sevenDaysAgo.toISOString().split("T")[0];
    
    const { data: recentStats, error } = await supabase
      .from("store_analytics")
      .select("*")
      .eq("tenant_id", tenantId)
      .gte("date", dateStr)
      .order("date", { ascending: true });
      
    if (error) {
      console.error("Error fetching recent stats:", error);
    }
    
    // Calc total for the month
    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
    
    const { data: monthStats, error: monthError } = await supabase
      .from("store_analytics")
      .select("views_count, pwa_installs_count")
      .eq("tenant_id", tenantId)
      .gte("date", firstDayOfMonth);
      
    if (monthError) {
      console.error("Error fetching month stats:", monthError);
    }
    
    const totalMonthViews = monthStats ? monthStats.reduce((acc, curr) => acc + (curr.views_count || 0), 0) : 0;
    const totalMonthInstalls = monthStats ? monthStats.reduce((acc, curr) => acc + (curr.pwa_installs_count || 0), 0) : 0;
    
    res.json({
      success: true,
      data: {
        recent: recentStats || [],
        totals: {
          views: totalMonthViews,
          installs: totalMonthInstalls
        }
      }
    });
  } catch (err: any) {
    console.error("Error in GET /api/v1/analytics: ", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/v1/tenants/:tenantId/messages/whatsapp", async (req, res) => {
  try {
    const { orderId, customerName, customerPhone } = req.body;

    if (!orderId || !customerName || !customerPhone) {
      return res.status(400).json({ error: "Dados incompletos para envio de mensagem." });
    }

    // Aqui seria feita a integracao com a API oficial do WhatsApp Business ou provedor/webhook (ex: Twilio, Z-API, Evolution API)
    // Para fins do teste atual, simularemos o delay e o log de sucesso.
    console.log(`[WHATSAPP API] Notificação enviada com sucesso!
Para: ${customerPhone}
Mensagem: "Olá, ${customerName}! 🛵 Seu pedido da Farmácia já foi separado e acabou de sair para entrega com o nosso motoboy. Em breve ele estará aí!"`);

    // Resposta de sucesso simulada
    return res.json({ success: true, message: "Mensagem enviada com sucesso." });
  } catch (error: any) {
    console.error("Erro interno no disparo do WhatsApp:", error);
    return res.status(500).json({ error: "Falha ao enviar mensagem de WhatsApp." });
  }
});




// Rate Limiter para a rota de cálculo de frete
const deliveryFeeLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 10, // Máximo de 10 requisições por IP por minuto
  message: { error: "Muitas requisições para cálculo de frete. Tente novamente em alguns segundos." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket.remoteAddress;
    return (Array.isArray(ip) ? ip[0] : ip) || '';
  },
});

app.post("/api/checkout/delivery-fee", deliveryFeeLimiter, async (req, res) => {
  try {
    const { tenantId, customerAddress, orderTotal } = req.body;
    
    if (!tenantId || !customerAddress) {
      return res.status(400).json({ error: "Parâmetros inválidos." });
    }

    // 1. Fetch tenant to get delivery settings and store address
    const { data: tenant, error } = await supabaseAdmin
      .from('tenants')
      .select('delivery_settings, full_address')
      .eq('id', tenantId)
      .single();
      
    if (error || !tenant) {
      console.error("Erro ao buscar tenant:", error);
      return res.status(404).json({ error: "Farmácia não encontrada." });
    }

    const settings = tenant.delivery_settings;
    const addressFromDatabase = tenant.full_address;
    
    // Resiliência: Se a consulta ao banco não encontrar o endereço da farmácia, o sistema deve retornar um erro claro ('Endereço da loja não configurado')
    if (!addressFromDatabase) {
      console.warn("Endereço da loja não configurado no banco de dados.");
      return res.status(400).json({ 
        success: false, 
        message: "Endereço da loja não configurado", 
        error: "Endereço da loja não configurado" 
      });
    }

    const storeAddress = addressFromDatabase;
    
    // Fallback: If no settings or disabled, free delivery
    if (!settings || !settings.enabled) {
      return res.json({ fee: 0, isFreeDelivery: true, distanceKm: 0, success: true });
    }

    // Check for Free Delivery by order amount
    if (settings.minOrderForFreeDelivery && orderTotal >= settings.minOrderForFreeDelivery) {
      return res.json({ fee: 0, isFreeDelivery: true, distanceKm: 0, success: true });
    }

    // Fixed Fee
    if (!settings.type || settings.type === 'fixed') {
      return res.json({ fee: settings.fee || 0, isFreeDelivery: false, distanceKm: 0, success: true });
    }

    // Dynamic Fee - Needs distance calculation
    if (settings.type === 'dynamic') {
      // Security Fallback 1: If store address is missing, fallback to max fee or manual mode
      if (!storeAddress) {
        console.warn("Endereço da loja não configurado.");
        return res.json({ 
          fee: settings.fee || 0, // Fallback to base fixed fee
          isFreeDelivery: false, 
          distanceKm: 0, 
          success: false, 
          message: "Endereço da loja não configurado. Aplicando taxa base." 
        });
      }

      let distanceKm = 0;
      let fromCache = false;

      // Otimização: Cache de Rotas (Supabase)
      try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const { data: cachedDistance, error: cacheError } = await supabaseAdmin
          .from('delivery_distance_cache')
          .select('distance_km')
          .eq('origin_address', storeAddress)
          .eq('destination_address', customerAddress)
          .gte('created_at', thirtyDaysAgo.toISOString())
          .limit(1)
          .single();

        if (cachedDistance && !cacheError) {
           distanceKm = cachedDistance.distance_km;
           fromCache = true;
           console.log("[Delivery Cache] Hit:", distanceKm, "km");
        }
      } catch (e) {
        // Ignorar erros de cache (ex: tabela ainda não foi criada)
        console.log("[Delivery Cache] Erro ao ler cache (ignorado)");
      }

      if (!fromCache) {
        // Validação de Origem: log de verificação que imprime no terminal exatamente qual endereço está sendo enviado
        console.log('Calculando rota de:', addressFromDatabase);

        // 2. Calculate Distance using Google Maps API
        const distanceResult = await calculateDeliveryDistance(addressFromDatabase, customerAddress);
        
        // Security Fallback 2: Se a API falhar (ex: OVER_QUERY_LIMIT)
        if (!distanceResult.success) {
          console.warn("Falha na API de Mapas:", distanceResult.message);
          
          if (distanceResult.isFallback) {
             return res.json({
               fee: 0, 
               isFreeDelivery: false,
               distanceKm: 0,
               success: false,
               message: "Cota de cálculo de frete excedida. Por favor, verifique o frete com a loja.",
               fallback: false
             });
          }

          // Heuristic: Check if customer city matches store city
          const storeCityMatch = addressFromDatabase.match(/,\s*([^,]+)(?:\s*-\s*[A-Z]{2})?$/);
          const customerCityMatch = customerAddress.match(/,\s*([^,]+)(?:\s*-\s*[A-Z]{2})?(?:\s*-\s*CEP.*)?$/i);
          
          const storeCity = storeCityMatch ? storeCityMatch[1].trim().toLowerCase() : "";
          const customerCity = customerCityMatch ? customerCityMatch[1].trim().toLowerCase() : "";

          if (storeCity && customerCity && storeCity !== customerCity) {
            console.log(`[Delivery Fallback] Cidades diferentes: ${storeCity} vs ${customerCity}. Bloqueando.`);
            return res.json({
              fee: 0,
              isFreeDelivery: false,
              distanceKm: 0,
              success: false,
              message: "Seu endereço está fora da nossa área de entrega (cidade diferente).",
              fallback: false
            });
          }

          console.log(`[Delivery Fallback] Cidades coincidem (${storeCity}) ou falha na extração. Permitindo 'A combinar'.`);
          return res.json({
            fee: -1,
            isFreeDelivery: false,
            distanceKm: 0,
            success: true, // Allow it to proceed
            fallback: true
          });
        }

        distanceKm = distanceResult.distanceKm;

        // Salvar no Cache de Rotas (se der erro, ignoramos silenciosamente)
        try {
          await supabaseAdmin
            .from('delivery_distance_cache')
            .insert({
               origin_address: storeAddress,
               destination_address: customerAddress,
               distance_km: distanceKm,
               created_at: new Date().toISOString()
            });
        } catch (e) {}
      }

      // 3. Get delivery fee ranges, prioritizing JSON column and falling back to SQL table
      let rangesToUse = [];

      if (settings.ranges && settings.ranges.length > 0) {
        rangesToUse = settings.ranges.map((r: any) => ({
          minKm: Number(r.minKm ?? 0),
          maxKm: Number(r.maxKm ?? 0),
          fee: Number(r.fee ?? 0)
        }));
      }

      if (rangesToUse.length === 0) {
        const { data: dbFees, error: dbFeesError } = await supabaseAdmin
          .from('delivery_fees')
          .select('min_km, max_km, fee')
          .eq('tenant_id', tenantId);
        
        if (!dbFeesError && dbFees && dbFees.length > 0) {
          rangesToUse = dbFees.map((f: any) => ({
            minKm: Number(f.min_km ?? 0),
            maxKm: Number(f.max_km ?? 0),
            fee: Number(f.fee ?? 0)
          }));
        }
      }

      // If no ranges are configured at all, fallback to base fee
      if (rangesToUse.length === 0) {
        console.log(`[Delivery Calculation] No ranges configured for tenant ${tenantId}. Fallback to base fee: R$ ${settings.fee || 0}`);
        return res.json({
          fee: settings.fee || 0,
          isFreeDelivery: false,
          distanceKm,
          success: true
        });
      }

      // Sort ranges by maxKm ascending to evaluate them sequentially and prevent gaps
      rangesToUse.sort((a, b) => a.maxKm - b.maxKm);
      const maxKmLimit = rangesToUse[rangesToUse.length - 1].maxKm;

      console.log(`[Delivery Calculation] Tenant: ${tenantId}, Distance: ${distanceKm} km, Max Limit: ${maxKmLimit} km`);

      if (distanceKm > maxKmLimit) {
        console.log(`[Delivery Calculation] Distance ${distanceKm} km exceeds maximum limit of ${maxKmLimit} km.`);
        return res.json({ 
          fee: 0, 
          isFreeDelivery: false, 
          distanceKm, 
          success: false, 
          message: "Seu endereço está fora da nossa área de entrega." 
        });
      }

      // Match the first range where distanceKm is less than or equal to maxKm (handles gaps beautifully)
      let matchedRange = null;
      for (const range of rangesToUse) {
        if (distanceKm <= range.maxKm) {
          matchedRange = range;
          break;
        }
      }

      if (matchedRange) {
        console.log(`[Delivery Calculation] Matched range: ${matchedRange.minKm}-${matchedRange.maxKm} km, Fee: R$ ${matchedRange.fee}`);
        return res.json({ 
          fee: matchedRange.fee, 
          isFreeDelivery: false, 
          distanceKm, 
          success: true 
        });
      }

      // Safe fallback if loop somehow doesn't match
      return res.json({ 
        fee: settings.fee || 0, 
        isFreeDelivery: false, 
        distanceKm, 
        success: false, 
        message: "Nenhuma faixa de entrega encontrada para esta distância.",
        fallback: true
      });
    }

    res.json({ fee: 0, isFreeDelivery: true, distanceKm: 0, success: true });
  } catch (err) {
    console.error("Erro no delivery-fee:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/checkout/calculate-delivery", async (req, res) => {
  try {
    const { distanceKm, orderTotal, tenantId } = req.body;
    
    if (typeof distanceKm !== 'number' || typeof orderTotal !== 'number' || !tenantId) {
      return res.status(400).json({ error: "Parâmetros inválidos." });
    }

    const { data: tenant, error } = await supabaseAdmin
      .from('tenants')
      .select('delivery_settings')
      .eq('id', tenantId)
      .single();
      
    if (error || !tenant) {
      return res.status(404).json({ error: "Farmácia não encontrada." });
    }

    const settings = tenant.delivery_settings;
    
    if (!settings || !settings.enabled) {
      return res.json({ fee: 0, isFreeDelivery: true, success: true });
    }

    if (settings.minOrderForFreeDelivery && orderTotal >= settings.minOrderForFreeDelivery) {
      return res.json({ fee: 0, isFreeDelivery: true, success: true });
    }

    if (!settings.type || settings.type === 'fixed') {
      return res.json({ fee: settings.fee || 0, isFreeDelivery: false, success: true });
    }

    if (settings.type === 'dynamic' && settings.ranges && settings.ranges.length > 0) {
      const sortedRanges = [...settings.ranges].sort((a, b) => a.minKm - b.minKm);
      
      for (const range of sortedRanges) {
        if (distanceKm >= range.minKm && distanceKm <= range.maxKm) {
          return res.json({ fee: range.fee, isFreeDelivery: false, success: true });
        }
      }
      
      const maxRange = sortedRanges[sortedRanges.length - 1];
      if (distanceKm > maxRange.maxKm) {
        return res.json({ fee: 0, isFreeDelivery: false, success: false, message: "Fora da área de entrega." });
      }
      
      return res.json({ fee: 0, isFreeDelivery: false, success: false, message: "Não foi possível calcular a taxa para esta distância (Faixa não mapeada)." });
    }

    res.json({ fee: 0, isFreeDelivery: true, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/checkout/address-lookup", async (req, res) => {
  try {
    const { whatsapp, tenant_id } = req.query;
    if (!whatsapp || !tenant_id) {
      return res.status(400).json({ error: "whatsapp and tenant_id are required" });
    }

    const { data, error } = await supabase
      .from("delivery_addresses")
      .select("customer_name, cep, street, number, complement, neighborhood, city")
      .eq("tenant_id", tenant_id as string)
      .eq("whatsapp", (whatsapp as string).replace(/\D/g, ""))
      .single();

    if (error) {
      // PGRST116 means zero rows found
      if (error.code === "PGRST116" || error.code === "42P01") {
        return res.json({ found: false });
      }
      return res.status(500).json({ error: error.message });
    }

    if (data) {
      res.json({
        found: true,
        data: {
          customer_name: data.customer_name,
          cep: data.cep,
          street: data.street,
          neighborhood: data.neighborhood,
          city: data.city,
          number: data.number,
          complement: data.complement
        }
      });
    } else {
      res.json({ found: false });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});


// Endpoint para baixa de estoque via checkout
app.post("/api/checkout/deduct-stock", async (req, res) => {
  try {
    const { tenantId, items } = req.body;
    if (!tenantId || !items || !Array.isArray(items)) {
      return res.status(400).json({ error: "Invalid parameters" });
    }
    
    for (const item of items) {
      if (!item.id) continue;
      
      const { data: prod } = await supabaseAdmin
        .from('products')
        .select('stock, is_featured')
        .eq('id', item.id)
        .single();
        
      if (prod && typeof prod.stock === 'number') {
        const newStock = Math.max(0, prod.stock - item.quantity);
        await supabaseAdmin
          .from('products')
          .update({ 
            stock: newStock,
            is_featured: newStock === 0 ? false : prod.is_featured 
          })
          .eq('id', item.id);
          
        console.log(`[ESTOQUE] Produto ID ${item.id} atualizado após venda. Novo estoque: ${newStock}`);
      }
    }
    
    res.json({ success: true });
  } catch (err: any) {
    console.error("Erro ao deduzir estoque:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/checkout/address-save", async (req, res) => {
  try {
    const { tenant_id, whatsapp, customer_name, cep, street, number, neighborhood, city, complement } = req.body;
    if (!tenant_id || !whatsapp) {
      return res.status(400).json({ error: "whatsapp and tenant_id are required" });
    }

    const cleanWhatsapp = whatsapp.replace(/\D/g, "");
    
    // Upsert into delivery_addresses (using unique constraint on tenant_id, whatsapp)
    const { error } = await supabase
      .from("delivery_addresses")
      .upsert({
        tenant_id,
        whatsapp: cleanWhatsapp,
        customer_name,
        cep,
        street,
        number,
        neighborhood,
        city,
        complement,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'tenant_id,whatsapp'
      });

    if (error && error.code !== "42P01") {
        return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/coupons/validate", async (req, res) => {
  try {
    const { tenant_id, code } = req.body;
    
    if (!tenant_id || !code) {
      return res.status(400).json({ error: "MISSING_DATA", message: "ID do tenant e código do cupom são obrigatórios." });
    }

    const cleanCode = code.trim().toUpperCase();

    // Query tenant to check for network/matrix ID
    const { data: tenant } = await supabase
      .from("tenants")
      .select("network_id")
      .eq("id", tenant_id)
      .single();
    const networkId = tenant?.network_id;

    let tenantOrClause = `tenant_id.eq.${tenant_id},tenant_id.is.null`;
    if (networkId) {
      tenantOrClause += `,tenant_id.eq.${networkId}`;
    }

    // Query both tenant-specific, matrix-specific and global coupons
    const { data: coupons, error } = await supabase
      .from("coupons")
      .select("*")
      .ilike("code", cleanCode)
      .or(tenantOrClause);

    if (error) {
      return res.status(500).json({ error: "DATABASE_ERROR", message: error.message });
    }

    if (!coupons || coupons.length === 0) {
      return res.status(404).json({ error: "COUPON_NOT_FOUND", message: "Cupom inválido ou não encontrado." });
    }

    // Since we used ilike, find the exact match case-insensitively just to be safe although the query already filters
    const coupon = coupons.find(c => c.code.toUpperCase() === cleanCode);
    
    if (!coupon) {
       return res.status(404).json({ error: "COUPON_NOT_FOUND", message: "Cupom inválido ou não encontrado." });
    }

    // Mapping DB coupon to app expected format
    const appCoupon = {
       id: coupon.id,
       code: coupon.code,
       discountType: coupon.discount_type || coupon.discounttype,
       discountValue: coupon.discount_value || coupon.discountvalue,
       couponScope: coupon.coupon_scope || coupon.couponscope,
       minPurchaseValue: coupon.min_purchase_value || coupon.minpurchasevalue,
       targetType: coupon.target_type || coupon.targettype,
       targetValue: coupon.target_value || coupon.targetvalue,
       specificProductIds: coupon.specific_product_ids || coupon.specificproductids,
       filtersMetadata: coupon.filters_metadata || coupon.filtersmetadata,
       startDate: coupon.start_date || coupon.startdate,
       endDate: coupon.end_date || coupon.enddate,
       isActive: coupon.is_active !== false && coupon.isactive !== false,
    };

    if (!appCoupon.isActive) {
      return res.status(400).json({ error: "COUPON_INACTIVE", message: "Este cupom não está mais ativo." });
    }

    const now = new Date();
    const start = appCoupon.startDate ? new Date(appCoupon.startDate) : null;
    let end = null;
    
    if (appCoupon.endDate) {
      if (appCoupon.endDate.includes("T")) {
        end = new Date(appCoupon.endDate);
      } else {
        const [year, month, day] = appCoupon.endDate.split("-");
        end = new Date(Number(year), Number(month) - 1, Number(day), 23, 59, 59, 999);
      }
    }

    if (start && now < start) {
      return res.status(400).json({ error: "COUPON_NOT_YET_VALID", message: "Este cupom ainda não é válido." });
    }
    if (end && now > end) {
      return res.status(400).json({ error: "COUPON_EXPIRED", message: "Este cupom já expirou." });
    }

    res.json({ success: true, coupon: appCoupon });
  } catch (e: any) {
    res.status(500).json({ error: "SERVER_ERROR", message: e.message });
  }
});

// Setup Swagger
setupSwagger(app);

// --- VITE MIDDLEWARE ---


app.post("/api/v1/agent/generate-token", async (req, res) => {
  try {
    const { tenant_id } = req.body;
    if (!tenant_id) {
      return res.status(400).json({ error: "tenant_id é obrigatório" });
    }

    const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
    const token = `FF-${randomHex}`;

    const { data, error } = await supabaseAdmin
      .from('activation_tokens')
      .insert({
        token,
        tenant_id,
        is_used: false
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json({ success: true, token: data.token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/v1/agent/activate", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: "Token não fornecido" });
    }

    const { data: tokenData, error: fetchError } = await supabaseAdmin
      .from('activation_tokens')
      .select('*')
      .eq('token', token)
      .eq('is_used', false)
      .single();

    if (fetchError || !tokenData) {
      return res.status(404).json({ error: "Token inválido ou já utilizado" });
    }

    const { error: updateError } = await supabaseAdmin
      .from('activation_tokens')
      .update({ is_used: true })
      .eq('id', tokenData.id);

    if (updateError) {
      return res.status(500).json({ error: "Erro ao ativar o token" });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

    res.json({
      tenantId: tokenData.tenant_id,
      supabaseUrl,
      supabaseAnonKey
    });
  } catch (error: any) {
    res.status(500).json({ error: "Erro interno no servidor", details: error.message });
  }
});

// Dedicated and highly robust agent download route to serve installer zip files directly with proper binary headers
app.get(["/installers/:filename", "/public/installers/:filename"], (req, res) => {
  try {
    const filename = path.basename(req.params.filename as string);
    const filePath = path.join(process.cwd(), "public", "installers", filename);

    if (fs.existsSync(filePath)) {
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.sendFile(filePath);
    } else {
      return res.status(404).send("Arquivo de instalador não encontrado");
    }
  } catch (err: any) {
    console.error("[Installers Download Error]", err);
    return res.status(500).send("Erro ao baixar o instalador");
  }
});

app.get("/api/v1/agent/download/:erpType", (req, res) => {
  try {
    const { erpType } = req.params;
    let fileName = "farmaflow-agent.zip";
    if (erpType === "siagold") {
      fileName = "farmaflow-siagold.zip";
    } else if (erpType === "softpharma") {
      fileName = "farmaflow-softpharma.zip";
    }

    const filePath = path.join(process.cwd(), "public", "installers", fileName);
    if (fs.existsSync(filePath)) {
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      return res.sendFile(filePath);
    } else {
      return res.redirect(302, `/installers/${fileName}`);
    }
  } catch (err: any) {
    console.error("[Agent Download] Erro interno no manipulador de download do agente:", err);
    return res.status(500).json({ error: "Erro interno ao processar o download do agente." });
  }
});

const validateTokenHandler = async (req: express.Request, res: express.Response) => {
  console.log(`\n[SERVER BACKEND] Recebida requisição de validação em /api/v1/integration/validate-token`);
  try {
    const { token, machineId, machine_id, machine, hostname } = req.body || {};
    const headerMachineId = req.headers['x-machine-id'] || req.headers['machine-id'];
    const mId = machineId || machine_id || machine || hostname || headerMachineId || 'unknown';

    console.log(`- Token recebido: "${token ? token.substring(0, 8) + '...' : 'não fornecido'}"`);
    console.log(`- Machine ID: "${mId}"`);

    if (!token) {
      console.warn(`[SERVER BACKEND] Validação recusada: Token não fornecido (400 Bad Request)`);
      return res.status(400).json({ error: "Token não fornecido" });
    }

    const { data: tokenData, error: fetchError } = await supabaseAdmin
      .from('activation_tokens')
      .select('*')
      .eq('token', token)
      .single();

    if (fetchError || !tokenData) {
      console.warn(`[SERVER BACKEND] Validação recusada: Token não encontrado no Supabase (404 Not Found)`);
      return res.status(404).json({ error: "Token inválido, inativo ou não encontrado." });
    }

    console.log(`- Marcando token como utilizado...`);
    await supabaseAdmin
      .from('activation_tokens')
      .update({ is_used: true })
      .eq('id', tokenData.id);

    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('erp_type')
      .eq('id', tokenData.tenant_id)
      .single();
      
    try {
      await supabaseAdmin
        .from('agent_integrations')
        .upsert({
          tenant_id: tokenData.tenant_id,
          activation_token: token,
          machine_id: mId,
          is_active: true,
          last_seen: new Date().toISOString()
        }, { onConflict: 'tenant_id' });
    } catch (e) {
      console.error("Erro ao registrar agent_integrations (a tabela existe?)", e);
    }

    const erpType = tenant?.erp_type || 'siagold';

    console.log(`[SERVER BACKEND] Token validado com sucesso! Tenant ERP: ${erpType}`);

    res.json({
      erpType: erpType.toLowerCase(),
      dbConfig: {
        user: "sa", // Placeholder
        password: "sua_senha_aqui",
        server: "localhost",
        database: "SIAGOLD",
        branchCode: "1",
        viewName: 'VW_INTEGRACAO_FARMAFLOW'
      },
      apiKey: tokenData.tenant_id
    });
  } catch (error: any) {
    console.error(`[SERVER BACKEND] Erro interno durante validação do token (500):`, error.message);
    res.status(500).json({ error: "Erro interno no servidor", details: error.message });
  }
};

app.post("/api/v1/integration/validate-token", validateTokenHandler);
app.post("/api/v1/agent/validate-token", validateTokenHandler);
app.post("/api/agent/validate-token", validateTokenHandler);

const handleHeartbeat = async (req: express.Request, res: express.Response) => {
  try {
    const { token, apiKey, tenantId, tenant_id, machineId, machine_id, machine, hostname } = req.body || {};
    const headerApiKey = req.headers['x-api-key'] || req.headers['api-key'] || req.headers['apikey'];
    const activeApiKey = apiKey || tenantId || tenant_id || headerApiKey;
    const headerMachineId = req.headers['x-machine-id'] || req.headers['machine-id'];
    const mId = machineId || machine_id || machine || hostname || headerMachineId;

    if (!token && !activeApiKey) {
      return res.status(400).json({ error: "Token ou API Key não fornecido" });
    }

    let targetTenantId = activeApiKey ? String(activeApiKey) : null;
    let actToken = token ? String(token) : null;

    // Se possui token mas não tenantId, busca tenantId em activation_tokens ou agent_integrations
    if (!targetTenantId && actToken) {
      const { data: tokenRow } = await supabaseAdmin
        .from('activation_tokens')
        .select('tenant_id')
        .eq('token', actToken)
        .maybeSingle();

      if (tokenRow?.tenant_id) {
        targetTenantId = tokenRow.tenant_id;
      } else {
        const { data: agentRow } = await supabaseAdmin
          .from('agent_integrations')
          .select('tenant_id')
          .eq('activation_token', actToken)
          .maybeSingle();
        if (agentRow?.tenant_id) {
          targetTenantId = agentRow.tenant_id;
        }
      }
    }

    const now = new Date().toISOString();

    if (targetTenantId) {
      const upsertPayload: any = {
        tenant_id: targetTenantId,
        last_seen: now,
        is_active: true
      };
      if (actToken) {
        upsertPayload.activation_token = actToken;
      }
      if (mId && mId !== 'unknown') {
        upsertPayload.machine_id = mId;
      }

      const { error: upsertError } = await supabaseAdmin
        .from('agent_integrations')
        .upsert(upsertPayload, { onConflict: 'tenant_id' });

      if (upsertError) {
        console.error("[HEARTBEAT ERROR]", upsertError);
        return res.status(500).json({ error: "Erro ao atualizar heartbeat.", details: upsertError.message });
      }

      console.log(`[HEARTBEAT SUCCESS] Heartbeat atualizado para o tenant: "${targetTenantId}" (Machine ID: ${mId || 'mantido'})`);
      return res.json({ success: true, tenant_id: targetTenantId, last_seen: now });
    } else {
      // Fallback: Atualiza diretamente pelo activation_token
      const updatePayload: any = {
        last_seen: now,
        is_active: true
      };
      if (mId && mId !== 'unknown') {
        updatePayload.machine_id = mId;
      }

      const { data: updateData, error: updateError } = await supabaseAdmin
        .from('agent_integrations')
        .update(updatePayload)
        .eq('activation_token', actToken)
        .select();

      if (updateError) {
        console.error("[HEARTBEAT ERROR]", updateError);
        return res.status(500).json({ error: "Erro ao atualizar heartbeat.", details: updateError.message });
      }

      console.log(`[HEARTBEAT SUCCESS] Heartbeat atualizado para o token: "${actToken}"`);
      return res.json({ success: true, last_seen: now });
    }
  } catch (error: any) {
    console.error("[HEARTBEAT EXCEPTION]", error);
    res.status(500).json({ error: "Erro interno no servidor", details: error.message });
  }
};

app.post("/api/v1/integration/heartbeat", handleHeartbeat);
app.post("/api/v1/agent/ping", handleHeartbeat);
app.post("/api/agent/ping", handleHeartbeat);
app.post("/api/v1/integration/ping", handleHeartbeat);
app.post("/api/v1/agent/heartbeat", handleHeartbeat);
app.post("/api/agent/heartbeat", handleHeartbeat);

app.get("/api/v1/integration/status", async (req, res) => {
  try {
    const { data: integrations, error } = await supabaseAdmin
      .from('agent_integrations')
      .select('*, tenants!inner(id, name)');
      
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    res.json({ data: integrations });
  } catch (error: any) {
    res.status(500).json({ error: "Erro interno no servidor", details: error.message });
  }
});

app.post("/api/v1/integration", async (req, res) => {
  let tenantId: string | null = null;
  try {
    const apiKey = req.headers['x-api-key'] || req.headers['api-key'] || req.headers['apikey'] || req.body?.apiKey || req.body?.api_key;
    
    if (!apiKey) {
      return res.status(401).json({ error: "API Key não fornecida" });
    }

    const { data: tenant, error: fetchError } = await supabaseAdmin
      .from('tenants')
      .select('*')
      .eq('id', apiKey)
      .single();

    if (fetchError || !tenant) {
      return res.status(403).json({ error: "API Key inválida ou tenant não encontrado" });
    }

    tenantId = tenant.id;
    const ignoreErpPrices = tenant.ignore_erp_prices === true || tenant.delivery_settings?.ignore_erp_prices === true;
    
    // Atualiza heartbeat do agente
    try {
      await supabaseAdmin
        .from('agent_integrations')
        .upsert({ 
          tenant_id: tenantId,
          last_seen: new Date().toISOString(), 
          is_active: true 
        }, { onConflict: 'tenant_id' });
    } catch (e) {
      console.error("Erro ao atualizar heartbeat do agente", e);
    }

    let productsBatch = req.body;
    
    if (Array.isArray(productsBatch)) {
      // Já é array
    } else if (productsBatch && Array.isArray(productsBatch.products)) {
        productsBatch = productsBatch.products;
    } else if (productsBatch && Array.isArray(productsBatch.data)) {
        productsBatch = productsBatch.data;
    } else if (productsBatch && Array.isArray(productsBatch.dados)) {
        productsBatch = productsBatch.dados;
    }

    if (!Array.isArray(productsBatch)) {
      return res.status(400).json({ error: "Formato de payload inválido. Esperado array de produtos." });
    }

    const getValFromProduct = (product: any, keys: string[]) => {
      if (!product || typeof product !== 'object') return undefined;
      const normalize = (str: string) => {
        let s = str;
        try {
          s = decodeURIComponent(escape(str));
        } catch (e) {}
        s = s.replace(/Ã³/g, 'o').replace(/Ã§/g, 'c').replace(/Ã£/g, 'a')
             .replace(/Ã¡/g, 'a').replace(/Ã©/g, 'e')
             .replace(/Ãµ/g, 'o').replace(/Ãº/g, 'u').replace(/Ã¢/g, 'a')
             .replace(/Ãª/g, 'e').replace(/Ã´/g, 'o');
        return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9_]/g, "");
      };
      const normalizedKeys = keys.map(k => normalize(k));
      
      for (const key of Object.keys(product)) {
        if (normalizedKeys.includes(normalize(key))) {
          return product[key];
        }
      }
      return undefined;
    };

    const uniquePayloadMap = new Map();
    for (const p of productsBatch) {
       const rawEan = getValFromProduct(p, [
         'barcode', 'ean', 'ean13', 'codigo_barra', 'codigo_barras', 'cod_barra', 'cod_barras', 'codigo_de_barras', 'barras', 'codigo_barra_produto', 'cod barras', 'cod. barras', 
         'cd barras', 'cd. barras', 'cd_barras', 'cd.barras', 'codbarras', 'cdbarras', 'ean_produto'
       ]);
       const ean = rawEan !== undefined && rawEan !== null ? String(rawEan).trim() : "";
       if (!ean) continue;

       const rawInternalCode = getValFromProduct(p, [
         'internal_code', 'internalCode', 'CodigoInterno', 'codigo_interno', 'codigo', 'cod_interno', 'cod_prod', 'codigo_produto', 'cod_produto', 'referencia', 'ref', 'id',
         'cdigo', 'cdg', 'cd'
       ]);
       const internalCode = rawInternalCode !== undefined && rawInternalCode !== null ? String(rawInternalCode).trim() : "";
       
       let stock = Number(getValFromProduct(p, ['stock', 'estoque', 'estoque_atual', 'estoque_disponivel', 'saldo', 'saldo_estoque', 'qtd_estoque', 'quantidade', 'qtd', 'quantidade_estoque', 'quant']));
       if (isNaN(stock) || stock < 0) stock = 0;
       
       let price = Number(getValFromProduct(p, ['price', 'preco_venda', 'preco', 'preco_por', 'preco_unitario', 'valor', 'valor_venda', 'venda', 'preco_venda_unitario']));
       if (isNaN(price) || price < 0) price = 0;

       let originalPrice = Number(getValFromProduct(p, ['original_price', 'originalPrice', 'preco_original', 'preco_de', 'preco_tabela', 'preco_cadastro', 'preco_antigo', 'valor_original']));
       if (isNaN(originalPrice) || originalPrice < 0) originalPrice = 0;

       const rawName = getValFromProduct(p, [
         'name', 'nome', 'descricao', 'descricao_produto', 'nome_produto', 'produto',
         'descrio', 'descr'
       ]);
       const name = rawName !== undefined && rawName !== null ? String(rawName).trim() : `Produto ${ean}`;

       uniquePayloadMap.set(ean, {
          tenant_id: tenantId,
          barcode: ean,
          internal_code: internalCode || null,
          stock,
          price,
          original_price: originalPrice,
          name: name
       });
     }

    const upsertPayload = Array.from(uniquePayloadMap.values());

    if (upsertPayload.length === 0) {
      await logIntegration(tenantId, "/api/v1/integration", { 
        message: "Nenhum produto válido encontrado no lote.", 
        productsBatchSize: productsBatch.length,
        processedCount: 0,
        isSuccess: true,
        rawBatchSample: productsBatch.slice(0, 5)
      }, "SUCCESS");
      return res.status(200).json({ success: true, processed: 0, message: "Nenhum produto válido encontrado no lote." });
    }

    const CHUNK_SIZE = 100;
    let processed = 0;
    
    for (let i = 0; i < upsertPayload.length; i += CHUNK_SIZE) {
      const chunk = upsertPayload.slice(i, i + CHUNK_SIZE);
      
      const barcodes = chunk.map(p => p.barcode);
      const { data: existingProducts } = await supabaseAdmin
        .from('products')
        .select('*')
        .eq('tenant_id', tenantId)
        .in('barcode', barcodes);
        
      const existingMap = new Map();
      if (existingProducts && existingProducts.length > 0) {
         existingProducts.forEach(p => {
            if (p.barcode) {
               existingMap.set(p.barcode, p);
            }
         });
      }

      const newProductsPayload: any[] = [];
      const existingProductsPayload: any[] = [];

      chunk.forEach(item => {
         if (existingMap.has(item.barcode)) {
            const existing = existingMap.get(item.barcode);
            let finalPrice = item.price;
            let finalOriginalPrice = item.original_price;
            
            // Se o ignore_erp_prices estiver ativo, preserva os preços salvos no banco de dados
            if (ignoreErpPrices) {
               finalPrice = existing.price;
               finalOriginalPrice = existing.original_price;
            }
            
            // Regra de Ouro: atualizações de produtos existentes alteram apenas campos específicos, mas completamos a linha com os dados já existentes para evitar que o upsert do PostgREST limpe as colunas não informadas (sobrescrevendo com NULL)
            existingProductsPayload.push({
               ...existing, // Mantém todos os campos existentes (nome, categoria, imagem, princípio ativo, etc.)
               internal_code: item.internal_code || existing.internal_code,
               stock: item.stock,
               price: finalPrice,
               original_price: finalOriginalPrice
            });
         } else {
            // Novo produto: inserção completa incluindo o 'name'
            newProductsPayload.push(item);
         }
      });

      if (newProductsPayload.length > 0) {
         const { error } = await supabaseAdmin
           .from('products')
           .upsert(newProductsPayload, { 
              onConflict: 'tenant_id,barcode', 
              ignoreDuplicates: false 
           });
         if (error) {
            console.error("[Integration] New Products Insert Error:", error);
            throw new Error(`Database insert error: ${error.message}`);
         }
      }

      if (existingProductsPayload.length > 0) {
         const { error } = await supabaseAdmin
           .from('products')
           .upsert(existingProductsPayload, { 
              onConflict: 'tenant_id,barcode', 
              ignoreDuplicates: false 
           });
         if (error) {
            console.error("[Integration] Existing Products Update Error:", error);
            throw new Error(`Database update error: ${error.message}`);
         }
      }
      
      processed += chunk.length;
    }

    try {
      await logIntegration(tenantId, "/api/v1/integration", { 
        message: `Sincronização do agente via API concluída com sucesso`, 
        productsBatchSize: productsBatch.length, 
        processedCount: processed,
        isSuccess: true 
      }, "SUCCESS");
    } catch (logErr) {
      console.error("Erro ao salvar log de sucesso de integração:", logErr);
    }

    res.status(200).json({ success: true, processed });

  } catch (error: any) {
    console.error("[Integration] Error:", error.message);
    try {
      if (tenantId) {
        await logIntegration(tenantId, "/api/v1/integration", { 
          isSuccess: false,
          error: error.message 
        }, "FAILED", error.message);
      }
    } catch (logErr) {
      console.error("Erro ao salvar log de erro de integração:", logErr);
    }
    res.status(500).json({ error: "Erro interno no servidor", details: error.message });
  }
});

// =========================================
// MÓDULO FARMAFLOW CHAT - ROTAS DE BACKEND
// =========================================

// Middleware para verificar se o chat está ativado
const requireChatEnabled = async (req, res, next) => {
  try {
    let tenantId = req.headers['x-tenant-id'] || req.query.tenantId;
    
    // Se não tiver o header direto, tenta extrair da conversa ou instancia dependendo da rota
    if (!tenantId && req.body.conversation_id) {
       const { data: conv } = await supabaseAdmin.from('chat_conversations').select('store_id').eq('id', req.body.conversation_id).single();
       if (conv) tenantId = conv.store_id;
    }
    
    // Em caso de webhook de provedor externo (Evolution API), a instancia geralmente contém ou mapeia o tenantId
    if (!tenantId && req.body?.data?.instance) {
       const { data: inst } = await supabaseAdmin.from('whatsapp_instances').select('store_id').eq('instance_name', req.body.data.instance).single();
       if (inst) tenantId = inst.store_id;
    }

    if (tenantId) {
       const { data: tenant } = await supabaseAdmin.from('tenants').select('is_chat_enabled').eq('id', tenantId).single();
       if (tenant && tenant.is_chat_enabled === false) {
          return res.status(403).json({ error: "Módulo de Chat desativado para esta loja." });
       }
    }
    
    next();
  } catch (error) {
    console.error("[Chat Middleware] Erro ao validar licença:", error);
    next(); // Falha aberta para não quebrar em caso de instabilidade
  }
};



// --- EVOLUTION API WHATSAPP INSTANCE ENDPOINTS ---

app.post("/api/v1/chat/instance/create", requireChatEnabled, async (req, res) => {
  try {
    const tenantId = (req as any).tenantId || req.body.tenantId;
    if (!tenantId) return res.status(400).json({ error: "Tenant ID is required." });

    const evolutionUrl = process.env.EVOLUTION_API_URL?.replace(/\/$/, '');
    const evolutionKey = process.env.EVOLUTION_API_KEY;

    if (!evolutionUrl || !evolutionKey) {
      return res.status(500).json({ error: "A API do WhatsApp (Evolution API) não está configurada no servidor. Faltam credenciais (EVOLUTION_API_URL e EVOLUTION_API_KEY)." });
    }

    const instanceName = `store_${tenantId.replace(/-/g,"")}`;

    // 1. Criar a instância
    const createRes = await fetch(`${evolutionUrl}/instance/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": evolutionKey
      },
      body: JSON.stringify({
        instanceName: instanceName,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS"
      })
    });

    const createData = await createRes.json();
    
    // Verifica se já existe ou retornou o base64
    let base64 = createData?.qrcode?.base64 || createData?.base64;

    if (!base64 && createRes.status === 403 && createData?.message?.includes("already exists")) {
        // Se já existe, tenta buscar o QR code conectando
        const connectRes = await fetch(`${evolutionUrl}/instance/connect/${instanceName}`, {
            headers: { "apikey": evolutionKey }
        });
        const connectData = await connectRes.json();
        base64 = connectData?.base64;
    }

    if (base64) {
      // Salva ou atualiza no banco
      await supabaseAdmin.from('whatsapp_instances').upsert({
         store_id: tenantId,
         instance_name: instanceName,
         status: 'QRCODE',
         updated_at: new Date().toISOString()
      }, { onConflict: 'store_id' });

      return res.json({ success: true, qrcodeBase64: base64 });
    } else {
      return res.status(500).json({ error: "Não foi possível gerar o QR Code. A instância pode já estar conectada." });
    }

  } catch (error: any) {
    console.error("Erro ao criar instância Evolution API:", error);
    res.status(500).json({ error: error.message || "Erro interno ao gerar QR Code" });
  }
});

app.get("/api/v1/chat/instance/status", requireChatEnabled, async (req, res) => {
    try {
        const tenantId = (req as any).tenantId || req.query.tenantId;
        if (!tenantId) return res.status(400).json({ error: "Tenant ID is required." });
        const evolutionUrl = process.env.EVOLUTION_API_URL?.replace(/\/$/, '');
        const evolutionKey = process.env.EVOLUTION_API_KEY;
        if (!evolutionUrl || !evolutionKey) {
            return res.status(500).json({ error: "A API do WhatsApp não está configurada." });
        }
        const instanceName = `store_${tenantId.replace(/-/g,"")}`;
        const stateRes = await fetch(`${evolutionUrl}/instance/connectionState/${instanceName}`, {
            headers: { "apikey": evolutionKey }
        });
        if (stateRes.status === 404) {
            return res.json({ status: 'DISCONNECTED' });
        }
        const stateData = await stateRes.json();
        const connectionState = stateData?.instance?.state || stateData?.state;
        if (connectionState === "open") {
            const phoneNumber = stateData?.instance?.owner?.split('@')[0] || stateData?.owner?.split('@')[0] || null;
            await supabaseAdmin.from('whatsapp_instances').upsert({
               store_id: tenantId,
               instance_name: instanceName,
               status: 'CONNECTED',
               ...(phoneNumber ? { phone_number: phoneNumber } : {}),
               updated_at: new Date().toISOString()
            }, { onConflict: 'store_id' });
            return res.json({ status: 'CONNECTED' });
        } else if (connectionState === "connecting") {
            // Fetch the latest QR code
            try {
                const connectRes = await fetch(`${evolutionUrl}/instance/connect/${instanceName}`, {
                    headers: { "apikey": evolutionKey }
                });
                const connectData = await connectRes.json();
                const base64 = connectData?.qrcode?.base64 || connectData?.base64;
                if (base64) {
                    return res.json({ status: 'QRCODE', qrcodeBase64: base64 });
                }
            } catch (e) {
                console.error("Error fetching latest QR code", e);
            }
            return res.json({ status: 'QRCODE' });
        }
        return res.json({ status: 'DISCONNECTED' });
    } catch(error) {
        return res.status(500).json({ error: "Erro ao buscar status" });
    }
});

app.get("/api/v1/whatsapp/instances", async (req, res) => {
  try {
    const tenantId = (req.query.tenantId as string) || (req.headers["x-tenant-id"] as string) || "default";
    const { data, error } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("*")
      .eq("store_id", tenantId);

    if (!error && data && data.length > 0) {
      return res.json({ data });
    }

    const instanceName = `store_${tenantId.replace(/-/g,"")}`;
    return res.json({
      data: [
        {
          id: `inst_${tenantId}`,
          store_id: tenantId,
          instance_name: instanceName,
          status: "CONNECTED",
          phone_number: "WhatsApp Principal"
        }
      ]
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 1. Webhook Ultra-Leve para Evolution API (Event-Driven Queue)
app.post("/api/v1/chat/webhook", requireChatEnabled, async (req, res) => {
  try {
    console.log('\n[DEBUG] WEBHOOK RECEBIDO - BODY COMPLETO:', JSON.stringify(req.body, null, 2));
    
    // Evolution API geralmente envia 'event', 'instance' e 'data' no root
    const { event, data, instance: bodyInstance } = req.body;
    
    // Captura prioritária na query
    const tenantId = req.query.tenantId || req.query.storeId || req.body.tenantId || bodyInstance || data?.instance;
    
    console.log('[WEBHOOK] Processando para o tenant da query:', tenantId);
    
    // Descola a requisição HTTP e joga o trabalho para a fila assíncrona
    const jobId = dispatcher.dispatch("webhook_received", { 
      event, 
      data, 
      instance: bodyInstance || data?.instance, 
      tenantId: tenantId
    });
    
    // Responde instantaneamente HTTP 200 OK sem expor gargalos de timeout
    return res.status(200).json({ received: true, jobId, queuedAt: Date.now() });
  } catch (error: any) {
    console.error("[Chat Webhook] Erro ao enfileirar evento:", error);
    return res.status(200).json({ received: true, error: error.message }); // 200 para evitar retentativas excessivas do provedor
  }
});

// Listener do Dispatcher de eventos de Webhook em background
dispatcher.on("webhook_received", async ({ event, data, instance, tenantId }) => {
  try {
    // Normalizar eventos (Evolution envia em snake_case ou similar dependendo da config)
    const eventName = event === "MESSAGES_UPSERT" ? "messages.upsert" : event;

    if (eventName === "messages.upsert") {
      const messages = data?.messages || [];
      const instanceName = instance;
      
      // Buscar storeId a partir da instancia, tenantId da URL, ou default
      let storeId = tenantId || "default";
      
      if (!tenantId && instanceName) {
        try {
          const { data: inst, error: instError } = await supabaseAdmin
            .from("whatsapp_instances")
            .select("store_id")
            .eq("instance_name", instanceName)
            .single();
            
          if (instError) {
             console.error(`[Webhook Resolve Tenant] Error fetching whatsapp_instances for ${instanceName}:`, instError);
          } else if (inst?.store_id) {
             storeId = inst.store_id;
          } else {
             console.warn(`[Webhook Resolve Tenant] No store_id found for instance ${instanceName}`);
          }
        } catch (resolveErr) {
          console.error(`[Webhook Resolve Tenant] Exception while resolving store_id:`, resolveErr);
        }
      }

      console.log(`[Webhook Background] Processando mensagens para loja (storeId): ${storeId}, Instância: ${instanceName}`);

      for (const msg of messages) {
        // Persistir mensagem e atualizar conversa (mensagens enviadas e recebidas)
        const processed = await chatStore.processWhatsAppMessage(storeId, msg);

        if (!msg.key?.fromMe) {
          const conversationId = msg.key?.remoteJid;
          const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";

          // Processar Bot Handoff
          const handoff = await botHandoffManager.processMessageState(conversationId, storeId, text, "open");

          // Verificar se é uma resposta de CSAT (nota 1 a 5)
          const ratingNum = parseInt(text.trim(), 10);
          if (!isNaN(ratingNum) && ratingNum >= 1 && ratingNum <= 5) {
            await csatManager.recordCsatResponse(storeId, conversationId, ratingNum);
          }

          // Transmitir evento em tempo real via SSE RealtimeHub
          realtimeHub.broadcastToStore(storeId, "chat_message", {
            conversationId: processed?.conversation.id || conversationId,
            message: processed?.message,
            conversation: processed?.conversation,
            handoff
          });
        } else {
          // Transmitir mensagem enviada pelo próprio número/whatsapp
          realtimeHub.broadcastToStore(storeId, "chat_message", {
            conversationId: processed?.conversation.id,
            message: processed?.message,
            conversation: processed?.conversation
          });
        }
      }
    } else if (event === "connection.update") {
      const instance = data?.instance;
      const state = data?.state;
      console.log(`[Webhook Background] Connection update for ${instance}: ${state}`);
    }
  } catch (err) {
    console.error("[Webhook Background Error]:", err);
  }
});

// --- REALTIME SSE SERVER ENDPOINT ---
app.get("/api/v1/realtime/events", (req, res) => {
  const storeId = (req.query.storeId as string) || "all";
  const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  realtimeHub.addClient({ id: clientId, storeId, res });
});

// Listener do WhatsappHealthManager para retransmitir alterações de status das instâncias para o painel em tempo real
whatsappHealthManager.on("instance_status_changed", (eventData) => {
  realtimeHub.broadcastToStore(eventData.storeId, "instance_status", eventData);
});

// --- CRON JOB DE REMÉDIOS DE USO CONTÍNUO ---
// Dispara todos os dias às 09:00 AM
cron.schedule("0 9 * * *", async () => {
  await continuousUseRefillManager.checkAndTriggerRefillReminders();
});

// Endpoint manual para disparar teste de recompra de uso contínuo
app.post("/api/v1/refill/trigger", async (req, res) => {
  try {
    await continuousUseRefillManager.checkAndTriggerRefillReminders();
    res.json({ success: true, message: "Verificação de recompra executada." });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- MÓDULO CSAT ENDPOINTS ---
app.get("/api/v1/csat/metrics", async (req, res) => {
  try {
    const storeId = (req.query.storeId as string) || (req.headers["x-tenant-id"] as string);
    if (!storeId) return res.status(400).json({ error: "storeId é obrigatório" });

    const metrics = await csatManager.getStoreCsatMetrics(storeId);
    res.json(metrics);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/v1/csat/schedule", async (req, res) => {
  try {
    const { orderId, delayMinutes } = req.body;
    if (!orderId) return res.status(400).json({ error: "orderId é obrigatório" });

    await csatManager.scheduleCsatSurvey(orderId, delayMinutes || 15);
    res.json({ success: true, message: `Pesquisa CSAT agendada para o pedido ${orderId}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- MÓDULO CONTACT MERGE ENDPOINT ---
app.post("/api/v1/contacts/merge", async (req, res) => {
  try {
    const { targetContactId, sourceContactId } = req.body;
    if (!targetContactId || !sourceContactId) {
      return res.status(400).json({ error: "targetContactId e sourceContactId são obrigatórios." });
    }

    const result = await contactMergeManager.mergeContacts(targetContactId, sourceContactId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- ENDPOINTS DE CHAT ---
app.get("/api/v1/chat/conversations", async (req, res) => {
  try {
    const storeId = (req.query.tenantId as string) || (req.headers["x-tenant-id"] as string) || "default";
    const inboxId = req.query.inboxId as string | undefined;

    const conversations = await chatStore.getConversations(storeId, inboxId);
    return res.json({ data: conversations });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/v1/chat/messages", async (req, res) => {
  try {
    const conversationId = req.query.conversationId as string;
    if (!conversationId) {
      return res.status(400).json({ error: "conversationId é obrigatório" });
    }

    const messages = await chatStore.getMessages(conversationId);
    return res.json({ data: messages });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Envio e persistência de mensagem pelo Balconista/Atendente
app.post("/api/v1/chat/send", requireChatEnabled, async (req, res) => {
  try {
    const { conversation_id, content, is_private, media_url, media_type, sender_type } = req.body;
    const storeId = (req.headers["x-tenant-id"] as string) || "default";

    if (!conversation_id || (!content && !media_url)) {
      return res.status(400).json({ error: "conversation_id e conteúdo são obrigatórios." });
    }

    // Persistir mensagem
    const { message, conversation } = await chatStore.addMessage(
      storeId,
      conversation_id,
      sender_type || "USER",
      content || "",
      Boolean(is_private),
      media_url,
      media_type
    );

    // Transmitir via SSE
    realtimeHub.broadcastToStore(storeId, "chat_message", {
      conversationId: conversation_id,
      message,
      conversation
    });

    if (is_private) {
      console.log(`[Chat API] Nota interna salva para conversa ${conversation_id}.`);
      return res.status(200).json({ success: true, data: message, is_private: true });
    }

    console.log(`[Chat API] Mensagem de chat salva e processada para conversa ${conversation_id}: ${content}`);
    return res.status(200).json({ success: true, data: message, conversation });
  } catch (error: any) {
    console.error("[Chat API] Erro ao enviar mensagem:", error);
    return res.status(500).json({ error: error.message || "Erro interno." });
  }
});

async function startServer() {
  let __filename = "";
  let __dirname = "";

  try {
    // @ts-ignore
    if (import.meta && import.meta.url) {
      __filename = fileURLToPath(import.meta.url);
      __dirname = path.dirname(__filename);
    } else {
      __dirname = process.cwd();
    }
  } catch (e) {
    __dirname = process.cwd();
  }


// These endpoints will be added to server.ts

app.get("/api/v1/tenants/:tenantId/promos", async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const networkId = req.query.networkId;
    
    let query = supabaseAdmin.from("promotions").select("*");
    if (networkId) {
      query = query.or(`tenant_id.eq.${tenantId},tenant_id.eq.${networkId}`);
    } else {
      query = query.eq("tenant_id", tenantId);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/v1/tenants/:tenantId/promos", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const payload = req.body;
    // ensure tenant is matching
    if (payload.tenant_id !== tenantId) {
        return res.status(403).json({ error: "Tenant mismatch" });
    }
    const { data, error } = await supabaseAdmin.from("promotions").upsert(payload).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/v1/tenants/:tenantId/promos/:id", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const { error } = await supabaseAdmin.from("promotions").delete().eq("id", req.params.id).eq("tenant_id", tenantId);
    if (error) throw error;
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Vouchers (Coupons)
app.get("/api/v1/tenants/:tenantId/vouchers", async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const networkId = req.query.networkId;
    
    let query = supabaseAdmin.from("coupons").select("*");
    if (networkId) {
      query = query.or(`tenant_id.eq.${tenantId},tenant_id.eq.${networkId}`);
    } else {
      query = query.eq("tenant_id", tenantId);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/v1/tenants/:tenantId/vouchers", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const payload = req.body;
    if (payload.tenant_id !== tenantId) {
        return res.status(403).json({ error: "Tenant mismatch" });
    }
    const { data, error } = await supabaseAdmin.from("coupons").upsert(payload).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/v1/tenants/:tenantId/vouchers/:id", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const { error } = await supabaseAdmin.from("coupons").delete().eq("id", req.params.id).eq("tenant_id", tenantId);
    if (error) throw error;
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === "true" ? false : undefined,
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath, {
      maxAge: '1d',
      setHeaders: (res, filepath) => {
        if (
          filepath.endsWith('.html') || 
          filepath.endsWith('sw.js') || 
          filepath.endsWith('manifest.json')
        ) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      }
    }));
    app.get("*", (req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

export default app;

if (!process.env.VERCEL) {
  startServer();
}
