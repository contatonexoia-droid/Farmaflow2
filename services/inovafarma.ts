import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const INOVAFARMA_DEFAULT_API_URL = "https://guiaintegracao.portalps.app";
export const INOVAFARMA_MAX_LIMIT = 500;
export const INOVAFARMA_MIN_OFFSET = 1;
export const INOVAFARMA_MAX_DATE_WINDOW_DAYS = 31;

export interface InovafarmaRawProduct {
  ean?: string | number | null;
  codigoBarras?: string | number | null;
  codBarras?: string | number | null;
  codigo_barras?: string | number | null;
  gtin?: string | number | null;
  barcode?: string | number | null;
  ean13?: string | number | null;
  codigo?: string | number | null;
  codigoInterno?: string | number | null;
  codigo_interno?: string | number | null;
  codProduto?: string | number | null;
  idProduto?: string | number | null;
  id?: string | number | null;
  sku?: string | number | null;
  nome?: string | null;
  descricao?: string | null;
  nomeProduto?: string | null;
  descricaoProduto?: string | null;
  produto?: string | null;
  name?: string | null;
  title?: string | null;
  precoVenda?: number | string | null;
  preco_venda?: number | string | null;
  valorVenda?: number | string | null;
  preco?: number | string | null;
  valor?: number | string | null;
  price?: number | string | null;
  salePrice?: number | string | null;
  precoPromocional?: number | string | null;
  preco_promocional?: number | string | null;
  valorPromocao?: number | string | null;
  precoOferta?: number | string | null;
  promotionalPrice?: number | string | null;
  precoCusto?: number | string | null;
  preco_custo?: number | string | null;
  valorCusto?: number | string | null;
  custo?: number | string | null;
  costPrice?: number | string | null;
  estoque?: number | string | null;
  saldo?: number | string | null;
  saldoEstoque?: number | string | null;
  qtdEstoque?: number | string | null;
  quantidade?: number | string | null;
  estoqueAtual?: number | string | null;
  stock?: number | string | null;
  qty?: number | string | null;
  categoria?: string | null;
  departamento?: string | null;
  grupo?: string | null;
  secao?: string | null;
  category?: string | null;
  fabricante?: string | null;
  laboratorio?: string | null;
  marca?: string | null;
  principioAtivo?: string | null;
  principio_ativo?: string | null;
  substancia?: string | null;
  ativo?: boolean | number | string | null;
}

export interface NormalizedInovafarmaProduct {
  barcode: string;
  internalCode: string;
  name: string;
  price: number;
  promotionalPrice: number | null;
  costPrice: number | null;
  stock: number;
  category: string;
  manufacturer?: string;
  activeIngredient?: string;
}

export interface InovafarmaFuncionario {
  codigoFuncionario: string;
  cpf: string;
  nome: string;
  ativo?: boolean;
}

export interface InovafarmaSyncOptions {
  tenantId: string;
  apiToken?: string;
  apiLogin?: string;
  apiPassword?: string;
  erpUrl?: string;
  cnpj?: string;
  ignoreErpPrices?: boolean;
  /** Modo de sincronização: completo (/produtos) ou apenas alterados (/produtosalterados) */
  mode?: "full" | "delta";
  /** Data inicial (AAAA-MM-DD) obrigatória quando mode === 'delta' (/produtosalterados) */
  inicial?: string;
  /** Data final (AAAA-MM-DD) obrigatória quando mode === 'delta' (/produtosalterados) */
  final?: string;
  /** Offset inicial (padrão: 1) */
  offset?: number;
  /** Limite por página (máximo: 500) */
  limit?: number;
  /** Permite enviar uma lista de produtos diretamente caso o agente local / ponte envie via push */
  productsOverride?: InovafarmaRawProduct[];
}

export interface InovafarmaSyncResult {
  success: boolean;
  tenantId: string;
  endpointUsed: string;
  totalFetched: number;
  totalValid: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  ignoreErpPrices: boolean;
  syncedAt: string;
  message: string;
  error?: string;
}

export interface InovafarmaVendaItemInput {
  ean?: string | number;
  codigoProduto?: string | number;
  codigoInterno?: string | number;
  nome?: string;
  quantidade: number;
  precoUnitario: number;
  descontoUnitario?: number;
  descontoTotalItem?: number;
}

export interface InovafarmaVendaPagamentoInput {
  formaPagamento: string;
  valor: number;
  parcelas?: number;
  bandeira?: string;
  codigoAutorizacao?: string;
}

export interface InovafarmaVendaInput {
  pedidoId?: string;
  vendedor?: string | number;
  cliente?: {
    nome?: string;
    cpf?: string;
    telefone?: string;
    endereco?: {
      logradouro?: string;
      numero?: string;
      complemento?: string;
      bairro?: string;
      cidade?: string;
      uf?: string;
      cep?: string;
    };
  };
  itens: InovafarmaVendaItemInput[];
  /** Desconto global do pedido (será distribuído obrigatoriamente no campo descontoUnitario de cada item) */
  descontoGlobal?: number;
  taxaEntrega?: number;
  pagamentos?: InovafarmaVendaPagamentoInput[];
  formaPagamentoPadrao?: string;
  observacao?: string;
}

export interface InovafarmaVendaItemPayload {
  codigoBarras?: string;
  ean?: string;
  codigoProduto?: string;
  quantidade: number;
  precoUnitario: number;
  descontoUnitario: number;
  valorLiquidoUnitario: number;
  subtotalLiquido: number;
}

export interface InovafarmaVendaPayload {
  numeroPedido?: string;
  vendedor: string;
  dataHora: string;
  taxaEntrega: number;
  cliente?: {
    nome: string;
    cpf: string;
    telefone: string;
    endereco?: {
      logradouro: string;
      numero: string;
      complemento?: string;
      bairro: string;
      cidade: string;
      uf?: string;
      cep?: string;
    };
  };
  itens: InovafarmaVendaItemPayload[];
  pagamentos: Array<{
    formaPagamento: string;
    valor: number;
    parcelas: number;
  }>;
  valorTotalItens: number;
  valorTotalVenda: number;
  observacao?: string;
}

export function roundCurrency(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Higieniza o CNPJ deixando apenas os 14 dígitos numéricos
 */
export function sanitizeCnpj(rawCnpj: unknown): string {
  if (!rawCnpj) return "";
  return String(rawCnpj).replace(/\D+/g, "").trim();
}

/**
 * Higieniza CPF deixando apenas os 11 dígitos numéricos
 */
export function sanitizeCpf(rawCpf: unknown): string {
  if (!rawCpf) return "";
  return String(rawCpf).replace(/\D+/g, "").trim();
}

/**
 * Constrói e valida os headers obrigatórios para todas as requisições à API do Inovafarma (Portal PS):
 * - Authorization: Bearer <token>
 * - cnpj: <cnpj da farmácia>
 */
export function buildInovafarmaHeaders(
  token: string,
  cnpj: string,
): Record<string, string> {
  const cleanToken = (token || "").trim();
  if (!cleanToken) {
    throw new Error(
      "Header 'Authorization' (Bearer Token) é obrigatório para comunicar com a API do Inovafarma. Configure o Login/Senha da API ou o Token de Integração da farmácia.",
    );
  }

  const cleanCnpj = sanitizeCnpj(cnpj);
  if (!cleanCnpj || cleanCnpj.length < 11) {
    throw new Error(
      "Header 'cnpj' é obrigatório em todas as requisições para a API do Inovafarma. Cadastre um CNPJ válido nas configurações da farmácia.",
    );
  }

  const bearerValue = cleanToken.toLowerCase().startsWith("bearer ")
    ? cleanToken
    : `Bearer ${cleanToken}`;
  const rawTokenValue = cleanToken.replace(/^Bearer\s+/i, "").trim();

  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: bearerValue,
    cnpj: cleanCnpj,
    "x-cnpj": cleanCnpj,
    "x-api-key": rawTokenValue,
  };
}

const ERP_PASSWORD_ENC_PREFIX = "enc:v1:";

function getErpEncryptionSecret(): Buffer {
  const rawSecret =
    (typeof process !== "undefined" &&
      (process.env.ERP_CREDENTIALS_SECRET ||
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_ANON_KEY)) ||
    "farmaflow-inovafarma-tenant-secret-key-2026";
  return crypto.createHash("sha256").update(String(rawSecret)).digest();
}

/**
 * Verifica se o valor enviado de senha é apenas uma máscara visual (ex: "********" ou "••••••••")
 */
export function isMaskedErpPassword(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  const str = String(raw).trim();
  if (!str) return true;
  if (/^[*•]+$/.test(str)) return true;
  if (str.includes("...") && str.length <= 20) return true;
  return false;
}

/**
 * Criptografa a senha da API do Inovafarma em repouso (AES-256-GCM) vinculada ao tenant_id
 */
export function encryptErpPassword(plainPassword: string, tenantId = ""): string {
  const clean = String(plainPassword ?? "");
  if (!clean || isMaskedErpPassword(clean)) return "";
  if (clean.startsWith(ERP_PASSWORD_ENC_PREFIX)) return clean;

  try {
    const key = getErpEncryptionSecret();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    if (tenantId) {
      cipher.setAAD(Buffer.from(String(tenantId), "utf8"));
    }
    const encrypted = Buffer.concat([cipher.update(clean, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${ERP_PASSWORD_ENC_PREFIX}${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
  } catch {
    return clean;
  }
}

/**
 * Descriptografa a senha da API do Inovafarma exclusivamente no backend para autenticar em POST /api/login
 */
export function decryptErpPassword(storedValue: string, tenantId = ""): string {
  const raw = String(storedValue ?? "").trim();
  if (!raw || isMaskedErpPassword(raw)) return "";
  if (!raw.startsWith(ERP_PASSWORD_ENC_PREFIX)) {
    return raw;
  }

  const payload = raw.slice(ERP_PASSWORD_ENC_PREFIX.length);
  const parts = payload.split(":");
  if (parts.length !== 3) return "";

  const [ivB64, tagB64, dataB64] = parts;
  const tryDecrypt = (aadTenantId: string): string | null => {
    try {
      const key = getErpEncryptionSecret();
      const iv = Buffer.from(ivB64, "base64");
      const authTag = Buffer.from(tagB64, "base64");
      const encrypted = Buffer.from(dataB64, "base64");
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      if (aadTenantId) {
        decipher.setAAD(Buffer.from(String(aadTenantId), "utf8"));
      }
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return decrypted.toString("utf8");
    } catch {
      return null;
    }
  };

  if (tenantId) {
    const withAad = tryDecrypt(tenantId);
    if (withAad !== null) return withAad;
  }
  return tryDecrypt("") || "";
}

/**
 * Extrai o Login da API do Inovafarma salvo no registro da farmácia (tenants)
 */
export function extractTenantErpLogin(tenant: any): string {
  if (!tenant || typeof tenant !== "object") return "";
  const fromColumn =
    tenant.erp_api_login ??
    tenant.erpApiLogin ??
    tenant.erpapilogin ??
    tenant.inovafarma_login ??
    "";
  if (fromColumn && String(fromColumn).trim()) {
    return String(fromColumn).trim();
  }
  const fromCreds =
    tenant.smart_banners?._erpCredentials?.erp_api_login ??
    tenant.smart_banners?._erpCredentials?.login ??
    tenant.delivery_settings?._erpCredentials?.erp_api_login ??
    "";
  return String(fromCreds || "").trim();
}

/**
 * Extrai e descriptografa a Senha da API do Inovafarma salva no registro da farmácia (apenas uso interno no servidor)
 */
export function extractTenantErpPassword(tenant: any): string {
  if (!tenant || typeof tenant !== "object") return "";
  const tenantId = String(tenant.id || "");
  const rawStored =
    tenant.erp_api_password ||
    tenant.erpApiPassword ||
    tenant.smart_banners?._erpCredentials?.erp_api_password_enc ||
    tenant.smart_banners?._erpCredentials?.erp_api_password ||
    tenant.delivery_settings?._erpCredentials?.erp_api_password_enc ||
    tenant.delivery_settings?._erpCredentials?.erp_api_password ||
    "";
  if (!rawStored || isMaskedErpPassword(rawStored)) return "";
  return decryptErpPassword(String(rawStored), tenantId);
}

/**
 * Verifica se a farmácia possui uma senha da API configurada no banco
 */
export function hasTenantErpPassword(tenant: any): boolean {
  if (!tenant || typeof tenant !== "object") return false;
  if (tenant.has_erp_api_password === true || tenant.hasErpApiPassword === true) {
    return true;
  }
  const rawStored =
    tenant.erp_api_password ||
    tenant.erpApiPassword ||
    tenant.smart_banners?._erpCredentials?.erp_api_password_enc ||
    tenant.smart_banners?._erpCredentials?.erp_api_password ||
    tenant.delivery_settings?._erpCredentials?.erp_api_password_enc ||
    "";
  return Boolean(rawStored && !isMaskedErpPassword(rawStored));
}

/**
 * Higieniza o objeto da farmácia antes de enviá-lo ao frontend:
 * - Garante que a senha da API NUNCA seja retornada em texto plano para o cliente
 * - Preenche `erp_api_login` e a flag booleana `has_erp_api_password`
 */
export function sanitizeTenantErpCredentialsForClient<T extends Record<string, any>>(
  tenant: T,
): T {
  if (!tenant || typeof tenant !== "object") return tenant;
  const copy: any = { ...tenant };
  const login = extractTenantErpLogin(tenant);
  const hasPassword = hasTenantErpPassword(tenant);

  copy.erp_api_login = login;
  copy.erpApiLogin = login;
  copy.has_erp_api_password = hasPassword;
  copy.hasErpApiPassword = hasPassword;

  // Nunca retorna a senha em texto plano ou o hash criptografado para o frontend
  delete copy.erp_api_password;
  delete copy.erpApiPassword;

  if (copy.smart_banners && typeof copy.smart_banners === "object") {
    copy.smart_banners = { ...copy.smart_banners };
    if (
      copy.smart_banners._erpCredentials &&
      typeof copy.smart_banners._erpCredentials === "object"
    ) {
      copy.smart_banners._erpCredentials = {
        erp_api_login: login,
        has_erp_api_password: hasPassword,
      };
    }
  }

  return copy;
}

/**
 * Autentica na API do Inovafarma (`POST /api/login`) buscando dinamicamente o login e a senha
 * salvos no cadastro da farmácia específica (`tenant_id`) para gerar o `accessToken`.
 */
export async function authenticateInovafarma(params: {
  supabaseClient?: SupabaseClient;
  tenantId?: string;
  baseUrl?: string;
  cnpj?: string;
  login?: string;
  password?: string;
}): Promise<{
  accessToken: string;
  endpointUsed: string;
}> {
  let effectiveLogin = (params.login || "").trim();
  let effectivePassword =
    params.password && !isMaskedErpPassword(params.password)
      ? String(params.password).trim()
      : "";
  let effectiveBaseUrl = (params.baseUrl || "").trim();
  let effectiveCnpj = sanitizeCnpj(params.cnpj || "");

  // Busca dinamicamente o login e a senha salvos no cadastro daquela farmácia específica no Supabase
  if (params.supabaseClient && params.tenantId) {
    const { data: tenantRow, error: tenantErr } = await params.supabaseClient
      .from("tenants")
      .select("*")
      .eq("id", params.tenantId)
      .maybeSingle();

    if (tenantErr) {
      throw new Error(
        `Erro ao consultar credenciais da farmácia (${params.tenantId}): ${tenantErr.message}`,
      );
    }

    if (tenantRow) {
      if (!effectiveLogin) {
        effectiveLogin = extractTenantErpLogin(tenantRow);
      }
      if (!effectivePassword) {
        effectivePassword = extractTenantErpPassword(tenantRow);
      }
      if (!effectiveBaseUrl) {
        effectiveBaseUrl = String(tenantRow.erp_url || INOVAFARMA_DEFAULT_API_URL).trim();
      }
      if (!effectiveCnpj) {
        effectiveCnpj = sanitizeCnpj(
          tenantRow.cnpj || tenantRow.smart_banners?._regulatoryData?.cnpj || "",
        );
      }
    }
  }

  if (!effectiveLogin || !effectivePassword) {
    throw new Error(
      "Credenciais de Login da API e Senha da API não encontradas para esta farmácia. Configure o 'Login da API' e a 'Senha da API' no painel da drogaria.",
    );
  }

  const rawBase = (effectiveBaseUrl || INOVAFARMA_DEFAULT_API_URL).trim();
  const cleanBase = rawBase.replace(/\/+$/, "");

  const candidateUrls: string[] = [];
  try {
    const parsed = new URL(cleanBase);
    const origin = parsed.origin;
    const basePath =
      parsed.pathname && parsed.pathname !== "/" ? parsed.pathname.replace(/\/+$/, "") : "";
    const loginPaths = ["/api/login", "/login", "/v1/login", "/api/v1/login"];

    for (const p of loginPaths) {
      if (basePath && !basePath.toLowerCase().endsWith(p.toLowerCase())) {
        candidateUrls.push(`${origin}${basePath}${p}`);
      }
      const rootUrl = `${origin}${p}`;
      if (!candidateUrls.includes(rootUrl)) {
        candidateUrls.push(rootUrl);
      }
    }
  } catch {
    candidateUrls.push(`${INOVAFARMA_DEFAULT_API_URL}/api/login`);
    candidateUrls.push(`${INOVAFARMA_DEFAULT_API_URL}/login`);
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(effectiveCnpj
      ? {
          cnpj: effectiveCnpj,
          "x-cnpj": effectiveCnpj,
        }
      : {}),
  };

  const payloadVariants = [
    {
      login: effectiveLogin,
      senha: effectivePassword,
      ...(effectiveCnpj ? { cnpj: effectiveCnpj } : {}),
    },
    {
      usuario: effectiveLogin,
      senha: effectivePassword,
      login: effectiveLogin,
      password: effectivePassword,
      ...(effectiveCnpj ? { cnpj: effectiveCnpj } : {}),
    },
  ];

  const errors: string[] = [];

  for (const endpoint of candidateUrls) {
    for (const bodyPayload of payloadVariants) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(bodyPayload),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const contentType = response.headers.get("content-type") || "";
        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          errors.push(
            `${endpoint} -> HTTP ${response.status}${errText ? ` (${errText.slice(0, 120)})` : ""}`,
          );
          if (response.status === 401 || response.status === 403) {
            break;
          }
          continue;
        }

        if (contentType.includes("text/html")) {
          errors.push(`${endpoint} -> Retornou HTML em vez de JSON de autenticação`);
          break;
        }

        const data = await response.json().catch(() => null);
        const extractedToken =
          data?.accessToken ||
          data?.access_token ||
          data?.token ||
          data?.bearer ||
          data?.jwt ||
          data?.data?.accessToken ||
          data?.data?.access_token ||
          data?.data?.token ||
          (typeof data === "string" && data.trim().length > 10 ? data.trim() : "");

        if (extractedToken && String(extractedToken).trim()) {
          return {
            accessToken: String(extractedToken).replace(/^Bearer\s+/i, "").trim(),
            endpointUsed: endpoint,
          };
        }

        errors.push(`${endpoint} -> Resposta 200 sem campo accessToken/token`);
      } catch (err: any) {
        errors.push(`${endpoint} -> ${err?.message || "Erro de conexão"}`);
        break;
      }
    }
  }

  throw new Error(
    `Falha ao autenticar no Inovafarma (POST /api/login) para gerar o accessToken. Verifique o Login da API e a Senha da API cadastrados. Detalhes: ${errors.slice(0, 2).join(" | ")}`,
  );
}

/**
 * Resolve dinamicamente as credenciais e gera o `accessToken` via `POST /api/login` para uma farmácia específica (`tenantId`),
 * utilizando o login e a senha salvos no banco (com fallback para `integration_token` caso Login/Senha não estejam preenchidos).
 */
export async function resolveTenantInovafarmaToken(params: {
  supabaseClient: SupabaseClient;
  tenantId: string;
  baseUrlOverride?: string;
  cnpjOverride?: string;
  tokenOverride?: string;
  loginOverride?: string;
  passwordOverride?: string;
}): Promise<{
  token: string;
  cnpj: string;
  baseUrl: string;
  authMethod: "api_login" | "integration_token";
  tenant: any;
}> {
  const { data: tenant, error: tenantError } = await params.supabaseClient
    .from("tenants")
    .select("*")
    .eq("id", params.tenantId)
    .maybeSingle();

  if (tenantError || !tenant) {
    throw new Error(
      `Farmácia não encontrada no banco de dados (${tenantError?.message || params.tenantId}).`,
    );
  }

  const baseUrl = (
    params.baseUrlOverride ||
    tenant.erp_url ||
    INOVAFARMA_DEFAULT_API_URL
  ).trim();
  const cnpj = sanitizeCnpj(
    params.cnpjOverride ||
      tenant.cnpj ||
      tenant.smart_banners?._regulatoryData?.cnpj ||
      "",
  );

  const loginToUse = (params.loginOverride || extractTenantErpLogin(tenant)).trim();
  const passwordToUse =
    params.passwordOverride && !isMaskedErpPassword(params.passwordOverride)
      ? String(params.passwordOverride).trim()
      : extractTenantErpPassword(tenant);

  if (loginToUse && passwordToUse) {
    const authResult = await authenticateInovafarma({
      supabaseClient: params.supabaseClient,
      tenantId: params.tenantId,
      baseUrl,
      cnpj,
      login: loginToUse,
      password: passwordToUse,
    });
    return {
      token: authResult.accessToken,
      cnpj,
      baseUrl,
      authMethod: "api_login",
      tenant,
    };
  }

  const fallbackToken = (params.tokenOverride || tenant.integration_token || "").trim();
  return {
    token: fallbackToken,
    cnpj,
    baseUrl,
    authMethod: "integration_token",
    tenant,
  };
}

/**
 * Normaliza e valida os parâmetros de paginação do Inovafarma:
 * - offset: começa obrigatoriamente em 1 (mínimo 1)
 * - limit: máximo de 500 (entre 1 e 500)
 */
export function normalizeInovafarmaPagination(
  offset?: number | string,
  limit?: number | string,
): { offset: number; limit: number } {
  const parsedOffset = Number(offset);
  const parsedLimit = Number(limit);

  const safeOffset =
    Number.isFinite(parsedOffset) && parsedOffset >= INOVAFARMA_MIN_OFFSET
      ? Math.floor(parsedOffset)
      : INOVAFARMA_MIN_OFFSET;

  const safeLimit =
    Number.isFinite(parsedLimit) && parsedLimit >= 1
      ? Math.min(Math.floor(parsedLimit), INOVAFARMA_MAX_LIMIT)
      : INOVAFARMA_MAX_LIMIT;

  return { offset: safeOffset, limit: safeLimit };
}

/**
 * Valida o par de datas obrigatório `inicial` e `final` para `/produtosalterados` e `/clientesalterados`:
 * - Formato estrito AAAA-MM-DD
 * - `inicial` <= `final`
 * - Janela máxima de 31 dias
 */
export function validateInovafarmaDateRange(
  inicial?: string,
  final?: string,
): { inicial: string; final: string; diffDays: number } {
  const startStr = (inicial || "").trim();
  const endStr = (final || "").trim();

  if (!startStr || !endStr) {
    throw new Error(
      "Os parâmetros de data 'inicial' e 'final' (formato AAAA-MM-DD) são obrigatórios nas rotas /produtosalterados e /clientesalterados.",
    );
  }

  const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDateRegex.test(startStr) || !isoDateRegex.test(endStr)) {
    throw new Error(
      `Formato de data inválido (recebido inicial='${startStr}', final='${endStr}'). Utilize obrigatoriamente o formato AAAA-MM-DD.`,
    );
  }

  const startDate = new Date(`${startStr}T00:00:00Z`);
  const endDate = new Date(`${endStr}T00:00:00Z`);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error(
      "Datas 'inicial' ou 'final' inválidas. Verifique o calendário no formato AAAA-MM-DD.",
    );
  }

  if (startDate.getTime() > endDate.getTime()) {
    throw new Error(
      `A data 'inicial' (${startStr}) não pode ser posterior à data 'final' (${endStr}).`,
    );
  }

  const diffMs = endDate.getTime() - startDate.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays > INOVAFARMA_MAX_DATE_WINDOW_DAYS) {
    throw new Error(
      `A janela entre 'inicial' (${startStr}) e 'final' (${endStr}) é de ${diffDays} dias, excedendo o limite máximo de ${INOVAFARMA_MAX_DATE_WINDOW_DAYS} dias permitido pelo Inovafarma.`,
    );
  }

  return { inicial: startStr, final: endStr, diffDays };
}

/**
 * Higieniza códigos EAN/GTIN vindos do Inovafarma / PDV ou planilhas:
 * - Converte notação científica (ex: 7.896094e+12) para string numérica exata
 * - Remove pontos decimais finais (.0) e quaisquer caracteres não numéricos
 */
export function sanitizeInovafarmaEan(raw: unknown): string {
  if (raw === null || raw === undefined) return "";

  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return "";
    return Math.round(raw).toLocaleString("fullwide", { useGrouping: false });
  }

  let str = String(raw).trim();
  if (!str) return "";

  const normalizedNumStr = str.replace(",", ".");
  if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(normalizedNumStr)) {
    const parsed = Number(normalizedNumStr);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed).toLocaleString("fullwide", { useGrouping: false });
    }
  }

  if (/^\d+\.0+$/.test(normalizedNumStr)) {
    str = normalizedNumStr.split(".")[0];
  }

  const digitsOnly = str.replace(/\D+/g, "");
  if (!digitsOnly || /^0+$/.test(digitsOnly)) return "";
  return digitsOnly;
}

/**
 * Converte valores monetários ou de estoque vindos da API do Inovafarma (number ou string pt-BR)
 */
export function parseInovafarmaNumber(raw: unknown, fallback = 0): number {
  if (raw === null || raw === undefined || raw === "") return fallback;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : fallback;
  }
  const str = String(raw).trim();
  if (!str) return fallback;

  if (str.includes(",") && str.includes(".")) {
    const cleaned = str.replace(/\./g, "").replace(",", ".");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  if (str.includes(",")) {
    const parsed = Number(str.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  const parsed = Number(str);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Normaliza um item bruto retornado pela API do Inovafarma (Portal PS)
 */
export function normalizeInovafarmaProduct(
  raw: InovafarmaRawProduct,
): NormalizedInovafarmaProduct | null {
  if (!raw || typeof raw !== "object") return null;

  const rawEan =
    raw.ean ??
    raw.codigoBarras ??
    raw.codBarras ??
    raw.codigo_barras ??
    raw.gtin ??
    raw.barcode ??
    raw.ean13 ??
    "";

  const rawInternal =
    raw.codigoInterno ??
    raw.codigo_interno ??
    raw.codigo ??
    raw.codProduto ??
    raw.idProduto ??
    raw.sku ??
    raw.id ??
    "";

  const barcode = sanitizeInovafarmaEan(rawEan);
  const internalCode = String(rawInternal ?? "").trim() || barcode;

  const rawName =
    raw.nome ??
    raw.descricao ??
    raw.nomeProduto ??
    raw.descricaoProduto ??
    raw.produto ??
    raw.name ??
    raw.title ??
    "";

  const name = String(rawName ?? "").trim();

  if (!barcode && !internalCode) {
    return null;
  }

  const finalName = name || `Produto (${barcode || internalCode})`;

  const rawPrice =
    raw.precoVenda ??
    raw.preco_venda ??
    raw.valorVenda ??
    raw.preco ??
    raw.valor ??
    raw.price ??
    raw.salePrice;

  const rawPromo =
    raw.precoPromocional ??
    raw.preco_promocional ??
    raw.valorPromocao ??
    raw.precoOferta ??
    raw.promotionalPrice;

  const rawCost =
    raw.precoCusto ??
    raw.preco_custo ??
    raw.valorCusto ??
    raw.custo ??
    raw.costPrice;

  const rawStock =
    raw.estoque ??
    raw.saldo ??
    raw.saldoEstoque ??
    raw.qtdEstoque ??
    raw.quantidade ??
    raw.estoqueAtual ??
    raw.stock ??
    raw.qty;

  let price = Math.max(0, roundCurrency(parseInovafarmaNumber(rawPrice, 0)));
  const costPriceVal = parseInovafarmaNumber(rawCost, -1);
  const costPrice = costPriceVal >= 0 ? roundCurrency(costPriceVal) : null;

  if (price === 0 && costPrice !== null && costPrice > 0) {
    price = roundCurrency(costPrice * 1.5);
  }

  const promoVal = parseInovafarmaNumber(rawPromo, -1);
  const promotionalPrice =
    promoVal > 0 && (price === 0 || promoVal < price)
      ? roundCurrency(promoVal)
      : null;

  const stock = Math.max(0, Math.floor(parseInovafarmaNumber(rawStock, 0)));

  const category =
    String(
      raw.categoria ??
        raw.departamento ??
        raw.grupo ??
        raw.secao ??
        raw.category ??
        "Geral",
    ).trim() || "Geral";

  const manufacturer = String(
    raw.fabricante ?? raw.laboratorio ?? raw.marca ?? "",
  ).trim();

  const activeIngredient = String(
    raw.principioAtivo ?? raw.principio_ativo ?? raw.substancia ?? "",
  ).trim();

  return {
    barcode: barcode || internalCode,
    internalCode: internalCode || barcode,
    name: finalName,
    price,
    promotionalPrice,
    costPrice,
    stock,
    category,
    manufacturer: manufacturer || undefined,
    activeIngredient: activeIngredient || undefined,
  };
}

/**
 * Extrai um array de registros de qualquer envelope JSON retornado pelo Inovafarma / Portal PS
 */
function extractArrayFromInovafarmaResponse<T = any>(payload: any): T[] | null {
  if (!payload) return null;
  if (Array.isArray(payload)) return payload;
  if (typeof payload === "object") {
    const candidateKeys = [
      "produtos",
      "products",
      "clientes",
      "funcionarios",
      "vendedores",
      "data",
      "items",
      "itens",
      "results",
      "result",
      "content",
      "registros",
      "lista",
    ];
    for (const key of candidateKeys) {
      if (Array.isArray(payload[key])) {
        return payload[key];
      }
      if (
        payload[key] &&
        typeof payload[key] === "object" &&
        Array.isArray(
          payload[key].items ||
            payload[key].produtos ||
            payload[key].clientes ||
            payload[key].funcionarios ||
            payload[key].data,
        )
      ) {
        return (
          payload[key].items ||
          payload[key].produtos ||
          payload[key].clientes ||
          payload[key].funcionarios ||
          payload[key].data
        );
      }
    }
  }
  return null;
}

/**
 * Monta URL com query params explícitos (offset começando em 1, limit <= 500 e datas se aplicável)
 */
function buildUrlWithQueryParams(
  baseEndpoint: string,
  queryParams: Record<string, string | number | undefined>,
): string {
  const url = new URL(baseEndpoint);
  for (const [key, val] of Object.entries(queryParams)) {
    if (val !== undefined && val !== null && String(val) !== "") {
      url.searchParams.set(key, String(val));
    }
  }
  return url.toString();
}

/**
 * Executa requisição GET autenticada (Authorization Bearer + cnpj) nos endpoints candidatos do Inovafarma
 */
async function performInovafarmaGet<T = any>(params: {
  baseUrl?: string;
  token: string;
  cnpj: string;
  paths: string[];
  queryParams: Record<string, string | number | undefined>;
}): Promise<{ items: T[]; endpointUsed: string }> {
  const headers = buildInovafarmaHeaders(params.token, params.cnpj);
  const rawBase = (params.baseUrl || INOVAFARMA_DEFAULT_API_URL).trim();
  const cleanBase = rawBase.replace(/\/+$/, "");

  const candidateBaseUrls: string[] = [];
  try {
    const parsed = new URL(cleanBase);
    const origin = parsed.origin;
    const basePath =
      parsed.pathname && parsed.pathname !== "/" ? parsed.pathname.replace(/\/+$/, "") : "";

    for (const p of params.paths) {
      const normalizedPath = p.startsWith("/") ? p : `/${p}`;
      if (basePath && !basePath.endsWith(normalizedPath)) {
        candidateBaseUrls.push(`${origin}${basePath}${normalizedPath}`);
      }
      const rootUrl = `${origin}${normalizedPath}`;
      if (!candidateBaseUrls.includes(rootUrl)) {
        candidateBaseUrls.push(rootUrl);
      }
    }
  } catch {
    for (const p of params.paths) {
      const normalizedPath = p.startsWith("/") ? p : `/${p}`;
      candidateBaseUrls.push(`${INOVAFARMA_DEFAULT_API_URL}${normalizedPath}`);
    }
  }

  const errors: string[] = [];

  for (const baseEndpoint of candidateBaseUrls) {
    const fullUrl = buildUrlWithQueryParams(baseEndpoint, params.queryParams);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);

      const response = await fetch(fullUrl, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const contentType = response.headers.get("content-type") || "";
      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        errors.push(
          `${fullUrl} -> HTTP ${response.status}${errText ? ` (${errText.slice(0, 120)})` : ""}`,
        );
        continue;
      }

      if (contentType.includes("text/html")) {
        errors.push(`${fullUrl} -> Retornou página HTML de documentação em vez de JSON da API`);
        continue;
      }

      const data = await response.json();
      const extracted = extractArrayFromInovafarmaResponse<T>(data);
      if (extracted) {
        return { items: extracted, endpointUsed: fullUrl };
      } else {
        errors.push(`${fullUrl} -> JSON recebido não contém lista válida`);
      }
    } catch (err: any) {
      errors.push(`${fullUrl} -> ${err?.message || "Falha de conexão"}`);
    }
  }

  throw new Error(
    `Não foi possível consultar a API do Inovafarma (Portal PS). Verifique se a URL da API, o CNPJ (${sanitizeCnpj(params.cnpj)}) e o Token Bearer estão ativos. Detalhes: ${errors.slice(0, 3).join(" | ")}`,
  );
}

/**
 * Busca produtos paginados (`GET /produtos`) enviando obrigatoriamente:
 * - Headers: `Authorization: Bearer <token>` e `cnpj`
 * - Query: `offset` (começando em 1) e `limit` (máx. 500)
 */
export async function fetchInovafarmaProducts(params: {
  baseUrl?: string;
  token: string;
  cnpj: string;
  offset?: number;
  limit?: number;
  fetchAllPages?: boolean;
}): Promise<{ products: InovafarmaRawProduct[]; endpointUsed: string }> {
  const { offset: initialOffset, limit } = normalizeInovafarmaPagination(
    params.offset,
    params.limit,
  );
  const fetchAll = params.fetchAllPages !== false && params.offset === undefined;

  const allProducts: InovafarmaRawProduct[] = [];
  let currentOffset = initialOffset;
  let lastEndpointUsed = "";
  const seenKeys = new Set<string>();
  const MAX_PAGES = 40; // Até 20.000 itens com limit=500

  for (let page = 0; page < MAX_PAGES; page++) {
    const { items, endpointUsed } = await performInovafarmaGet<InovafarmaRawProduct>({
      baseUrl: params.baseUrl,
      token: params.token,
      cnpj: params.cnpj,
      paths: ["/produtos", "/api/produtos", "/v1/produtos", "/api/v1/produtos"],
      queryParams: {
        offset: currentOffset,
        limit,
      },
    });

    lastEndpointUsed = endpointUsed;
    if (!items || items.length === 0) break;

    let newItemsInPage = 0;
    for (const item of items) {
      const key =
        sanitizeInovafarmaEan(
          item.ean ?? item.codigoBarras ?? item.codBarras ?? item.barcode,
        ) ||
        String(item.codigo ?? item.codigoInterno ?? item.id ?? JSON.stringify(item));
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        newItemsInPage++;
      }
      allProducts.push(item);
    }

    if (!fetchAll || items.length < limit || newItemsInPage === 0) {
      break;
    }

    currentOffset += limit;
  }

  return { products: allProducts, endpointUsed: lastEndpointUsed };
}

/**
 * Busca produtos alterados (`GET /produtosalterados`) exigindo:
 * - Headers: `Authorization: Bearer <token>` e `cnpj`
 * - Query: `inicial` (AAAA-MM-DD), `final` (AAAA-MM-DD, janela máx 31 dias), `offset` (>= 1) e `limit` (<= 500)
 */
export async function fetchInovafarmaProdutosAlterados(params: {
  baseUrl?: string;
  token: string;
  cnpj: string;
  inicial: string;
  final: string;
  offset?: number;
  limit?: number;
  fetchAllPages?: boolean;
}): Promise<{ products: InovafarmaRawProduct[]; endpointUsed: string }> {
  const { inicial, final } = validateInovafarmaDateRange(params.inicial, params.final);
  const { offset: initialOffset, limit } = normalizeInovafarmaPagination(
    params.offset,
    params.limit,
  );
  const fetchAll = params.fetchAllPages !== false && params.offset === undefined;

  const allProducts: InovafarmaRawProduct[] = [];
  let currentOffset = initialOffset;
  let lastEndpointUsed = "";
  const seenKeys = new Set<string>();
  const MAX_PAGES = 40;

  for (let page = 0; page < MAX_PAGES; page++) {
    const { items, endpointUsed } = await performInovafarmaGet<InovafarmaRawProduct>({
      baseUrl: params.baseUrl,
      token: params.token,
      cnpj: params.cnpj,
      paths: [
        "/produtosalterados",
        "/api/produtosalterados",
        "/v1/produtosalterados",
      ],
      queryParams: {
        inicial,
        final,
        offset: currentOffset,
        limit,
      },
    });

    lastEndpointUsed = endpointUsed;
    if (!items || items.length === 0) break;

    let newItemsInPage = 0;
    for (const item of items) {
      const key =
        sanitizeInovafarmaEan(
          item.ean ?? item.codigoBarras ?? item.codBarras ?? item.barcode,
        ) ||
        String(item.codigo ?? item.codigoInterno ?? item.id ?? JSON.stringify(item));
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        newItemsInPage++;
      }
      allProducts.push(item);
    }

    if (!fetchAll || items.length < limit || newItemsInPage === 0) {
      break;
    }

    currentOffset += limit;
  }

  return { products: allProducts, endpointUsed: lastEndpointUsed };
}

/**
 * Busca clientes (`GET /clientes`) enviando obrigatoriamente:
 * - Headers: `Authorization: Bearer <token>` e `cnpj`
 * - Query: `offset` (começando em 1) e `limit` (máx. 500)
 */
export async function fetchInovafarmaClientes(params: {
  baseUrl?: string;
  token: string;
  cnpj: string;
  offset?: number;
  limit?: number;
}): Promise<{ clientes: any[]; endpointUsed: string }> {
  const { offset, limit } = normalizeInovafarmaPagination(params.offset, params.limit);
  const { items, endpointUsed } = await performInovafarmaGet<any>({
    baseUrl: params.baseUrl,
    token: params.token,
    cnpj: params.cnpj,
    paths: ["/clientes", "/api/clientes", "/v1/clientes"],
    queryParams: { offset, limit },
  });
  return { clientes: items, endpointUsed };
}

/**
 * Busca clientes alterados (`GET /clientesalterados`) exigindo:
 * - Headers: `Authorization: Bearer <token>` e `cnpj`
 * - Query: `inicial` (AAAA-MM-DD), `final` (AAAA-MM-DD, janela máx 31 dias), `offset` (>= 1) e `limit` (<= 500)
 */
export async function fetchInovafarmaClientesAlterados(params: {
  baseUrl?: string;
  token: string;
  cnpj: string;
  inicial: string;
  final: string;
  offset?: number;
  limit?: number;
}): Promise<{ clientes: any[]; endpointUsed: string }> {
  const { inicial, final } = validateInovafarmaDateRange(params.inicial, params.final);
  const { offset, limit } = normalizeInovafarmaPagination(params.offset, params.limit);
  const { items, endpointUsed } = await performInovafarmaGet<any>({
    baseUrl: params.baseUrl,
    token: params.token,
    cnpj: params.cnpj,
    paths: ["/clientesalterados", "/api/clientesalterados", "/v1/clientesalterados"],
    queryParams: { inicial, final, offset, limit },
  });
  return { clientes: items, endpointUsed };
}

/**
 * Busca funcionários/vendedores (`GET /funcionarios`) para mapear CPF ou CODIGOFUNCIONARIO
 * - Headers: `Authorization: Bearer <token>` e `cnpj`
 * - Query: `offset` (começando em 1) e `limit` (máx. 500)
 */
export async function fetchInovafarmaFuncionarios(params: {
  baseUrl?: string;
  token: string;
  cnpj: string;
  offset?: number;
  limit?: number;
}): Promise<{ funcionarios: InovafarmaFuncionario[]; endpointUsed: string }> {
  const { offset, limit } = normalizeInovafarmaPagination(params.offset, params.limit);
  const { items, endpointUsed } = await performInovafarmaGet<any>({
    baseUrl: params.baseUrl,
    token: params.token,
    cnpj: params.cnpj,
    paths: ["/funcionarios", "/api/funcionarios", "/v1/funcionarios"],
    queryParams: { offset, limit },
  });

  const funcionarios: InovafarmaFuncionario[] = (items || [])
    .map((raw: any) => {
      const codigoFuncionario = String(
        raw.CODIGOFUNCIONARIO ??
          raw.codigoFuncionario ??
          raw.codigo_funcionario ??
          raw.codigo ??
          raw.idFuncionario ??
          raw.id ??
          "",
      ).trim();
      const cpf = sanitizeCpf(raw.cpf ?? raw.CPF ?? raw.documento ?? "");
      const nome = String(
        raw.nome ?? raw.NOME ?? raw.nomeFuncionario ?? raw.vendedor ?? "",
      ).trim();
      const ativo =
        raw.ativo !== undefined ? Boolean(raw.ativo) : true;
      return { codigoFuncionario, cpf, nome, ativo };
    })
    .filter((f) => Boolean(f.codigoFuncionario || f.cpf));

  return { funcionarios, endpointUsed };
}

/**
 * Resolve e valida o identificador do `vendedor` para o payload `POST /Venda`:
 * - NUNCA permite enviar um nome no campo `vendedor`
 * - Retorna exclusivamente o CPF (11 dígitos) ou o CODIGOFUNCIONARIO numérico mapeado de `/funcionarios`
 */
export async function resolveInovafarmaVendedor(params: {
  rawSeller?: string | number | null;
  baseUrl?: string;
  token?: string;
  cnpj?: string;
  funcionariosPreloaded?: InovafarmaFuncionario[];
}): Promise<string> {
  const rawStr = String(params.rawSeller ?? "").trim();

  // 1. Verifica se já é um CPF (11 dígitos) ou CODIGOFUNCIONARIO estritamente numérico (sem letras)
  if (rawStr && !/[a-zA-ZÀ-ÿ]/.test(rawStr)) {
    const digitsOnly = rawStr.replace(/\D+/g, "");
    if (digitsOnly.length > 0) {
      return digitsOnly;
    }
  }

  // 2. Se foi enviado um nome ou está vazio, consulta a lista de /funcionarios para mapear CPF ou CODIGOFUNCIONARIO
  let funcionarios: InovafarmaFuncionario[] = params.funcionariosPreloaded || [];
  if (
    funcionarios.length === 0 &&
    params.token &&
    params.cnpj &&
    sanitizeCnpj(params.cnpj).length >= 11
  ) {
    try {
      const fetched = await fetchInovafarmaFuncionarios({
        baseUrl: params.baseUrl,
        token: params.token,
        cnpj: params.cnpj,
      });
      funcionarios = fetched.funcionarios;
    } catch {
      funcionarios = [];
    }
  }

  if (rawStr && funcionarios.length > 0) {
    const normalizedSearch = rawStr
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

    const matched = funcionarios.find((f) => {
      const fName = (f.nome || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      return (
        fName === normalizedSearch ||
        fName.includes(normalizedSearch) ||
        normalizedSearch.includes(fName)
      );
    });

    if (matched) {
      return matched.codigoFuncionario || matched.cpf;
    }
  }

  // Se houver funcionários cadastrados e nenhum vendedor específico foi passado, usa o primeiro ativo
  if (!rawStr && funcionarios.length > 0) {
    const firstActive = funcionarios.find((f) => f.ativo !== false) || funcionarios[0];
    if (firstActive) {
      return firstActive.codigoFuncionario || firstActive.cpf;
    }
  }

  if (rawStr && /[a-zA-ZÀ-ÿ]/.test(rawStr)) {
    throw new Error(
      `O campo 'vendedor' no Inovafarma não aceita nome ('${rawStr}'). Informe exclusivamente o CPF ou o CODIGOFUNCIONARIO obtido em /funcionarios.`,
    );
  }

  // Fallback padrão de código de funcionário do balcão/e-commerce caso não informado ("1")
  return "1";
}

/**
 * Monta e valida o payload oficial do `POST /Venda` do Inovafarma (Portal PS):
 * 1. Garante que `vendedor` contenha apenas CPF ou CODIGOFUNCIONARIO (nunca nome).
 * 2. Distribui qualquer desconto global diretamente nos itens (`descontoUnitario`), sem campo de desconto no cabeçalho.
 * 3. Valida rigorosamente se o somatório dos pagamentos bate exatamente com `(total líquido dos itens + taxaEntrega)`.
 */
export async function buildInovafarmaVendaPayload(
  input: InovafarmaVendaInput,
  authContext?: {
    baseUrl?: string;
    token?: string;
    cnpj?: string;
    funcionariosPreloaded?: InovafarmaFuncionario[];
  },
): Promise<InovafarmaVendaPayload> {
  if (!input.itens || !Array.isArray(input.itens) || input.itens.length === 0) {
    throw new Error("O pedido deve conter pelo menos um item para envio ao Inovafarma (POST /Venda).");
  }

  // 1. Resolve vendedor (apenas CPF ou CODIGOFUNCIONARIO, nunca nome)
  const vendedorCodigoOuCpf = await resolveInovafarmaVendedor({
    rawSeller: input.vendedor,
    baseUrl: authContext?.baseUrl,
    token: authContext?.token,
    cnpj: authContext?.cnpj,
    funcionariosPreloaded: authContext?.funcionariosPreloaded,
  });

  // 2. Prepara itens brutos e calcula subtotal bruto
  const preparedItems = input.itens.map((raw, idx) => {
    const quantidade = Math.max(1, Math.floor(parseInovafarmaNumber(raw.quantidade, 1)));
    const precoUnitario = roundCurrency(Math.max(0, parseInovafarmaNumber(raw.precoUnitario, 0)));
    const descontoUnitarioDireto = roundCurrency(
      Math.max(0, parseInovafarmaNumber(raw.descontoUnitario, 0)),
    );
    const descontoTotalItemDireto = roundCurrency(
      Math.max(0, parseInovafarmaNumber(raw.descontoTotalItem, 0)),
    );

    const itemBaseDiscountTotal =
      descontoUnitarioDireto > 0
        ? roundCurrency(descontoUnitarioDireto * quantidade)
        : descontoTotalItemDireto;

    const ean = sanitizeInovafarmaEan(raw.ean);
    const codigoProduto = String(raw.codigoProduto ?? raw.codigoInterno ?? ean ?? idx + 1).trim();

    return {
      ean: ean || undefined,
      codigoBarras: ean || undefined,
      codigoProduto,
      quantidade,
      precoUnitario,
      itemBaseDiscountTotal,
      grossSubtotal: roundCurrency(precoUnitario * quantidade),
    };
  });

  const totalGrossItems = roundCurrency(
    preparedItems.reduce((acc, it) => acc + it.grossSubtotal, 0),
  );

  const globalDiscountToDistribute = roundCurrency(
    Math.max(0, parseInovafarmaNumber(input.descontoGlobal, 0)),
  );

  // 3. Distribui o desconto global diretamente no `descontoUnitario` de cada item
  let remainingGlobalDiscount = globalDiscountToDistribute;

  const finalItems: InovafarmaVendaItemPayload[] = preparedItems.map((it, index) => {
    let allocatedGlobalDiscount = 0;
    if (globalDiscountToDistribute > 0 && totalGrossItems > 0) {
      if (index === preparedItems.length - 1) {
        allocatedGlobalDiscount = roundCurrency(Math.max(0, remainingGlobalDiscount));
      } else {
        const share = (it.grossSubtotal / totalGrossItems) * globalDiscountToDistribute;
        // Arredonda o desconto unitário proporcional para que (descontoUnitario * quantidade) seja exato
        const unitShare = roundCurrency(share / it.quantidade);
        allocatedGlobalDiscount = roundCurrency(unitShare * it.quantidade);
        remainingGlobalDiscount = roundCurrency(remainingGlobalDiscount - allocatedGlobalDiscount);
      }
    }

    const totalDiscountForItem = Math.min(
      it.grossSubtotal,
      roundCurrency(it.itemBaseDiscountTotal + allocatedGlobalDiscount),
    );

    const descontoUnitario = roundCurrency(totalDiscountForItem / it.quantidade);
    const valorLiquidoUnitario = roundCurrency(Math.max(0, it.precoUnitario - descontoUnitario));
    const subtotalLiquido = roundCurrency(valorLiquidoUnitario * it.quantidade);

    return {
      ...(it.codigoBarras ? { codigoBarras: it.codigoBarras, ean: it.ean } : {}),
      codigoProduto: it.codigoProduto,
      quantidade: it.quantidade,
      precoUnitario: it.precoUnitario,
      descontoUnitario,
      valorLiquidoUnitario,
      subtotalLiquido,
    };
  });

  const valorTotalItens = roundCurrency(
    finalItems.reduce((acc, it) => acc + it.subtotalLiquido, 0),
  );
  const taxaEntrega = roundCurrency(Math.max(0, parseInovafarmaNumber(input.taxaEntrega, 0)));
  const valorTotalVenda = roundCurrency(valorTotalItens + taxaEntrega);

  // 4. Monta e valida o somatório dos pagamentos contra (valorTotalItens + taxaEntrega)
  const rawPagamentos =
    Array.isArray(input.pagamentos) && input.pagamentos.length > 0
      ? input.pagamentos.map((p) => ({
          formaPagamento: String(p.formaPagamento || input.formaPagamentoPadrao || "DINHEIRO").trim(),
          valor: roundCurrency(parseInovafarmaNumber(p.valor, 0)),
          parcelas: Math.max(1, Math.floor(parseInovafarmaNumber(p.parcelas, 1))),
        }))
      : [
          {
            formaPagamento: String(input.formaPagamentoPadrao || "PIX").trim(),
            valor: valorTotalVenda,
            parcelas: 1,
          },
        ];

  const somaPagamentos = roundCurrency(
    rawPagamentos.reduce((acc, p) => acc + p.valor, 0),
  );

  const diferencaFinanceira = roundCurrency(Math.abs(somaPagamentos - valorTotalVenda));
  if (diferencaFinanceira > 0.001) {
    throw new Error(
      `Divergência financeira bloqueada no envio para o PDV Inovafarma: o somatório dos pagamentos (R$ ${somaPagamentos.toFixed(2)}) não bate com o cálculo líquido dos itens (R$ ${valorTotalItens.toFixed(2)}) + taxa de entrega (R$ ${taxaEntrega.toFixed(2)}) = R$ ${valorTotalVenda.toFixed(2)}.`,
    );
  }

  const payload: InovafarmaVendaPayload = {
    ...(input.pedidoId ? { numeroPedido: String(input.pedidoId) } : {}),
    vendedor: vendedorCodigoOuCpf,
    dataHora: new Date().toISOString(),
    taxaEntrega,
    ...(input.cliente
      ? {
          cliente: {
            nome: String(input.cliente.nome || "Cliente Consumidor").trim(),
            cpf: sanitizeCpf(input.cliente.cpf),
            telefone: String(input.cliente.telefone || "").replace(/\D+/g, ""),
            ...(input.cliente.endereco
              ? {
                  endereco: {
                    logradouro: String(input.cliente.endereco.logradouro || "").trim(),
                    numero: String(input.cliente.endereco.numero || "S/N").trim(),
                    ...(input.cliente.endereco.complemento
                      ? { complemento: String(input.cliente.endereco.complemento).trim() }
                      : {}),
                    bairro: String(input.cliente.endereco.bairro || "").trim(),
                    cidade: String(input.cliente.endereco.cidade || "").trim(),
                    ...(input.cliente.endereco.uf
                      ? { uf: String(input.cliente.endereco.uf).trim().toUpperCase() }
                      : {}),
                    ...(input.cliente.endereco.cep
                      ? { cep: String(input.cliente.endereco.cep).replace(/\D+/g, "") }
                      : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
    itens: finalItems,
    pagamentos: rawPagamentos,
    valorTotalItens,
    valorTotalVenda,
    ...(input.observacao ? { observacao: String(input.observacao).trim() } : {}),
  };

  return payload;
}

/**
 * Envia uma venda (`POST /Venda`) para a API do Inovafarma (Portal PS) com validação de headers,
 * vendedor (CPF ou CODIGOFUNCIONARIO), descontoUnitario nos itens e conciliação financeira dos pagamentos.
 */
export async function sendInovafarmaVenda(params: {
  baseUrl?: string;
  token: string;
  cnpj: string;
  venda: InovafarmaVendaInput;
}): Promise<{
  success: boolean;
  endpointUsed: string;
  payloadEnviado: InovafarmaVendaPayload;
  response: any;
}> {
  const headers = buildInovafarmaHeaders(params.token, params.cnpj);
  const payloadEnviado = await buildInovafarmaVendaPayload(params.venda, {
    baseUrl: params.baseUrl,
    token: params.token,
    cnpj: params.cnpj,
  });

  const rawBase = (params.baseUrl || INOVAFARMA_DEFAULT_API_URL).trim();
  const cleanBase = rawBase.replace(/\/+$/, "");

  const candidateUrls: string[] = [];
  try {
    const parsed = new URL(cleanBase);
    const origin = parsed.origin;
    const basePath =
      parsed.pathname && parsed.pathname !== "/" ? parsed.pathname.replace(/\/+$/, "") : "";
    const paths = ["/Venda", "/venda", "/api/Venda", "/api/venda", "/v1/Venda"];
    for (const p of paths) {
      if (basePath && !basePath.toLowerCase().endsWith(p.toLowerCase())) {
        candidateUrls.push(`${origin}${basePath}${p}`);
      }
      const root = `${origin}${p}`;
      if (!candidateUrls.includes(root)) {
        candidateUrls.push(root);
      }
    }
  } catch {
    candidateUrls.push(`${INOVAFARMA_DEFAULT_API_URL}/Venda`);
    candidateUrls.push(`${INOVAFARMA_DEFAULT_API_URL}/venda`);
  }

  const errors: string[] = [];

  for (const endpoint of candidateUrls) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payloadEnviado),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const contentType = response.headers.get("content-type") || "";
      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        errors.push(
          `${endpoint} -> HTTP ${response.status}${errText ? ` (${errText.slice(0, 120)})` : ""}`,
        );
        continue;
      }

      if (contentType.includes("text/html")) {
        errors.push(`${endpoint} -> Retornou HTML em vez de confirmação JSON do PDV`);
        continue;
      }

      const data = await response.json().catch(() => ({ ok: true }));
      return {
        success: true,
        endpointUsed: endpoint,
        payloadEnviado,
        response: data,
      };
    } catch (err: any) {
      errors.push(`${endpoint} -> ${err?.message || "Erro de rede"}`);
    }
  }

  throw new Error(
    `Falha ao enviar venda (POST /Venda) ao Inovafarma: ${errors.slice(0, 2).join(" | ")}`,
  );
}

/**
 * Sincroniza em lote (upsert) os produtos do Inovafarma (`/produtos` ou `/produtosalterados`)
 * na tabela `products` do Supabase, vinculando ao `tenant_id` da farmácia e higienizando os códigos EAN.
 */
export async function syncInovafarmaProductsToSupabase(
  supabaseClient: SupabaseClient,
  options: InovafarmaSyncOptions,
  classifyTaxonomyFn?: (
    name: string,
    category?: string,
  ) => { department?: string; category?: string; subcategory?: string },
): Promise<InovafarmaSyncResult> {
  const { tenantId } = options;
  const syncedAt = new Date().toISOString();

  if (!tenantId) {
    throw new Error("tenant_id da farmácia é obrigatório para sincronização com o Inovafarma.");
  }

  // 1. Carrega configurações da farmácia no Supabase e gera o accessToken dinamicamente via POST /api/login se houver Login/Senha salvos
  const { data: tenant, error: tenantError } = await supabaseClient
    .from("tenants")
    .select("*")
    .eq("id", tenantId)
    .single();

  if (tenantError || !tenant) {
    throw new Error(
      `Farmácia não encontrada no banco de dados (${tenantError?.message || tenantId}).`,
    );
  }

  const effectiveUrl = (options.erpUrl || tenant.erp_url || INOVAFARMA_DEFAULT_API_URL).trim();
  const effectiveCnpj = sanitizeCnpj(
    options.cnpj || tenant.cnpj || tenant.smart_banners?._regulatoryData?.cnpj || "",
  );
  const ignoreErpPrices =
    options.ignoreErpPrices !== undefined
      ? Boolean(options.ignoreErpPrices)
      : Boolean(tenant.ignore_erp_prices);

  const savedLogin = (options.apiLogin || extractTenantErpLogin(tenant)).trim();
  const savedPassword =
    options.apiPassword && !isMaskedErpPassword(options.apiPassword)
      ? String(options.apiPassword).trim()
      : extractTenantErpPassword(tenant);

  let effectiveToken = (options.apiToken || tenant.integration_token || "").trim();

  let rawProducts: InovafarmaRawProduct[] = [];
  let endpointUsed = "payload_direto";

  try {
    // Autentica dinamicamente em POST /api/login usando o login e senha salvos no cadastro da farmácia
    if (
      (!Array.isArray(options.productsOverride) || options.productsOverride.length === 0) &&
      savedLogin &&
      savedPassword
    ) {
      const loginResult = await authenticateInovafarma({
        supabaseClient,
        tenantId,
        baseUrl: effectiveUrl,
        cnpj: effectiveCnpj,
        login: savedLogin,
        password: savedPassword,
      });
      effectiveToken = loginResult.accessToken;
    }
    // 2. Obtém produtos da API do Inovafarma (respeitando Bearer + cnpj + offset=1 & limit<=500)
    if (Array.isArray(options.productsOverride) && options.productsOverride.length > 0) {
      rawProducts = options.productsOverride;
      endpointUsed = "push_payload";
    } else if (options.mode === "delta" || (options.inicial && options.final)) {
      const fetched = await fetchInovafarmaProdutosAlterados({
        baseUrl: effectiveUrl,
        token: effectiveToken,
        cnpj: effectiveCnpj,
        inicial: options.inicial || "",
        final: options.final || "",
        offset: options.offset,
        limit: options.limit,
      });
      rawProducts = fetched.products;
      endpointUsed = fetched.endpointUsed;
    } else {
      const fetched = await fetchInovafarmaProducts({
        baseUrl: effectiveUrl,
        token: effectiveToken,
        cnpj: effectiveCnpj,
        offset: options.offset,
        limit: options.limit,
      });
      rawProducts = fetched.products;
      endpointUsed = fetched.endpointUsed;
    }

    // 3. Normaliza e deduplica por EAN higienizado (ou código interno)
    const normalizedMap = new Map<string, NormalizedInovafarmaProduct>();
    let skippedCount = 0;

    for (const rawItem of rawProducts) {
      const normalized = normalizeInovafarmaProduct(rawItem);
      if (!normalized) {
        skippedCount++;
        continue;
      }
      const key = normalized.barcode || `INT:${normalized.internalCode}`;
      normalizedMap.set(key, normalized);
    }

    const validProducts = Array.from(normalizedMap.values());

    if (validProducts.length === 0) {
      const emptyResult: InovafarmaSyncResult = {
        success: true,
        tenantId,
        endpointUsed,
        totalFetched: rawProducts.length,
        totalValid: 0,
        insertedCount: 0,
        updatedCount: 0,
        skippedCount,
        ignoreErpPrices,
        syncedAt,
        message: "A API do Inovafarma respondeu com sucesso, mas nenhum produto válido foi retornado no período/página.",
      };

      await supabaseClient.from("integration_logs").insert({
        tenant_id: tenantId,
        endpoint: options.mode === "delta" ? "/inovafarma/produtosalterados" : "/inovafarma/sync",
        payload: {
          endpointUsed,
          cnpj: effectiveCnpj,
          inicial: options.inicial,
          final: options.final,
          totalFetched: rawProducts.length,
          totalValid: 0,
          skippedCount,
        },
        status: "SUCCESS",
      });

      return emptyResult;
    }

    // 4. Busca produtos existentes da farmácia no Supabase para preservar IDs, fotos e enriquecimento
    const existingByBarcode = new Map<string, any>();
    const existingByInternalCode = new Map<string, any>();

    let from = 0;
    const step = 1000;
    while (true) {
      const { data: existingBatch, error: fetchErr } = await supabaseClient
        .from("products")
        .select(
          "id, barcode, internal_code, name, price, promotional_price, stock, category, department, subcategory, image, images, description, is_featured, is_ai_enriched",
        )
        .eq("tenant_id", tenantId)
        .range(from, from + step - 1);

      if (fetchErr) {
        throw new Error(`Erro ao consultar catálogo atual da farmácia: ${fetchErr.message}`);
      }
      if (!existingBatch || existingBatch.length === 0) break;

      for (const prod of existingBatch) {
        const cleanBc = sanitizeInovafarmaEan(prod.barcode);
        if (cleanBc) {
          existingByBarcode.set(cleanBc, prod);
        }
        if (prod.barcode) {
          existingByBarcode.set(String(prod.barcode).trim(), prod);
        }
        if (prod.internal_code) {
          existingByInternalCode.set(String(prod.internal_code).trim(), prod);
        }
      }

      if (existingBatch.length < step) break;
      from += step;
    }

    // 5. Prepara lote para upsert
    let insertedCount = 0;
    let updatedCount = 0;
    const upsertPayloads: any[] = [];

    for (const item of validProducts) {
      const existing =
        (item.barcode && existingByBarcode.get(item.barcode)) ||
        (item.internalCode && existingByInternalCode.get(item.internalCode));

      if (existing) {
        updatedCount++;
        const updatedRow: any = {
          id: existing.id,
          tenant_id: tenantId,
          barcode: item.barcode || existing.barcode,
          internal_code: item.internalCode || existing.internal_code || item.barcode,
          name: existing.name || item.name,
          stock: item.stock,
          category: existing.category || item.category || "Geral",
        };

        if (item.stock === 0 && existing.is_featured) {
          updatedRow.is_featured = false;
        }

        if (!ignoreErpPrices) {
          if (item.price > 0) {
            updatedRow.price = item.price;
          } else {
            updatedRow.price = existing.price ?? 0;
          }
          if (item.promotionalPrice !== null) {
            updatedRow.promotional_price = item.promotionalPrice;
          }
        } else {
          updatedRow.price = existing.price ?? item.price ?? 0;
          updatedRow.promotional_price = existing.promotional_price ?? null;
        }

        upsertPayloads.push(updatedRow);
      } else {
        insertedCount++;
        let taxonomy: { department?: string; category?: string; subcategory?: string } = {};
        if (classifyTaxonomyFn) {
          try {
            taxonomy = classifyTaxonomyFn(item.name, item.category);
          } catch {
            taxonomy = {};
          }
        }

        const newRow: any = {
          id: crypto.randomUUID(),
          tenant_id: tenantId,
          barcode: item.barcode,
          internal_code: item.internalCode || item.barcode,
          name: item.name,
          description: item.activeIngredient
            ? `Princípio Ativo: ${item.activeIngredient}`
            : "",
          price: item.price,
          promotional_price: item.promotionalPrice,
          stock: item.stock,
          category: taxonomy.category || item.category || "Geral",
          department: taxonomy.department || "Outros",
          subcategory: taxonomy.subcategory || "Outros",
          is_featured: false,
          is_ai_enriched: false,
        };

        upsertPayloads.push(newRow);
      }
    }

    // 6. Executa upsert em lotes de 250 registros no Supabase
    const BATCH_SIZE = 250;
    for (let i = 0; i < upsertPayloads.length; i += BATCH_SIZE) {
      const chunk = upsertPayloads.slice(i, i + BATCH_SIZE);
      const { error: upsertErr } = await supabaseClient
        .from("products")
        .upsert(chunk, { onConflict: "id" });

      if (upsertErr) {
        const minimalChunk = chunk.map((row) => {
          const { department, subcategory, ...rest } = row;
          return rest;
        });
        const { error: retryErr } = await supabaseClient
          .from("products")
          .upsert(minimalChunk, { onConflict: "id" });

        if (retryErr) {
          throw new Error(`Falha ao gravar lote de produtos no Supabase: ${retryErr.message}`);
        }
      }
    }

    const result: InovafarmaSyncResult = {
      success: true,
      tenantId,
      endpointUsed,
      totalFetched: rawProducts.length,
      totalValid: validProducts.length,
      insertedCount,
      updatedCount,
      skippedCount,
      ignoreErpPrices,
      syncedAt,
      message: `Sincronização Inovafarma concluída: ${validProducts.length} produtos processados (${insertedCount} novos, ${updatedCount} atualizados).`,
    };

    await supabaseClient.from("integration_logs").insert({
      tenant_id: tenantId,
      endpoint: options.mode === "delta" ? "/inovafarma/produtosalterados" : "/inovafarma/sync",
      payload: {
        endpointUsed,
        cnpj: effectiveCnpj,
        inicial: options.inicial,
        final: options.final,
        totalFetched: rawProducts.length,
        totalValid: validProducts.length,
        insertedCount,
        updatedCount,
        skippedCount,
        ignoreErpPrices,
      },
      status: "SUCCESS",
    });

    return result;
  } catch (err: any) {
    const errorMessage = err?.message || "Erro desconhecido na sincronização com Inovafarma";
    await supabaseClient.from("integration_logs").insert({
      tenant_id: tenantId,
      endpoint: options.mode === "delta" ? "/inovafarma/produtosalterados" : "/inovafarma/sync",
      payload: {
        erpUrl: effectiveUrl,
        cnpj: effectiveCnpj,
        inicial: options.inicial,
        final: options.final,
        endpointUsed,
      },
      status: "FAILED",
      error_message: errorMessage,
    });
    throw err;
  }
}

/**
 * Helper cliente (Frontend) para acionar a sincronização Inovafarma no servidor
 */
export async function triggerInovafarmaSync(params: {
  tenantId: string;
  erpUrl?: string;
  apiToken?: string;
  apiLogin?: string;
  apiPassword?: string;
  cnpj?: string;
  ignoreErpPrices?: boolean;
  mode?: "full" | "delta";
  inicial?: string;
  final?: string;
  offset?: number;
  limit?: number;
}): Promise<InovafarmaSyncResult> {
  const response = await fetch("/api/integration/inovafarma/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(params.apiToken ? { "x-api-key": params.apiToken } : {}),
    },
    body: JSON.stringify(params),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error || data.details || `Falha na sincronização (HTTP ${response.status})`);
  }
  return data as InovafarmaSyncResult;
}
