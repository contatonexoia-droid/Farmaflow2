import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const INOVAFARMA_DEFAULT_API_URL = "https://integracao.portalps.app";
export const INOVAFARMA_DEFAULT_ROUTE_ID = "homologacao";
export const INOVAFARMA_MAX_LIMIT = 500;
export const INOVAFARMA_MIN_OFFSET = 1;
export const INOVAFARMA_MAX_DATE_WINDOW_DAYS = 31;
export const INOVAFARMA_TOKEN_VALIDITY_DAYS = 30;

export const INOVAFARMA_HOMOLOGACAO_PRESET = {
  erp_base_url: "https://integracao.portalps.app",
  erp_route_id: "homologacao",
  erp_cnpj: "02433981097173",
  erp_login: "homologacao@inovafarma.com.br",
} as const;

export interface InovafarmaTenantConfig {
  erp_base_url: string;
  erp_route_id: string;
  erp_cnpj: string;
  erp_login: string;
  erp_password: string;
  has_erp_password: boolean;
  erp_api_key: string;
  erp_access_token: string;
  erp_token_expiration: string;
  last_product_sync: string;
  last_customer_sync: string;
  ignore_erp_prices: boolean;
}

export interface InovafarmaRawProduct {
  // Campos oficiais API Pública E-commerce v1 Inovafarma
  CODIGOPRODUTO?: string | number | null;
  CODIGOBARRAS?: string | number | null;
  EANADICIONAL?: string | number | string[] | null;
  DESCRICAO?: string | null;
  NOME?: string | null;
  APRESENTACAO?: string | null;
  UNIDADEMEDIDA?: string | null;
  PRECOVENDA?: number | string | null;
  MENORPRECOVENDA?: number | string | null;
  PRECOPROMOCIONAL?: number | string | null;
  PRECOCUSTO?: number | string | null;
  ESTOQUE?: number | string | null;
  SALDOESTOQUE?: number | string | null;
  DATAATUALIZACAOPRODUTO?: string | null;
  PRINCIPIOATIVO?: string | null;
  FABRICANTE?: string | null;
  LABORATORIO?: string | null;
  CATEGORIA?: string | null;
  GRUPO?: string | null;
  SECAO?: string | null;
  ATIVO?: boolean | number | string | null;

  // Aliases camelCase / snake_case legados
  ean?: string | number | null;
  eanAdicional?: string | number | string[] | null;
  ean_adicional?: string | number | string[] | null;
  codigoBarras?: string | number | null;
  codBarras?: string | number | null;
  codigo_barras?: string | number | null;
  gtin?: string | number | null;
  barcode?: string | number | null;
  ean13?: string | number | null;
  codigoProduto?: string | number | null;
  codigo_produto?: string | number | null;
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
  unidadeMedida?: string | null;
  unidade_medida?: string | null;
  unidade?: string | null;
  precoVenda?: number | string | null;
  preco_venda?: number | string | null;
  menorPrecoVenda?: number | string | null;
  menor_preco_venda?: number | string | null;
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
  dataAtualizacaoProduto?: string | null;
  data_atualizacao_produto?: string | null;
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
  internalCode: string; // CODIGOPRODUTO obrigatório para POST /Venda
  erpProductId: string; // CODIGOPRODUTO
  additionalEans: string[];
  unitMeasure: string; // UNIDADEMEDIDA (2 ou 3 chars: UN, CX, etc.)
  name: string;
  price: number; // Preço final de venda (MENORPRECOVENDA quando disponível)
  originalPrice: number | null; // Preço "De" (PRECOVENDA quando maior que MENORPRECOVENDA)
  promotionalPrice: number | null;
  costPrice: number | null;
  stock: number;
  category: string;
  manufacturer?: string;
  activeIngredient?: string;
  updatedAtErp?: string; // DATAATUALIZACAOPRODUTO
}

export interface InovafarmaFuncionario {
  codigoFuncionario: string;
  cpf: string;
  nome: string;
  ativo?: boolean;
}

export interface InovafarmaMetodoPagamento {
  codigo: string;
  descricao: string;
  tipo: "D" | "C" | string; // D = Dinheiro/À vista, C = Cartão/PIX/Crediário
  formaPagamento: string;
  permiteParcelamento?: boolean;
  ativo?: boolean;
}

export interface InovafarmaSyncOptions {
  tenantId: string;
  apiToken?: string;
  apiLogin?: string;
  apiPassword?: string;
  apiKey?: string;
  erpUrl?: string;
  erpRouteId?: string;
  cnpj?: string;
  ignoreErpPrices?: boolean;
  /** Modo de sincronização: completo (/produtos) ou apenas alterados (/produtosalterados) */
  mode?: "full" | "delta";
  /** Data inicial (AAAA-MM-DD) para /produtosalterados */
  inicial?: string;
  /** Data final (AAAA-MM-DD) para /produtosalterados */
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
  lastProductSync?: string;
  message: string;
  error?: string;
}

export interface InovafarmaVendaItemInput {
  ean?: string | number;
  codigoProduto?: string | number;
  codigoInterno?: string | number;
  unidadeMedida?: string;
  nome?: string;
  quantidade: number;
  precoUnitario: number;
  valorUnitario?: number;
  descontoUnitario?: number;
  descontoTotalItem?: number;
}

export interface InovafarmaVendaPagamentoInput {
  tipo?: "D" | "C" | string;
  formaPagamento: string;
  valor: number;
  parcelas?: number;
  bandeira?: string;
  codigoAutorizacao?: string;
}

export interface InovafarmaVendaInput {
  pedidoId?: string;
  codigoVendaOnLine?: string;
  cnpj?: string;
  vendedor?: string | number;
  retirarNaLoja?: boolean;
  cliente?: {
    nome?: string;
    cpf?: string;
    telefone?: string;
    endereco?: {
      logradouro?: string;
      endereco?: string;
      numero?: string;
      complemento?: string;
      bairro?: string;
      cidade?: string;
      uf?: string;
      cep?: string;
    };
  };
  itens: InovafarmaVendaItemInput[];
  /** Desconto global do pedido (distribuído obrigatoriamente no campo descontoUnitario de cada item) */
  descontoGlobal?: number;
  taxaEntrega?: number;
  pagamentos?: InovafarmaVendaPagamentoInput[];
  formaPagamentoPadrao?: string;
  observacao?: string;
}

export interface InovafarmaVendaItemPayload {
  codigoBarras?: string;
  ean?: string;
  codigoProduto: string;
  unidadeMedida: string;
  quantidade: number;
  valorUnitario: number;
  precoUnitario: number;
  descontoUnitario: number;
  valorLiquidoUnitario: number;
  subtotalLiquido: number;
}

export interface InovafarmaVendaPayload {
  cnpj?: string;
  codigoVendaOnLine: string;
  numeroPedido?: string;
  vendedor: string;
  dataHora: string;
  retirarNaLoja: boolean;
  taxaEntrega: number;
  entrega: {
    retirarNaLoja: boolean;
    taxa: number;
    endereco?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    cidade?: string;
    uf?: string;
    cep?: string;
  };
  cliente?: {
    nome: string;
    cpf: string;
    telefone: string;
    endereco?: {
      logradouro: string;
      endereco: string;
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
    tipo: "D" | "C";
    formaPagamento: string;
    valor: number;
    parcelas: number;
  }>;
  valorTotalItens: number;
  valorTotalVenda: number;
  total: number;
  observacao?: string;
}

export interface InovafarmaVendaReconciliationResult {
  found: boolean;
  httpStatus: number;
  codigoVendaOnLine: string;
  codigoVendaInova: string | null;
  numeroNotaFiscal: string | null;
  chaveAcessoNotaFiscal: string | null;
  valorNotaFiscal: number | null;
  valorPedidoFarmaFlow: number | null;
  divergenciaNotaFiscal: boolean;
  diferencaValorNotaFiscal: number;
  enviadoParaEntrega: boolean;
  entregaFinalizada: boolean;
  vendaEliminada: boolean;
  statusFarmaFlowSugerido: string;
  rawErpData?: any;
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
 * Normaliza UNIDADEMEDIDA do Inovafarma (2 ou 3 caracteres maiúsculos: UN, CX, FR, CP, etc.)
 */
export function normalizeUnidadeMedida(raw: unknown): string {
  const clean = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!clean) return "UN";
  if (clean.length >= 2 && clean.length <= 3) return clean;
  if (clean.startsWith("CX") || clean.startsWith("CAIX")) return "CX";
  if (clean.startsWith("FR")) return "FR";
  if (clean.startsWith("CP") || clean.startsWith("COMP")) return "CP";
  if (clean.startsWith("PCT") || clean.startsWith("PAC")) return "PCT";
  if (clean.startsWith("KIT")) return "KIT";
  return clean.slice(0, 3).padEnd(2, "N");
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
  const creds =
    tenant.smart_banners?._erpCredentials ||
    tenant.delivery_settings?._erpCredentials ||
    {};
  const candidate =
    tenant.erp_login ??
    tenant.erpLogin ??
    tenant.erp_api_login ??
    tenant.erpApiLogin ??
    tenant.erpapilogin ??
    creds.erp_login ??
    creds.erp_api_login ??
    creds.login ??
    "";
  return String(candidate || "").trim();
}

/**
 * Extrai e descriptografa a Senha da API do Inovafarma salva no registro da farmácia (apenas uso interno no servidor)
 */
export function extractTenantErpPassword(tenant: any): string {
  if (!tenant || typeof tenant !== "object") return "";
  const tenantId = String(tenant.id || "");
  const creds =
    tenant.smart_banners?._erpCredentials ||
    tenant.delivery_settings?._erpCredentials ||
    {};
  const rawStored =
    tenant.erp_password ||
    tenant.erpPassword ||
    tenant.erp_api_password ||
    tenant.erpApiPassword ||
    creds.erp_password_enc ||
    creds.erp_api_password_enc ||
    creds.erp_password ||
    creds.erp_api_password ||
    "";
  if (!rawStored || isMaskedErpPassword(rawStored)) return "";
  return decryptErpPassword(String(rawStored), tenantId);
}

/**
 * Verifica se a farmácia possui uma senha da API configurada no banco
 */
export function hasTenantErpPassword(tenant: any): boolean {
  if (!tenant || typeof tenant !== "object") return false;
  if (
    tenant.has_erp_password === true ||
    tenant.hasErpPassword === true ||
    tenant.has_erp_api_password === true ||
    tenant.hasErpApiPassword === true
  ) {
    return true;
  }
  const creds =
    tenant.smart_banners?._erpCredentials ||
    tenant.delivery_settings?._erpCredentials ||
    {};
  const rawStored =
    tenant.erp_password ||
    tenant.erpPassword ||
    tenant.erp_api_password ||
    tenant.erpApiPassword ||
    creds.erp_password_enc ||
    creds.erp_api_password_enc ||
    creds.erp_password ||
    creds.erp_api_password ||
    "";
  return Boolean(rawStored && !isMaskedErpPassword(rawStored));
}

/**
 * Extrai toda a configuração estruturada do Inovafarma de um registro `tenant`
 */
export function extractTenantErpConfig(tenant: any): InovafarmaTenantConfig {
  if (!tenant || typeof tenant !== "object") {
    return {
      erp_base_url: INOVAFARMA_DEFAULT_API_URL,
      erp_route_id: INOVAFARMA_DEFAULT_ROUTE_ID,
      erp_cnpj: "",
      erp_login: "",
      erp_password: "",
      has_erp_password: false,
      erp_api_key: "",
      erp_access_token: "",
      erp_token_expiration: "",
      last_product_sync: "",
      last_customer_sync: "",
      ignore_erp_prices: false,
    };
  }

  const creds =
    tenant.smart_banners?._erpCredentials ||
    tenant.delivery_settings?._erpCredentials ||
    {};
  const regData = tenant.smart_banners?._regulatoryData || {};

  const rawBaseUrl = String(
    tenant.erp_base_url ||
      tenant.erpBaseUrl ||
      creds.erp_base_url ||
      tenant.erp_url ||
      tenant.erpUrl ||
      INOVAFARMA_DEFAULT_API_URL,
  ).trim();

  // Normaliza caso a URL antiga de documentação (guiaintegracao.portalps.app) esteja salva sem rota específica
  const normalizedBaseUrl =
    !rawBaseUrl || rawBaseUrl.includes("guiaintegracao.portalps.app")
      ? INOVAFARMA_DEFAULT_API_URL
      : rawBaseUrl.replace(/\/+$/, "");

  const routeId = String(
    tenant.erp_route_id ||
      tenant.erpRouteId ||
      creds.erp_route_id ||
      INOVAFARMA_DEFAULT_ROUTE_ID,
  )
    .trim()
    .replace(/^\/+|\/+$/g, "");

  const erpCnpj = sanitizeCnpj(
    tenant.erp_cnpj ||
      tenant.erpCnpj ||
      creds.erp_cnpj ||
      tenant.cnpj ||
      regData.cnpj ||
      "",
  );

  const erpLogin = extractTenantErpLogin(tenant);
  const erpPassword = extractTenantErpPassword(tenant);
  const hasPassword = hasTenantErpPassword(tenant);

  const erpApiKey = String(
    tenant.erp_api_key ??
      tenant.erpApiKey ??
      creds.erp_api_key ??
      "",
  ).trim();

  const rawStoredToken =
    tenant.erp_access_token ||
    tenant.erpAccessToken ||
    creds.erp_access_token_enc ||
    creds.erp_access_token ||
    "";
  const erpAccessToken = rawStoredToken
    ? decryptErpPassword(String(rawStoredToken), String(tenant.id || ""))
    : "";

  const erpTokenExpiration = String(
    tenant.erp_token_expiration ||
      tenant.erpTokenExpiration ||
      creds.erp_token_expiration ||
      "",
  ).trim();

  const lastProductSync = String(
    tenant.last_product_sync ||
      tenant.lastProductSync ||
      creds.last_product_sync ||
      "",
  ).trim();

  const lastCustomerSync = String(
    tenant.last_customer_sync ||
      tenant.lastCustomerSync ||
      creds.last_customer_sync ||
      "",
  ).trim();

  const ignoreErpPrices = Boolean(
    tenant.ignore_erp_prices ??
      tenant.delivery_settings?.ignore_erp_prices ??
      false,
  );

  return {
    erp_base_url: normalizedBaseUrl || INOVAFARMA_DEFAULT_API_URL,
    erp_route_id: routeId || INOVAFARMA_DEFAULT_ROUTE_ID,
    erp_cnpj: erpCnpj,
    erp_login: erpLogin,
    erp_password: erpPassword,
    has_erp_password: hasPassword,
    erp_api_key: erpApiKey,
    erp_access_token: erpAccessToken,
    erp_token_expiration: erpTokenExpiration,
    last_product_sync: lastProductSync,
    last_customer_sync: lastCustomerSync,
    ignore_erp_prices: ignoreErpPrices,
  };
}

/**
 * Higieniza o objeto da farmácia antes de enviá-lo ao frontend:
 * - Garante que a senha da API (`erp_password` / `erp_api_password`) e o `erp_access_token` NUNCA sejam expostos em texto plano nas listagens
 * - Preenche todos os metadados estruturados do Inovafarma v1
 */
export function sanitizeTenantErpCredentialsForClient<T extends Record<string, any>>(
  tenant: T,
): T {
  if (!tenant || typeof tenant !== "object") return tenant;
  const copy: any = { ...tenant };
  const cfg = extractTenantErpConfig(tenant);

  copy.erp_base_url = cfg.erp_base_url;
  copy.erpBaseUrl = cfg.erp_base_url;
  copy.erp_url = copy.erp_url || cfg.erp_base_url;
  copy.erpUrl = copy.erpUrl || cfg.erp_base_url;

  copy.erp_route_id = cfg.erp_route_id;
  copy.erpRouteId = cfg.erp_route_id;

  copy.erp_cnpj = cfg.erp_cnpj;
  copy.erpCnpj = cfg.erp_cnpj;

  copy.erp_login = cfg.erp_login;
  copy.erpLogin = cfg.erp_login;
  copy.erp_api_login = cfg.erp_login;
  copy.erpApiLogin = cfg.erp_login;

  copy.has_erp_password = cfg.has_erp_password;
  copy.hasErpPassword = cfg.has_erp_password;
  copy.has_erp_api_password = cfg.has_erp_password;
  copy.hasErpApiPassword = cfg.has_erp_password;

  copy.erp_api_key = cfg.erp_api_key;
  copy.erpApiKey = cfg.erp_api_key;

  copy.has_erp_access_token = Boolean(cfg.erp_access_token);
  copy.hasErpAccessToken = Boolean(cfg.erp_access_token);
  copy.erp_token_expiration = cfg.erp_token_expiration;
  copy.erpTokenExpiration = cfg.erp_token_expiration;

  copy.last_product_sync = cfg.last_product_sync;
  copy.lastProductSync = cfg.last_product_sync;
  copy.last_customer_sync = cfg.last_customer_sync;
  copy.lastCustomerSync = cfg.last_customer_sync;

  // Nunca retorna a senha ou o accessToken em texto plano para o cliente
  delete copy.erp_password;
  delete copy.erpPassword;
  delete copy.erp_api_password;
  delete copy.erpApiPassword;
  delete copy.erp_access_token;
  delete copy.erpAccessToken;

  if (copy.smart_banners && typeof copy.smart_banners === "object") {
    copy.smart_banners = { ...copy.smart_banners };
    if (
      copy.smart_banners._erpCredentials &&
      typeof copy.smart_banners._erpCredentials === "object"
    ) {
      copy.smart_banners._erpCredentials = {
        erp_base_url: cfg.erp_base_url,
        erp_route_id: cfg.erp_route_id,
        erp_cnpj: cfg.erp_cnpj,
        erp_login: cfg.erp_login,
        erp_api_login: cfg.erp_login,
        erp_api_key: cfg.erp_api_key,
        has_erp_password: cfg.has_erp_password,
        has_erp_api_password: cfg.has_erp_password,
        has_erp_access_token: Boolean(cfg.erp_access_token),
        erp_token_expiration: cfg.erp_token_expiration,
        last_product_sync: cfg.last_product_sync,
        last_customer_sync: cfg.last_customer_sync,
      };
    }
  }

  return copy;
}

/**
 * Persiste estado/credenciais do Inovafarma (token em cache de 30 dias, watermarks de sync, etc.)
 * com fallback resiliente em `smart_banners._erpCredentials` caso alguma coluna ainda não exista no banco SQL.
 */
export async function saveTenantInovafarmaState(
  supabaseClient: SupabaseClient,
  tenantId: string,
  stateUpdates: Partial<{
    erp_base_url: string;
    erp_route_id: string;
    erp_cnpj: string;
    erp_login: string;
    erp_password_plain: string;
    erp_api_key: string;
    erp_access_token: string;
    erp_token_expiration: string;
    last_product_sync: string;
    last_customer_sync: string;
  }>,
): Promise<void> {
  if (!tenantId) return;
  try {
    const { data: currentTenant } = await supabaseClient
      .from("tenants")
      .select("*")
      .eq("id", tenantId)
      .maybeSingle();

    const existingBanners =
      currentTenant?.smart_banners && typeof currentTenant.smart_banners === "object"
        ? { ...currentTenant.smart_banners }
        : {};
    const existingCreds =
      existingBanners._erpCredentials && typeof existingBanners._erpCredentials === "object"
        ? { ...existingBanners._erpCredentials }
        : {};

    const topLevelUpdates: Record<string, any> = {};

    if (stateUpdates.erp_base_url !== undefined) {
      const cleanUrl = stateUpdates.erp_base_url.trim().replace(/\/+$/, "");
      existingCreds.erp_base_url = cleanUrl;
      topLevelUpdates.erp_base_url = cleanUrl;
      topLevelUpdates.erp_url = cleanUrl;
    }
    if (stateUpdates.erp_route_id !== undefined) {
      const cleanRoute = stateUpdates.erp_route_id.trim().replace(/^\/+|\/+$/g, "");
      existingCreds.erp_route_id = cleanRoute;
      topLevelUpdates.erp_route_id = cleanRoute;
    }
    if (stateUpdates.erp_cnpj !== undefined) {
      const cleanCnpj = sanitizeCnpj(stateUpdates.erp_cnpj);
      existingCreds.erp_cnpj = cleanCnpj;
      topLevelUpdates.erp_cnpj = cleanCnpj;
      if (cleanCnpj.length >= 11) {
        topLevelUpdates.cnpj = cleanCnpj;
      }
    }
    if (stateUpdates.erp_login !== undefined) {
      const cleanLogin = stateUpdates.erp_login.trim();
      existingCreds.erp_login = cleanLogin;
      existingCreds.erp_api_login = cleanLogin;
      topLevelUpdates.erp_login = cleanLogin;
      topLevelUpdates.erp_api_login = cleanLogin;
    }
    if (
      stateUpdates.erp_password_plain !== undefined &&
      stateUpdates.erp_password_plain &&
      !isMaskedErpPassword(stateUpdates.erp_password_plain)
    ) {
      const encPass = encryptErpPassword(stateUpdates.erp_password_plain.trim(), tenantId);
      existingCreds.erp_password_enc = encPass;
      existingCreds.erp_api_password_enc = encPass;
      delete existingCreds.erp_password;
      delete existingCreds.erp_api_password;
      topLevelUpdates.erp_password = encPass;
      topLevelUpdates.erp_api_password = encPass;
    }
    if (stateUpdates.erp_api_key !== undefined) {
      const cleanApiKey = stateUpdates.erp_api_key.trim();
      existingCreds.erp_api_key = cleanApiKey;
      topLevelUpdates.erp_api_key = cleanApiKey;
    }
    if (stateUpdates.erp_access_token !== undefined) {
      const rawTok = stateUpdates.erp_access_token.trim();
      const encTok = rawTok ? encryptErpPassword(rawTok, tenantId) : "";
      existingCreds.erp_access_token_enc = encTok;
      delete existingCreds.erp_access_token;
      topLevelUpdates.erp_access_token = encTok;
    }
    if (stateUpdates.erp_token_expiration !== undefined) {
      existingCreds.erp_token_expiration = stateUpdates.erp_token_expiration;
      topLevelUpdates.erp_token_expiration = stateUpdates.erp_token_expiration || null;
    }
    if (stateUpdates.last_product_sync !== undefined) {
      existingCreds.last_product_sync = stateUpdates.last_product_sync;
      topLevelUpdates.last_product_sync = stateUpdates.last_product_sync || null;
    }
    if (stateUpdates.last_customer_sync !== undefined) {
      existingCreds.last_customer_sync = stateUpdates.last_customer_sync;
      topLevelUpdates.last_customer_sync = stateUpdates.last_customer_sync || null;
    }

    existingCreds.updated_at = new Date().toISOString();
    existingBanners._erpCredentials = existingCreds;
    topLevelUpdates.smart_banners = existingBanners;

    const { error } = await supabaseClient
      .from("tenants")
      .update(topLevelUpdates)
      .eq("id", tenantId);

    if (error && (error.code === "42703" || error.message?.includes("does not exist") || error.message?.includes("schema cache"))) {
      const safeFallbackUpdates: Record<string, any> = {
        smart_banners: existingBanners,
      };
      if (topLevelUpdates.erp_url) safeFallbackUpdates.erp_url = topLevelUpdates.erp_url;
      if (topLevelUpdates.cnpj) safeFallbackUpdates.cnpj = topLevelUpdates.cnpj;
      await supabaseClient
        .from("tenants")
        .update(safeFallbackUpdates)
        .eq("id", tenantId);
    }
  } catch (err) {
    console.warn("[Inovafarma] Aviso ao persistir estado do ERP no tenant:", err);
  }
}

/**
 * Constrói e valida os headers obrigatórios para requisições à API do Inovafarma (Portal PS):
 * - Authorization: Bearer <accessToken>
 * - cnpj: <erp_cnpj> (obrigatório nas rotas GET)
 * - ApiKey: <erp_api_key> (se configurado no credenciamento)
 */
export function buildInovafarmaHeaders(
  token: string,
  cnpj: string,
  apiKey?: string,
  options?: { includeCnpjHeader?: boolean },
): Record<string, string> {
  const cleanToken = (token || "").trim();
  if (!cleanToken) {
    throw new Error(
      "Header 'Authorization' (Bearer Token) é obrigatório para comunicar com a API do Inovafarma. Configure o Login/Senha da API ou o Token de Integração da farmácia.",
    );
  }

  const includeCnpj = options?.includeCnpjHeader !== false;
  const cleanCnpj = sanitizeCnpj(cnpj);
  if (includeCnpj && (!cleanCnpj || cleanCnpj.length < 11)) {
    throw new Error(
      "Header 'cnpj' é obrigatório em todas as requisições para a API do Inovafarma. Cadastre um CNPJ válido nas configurações da farmácia.",
    );
  }

  const bearerValue = cleanToken.toLowerCase().startsWith("bearer ")
    ? cleanToken
    : `Bearer ${cleanToken}`;
  const rawTokenValue = cleanToken.replace(/^Bearer\s+/i, "").trim();
  const cleanApiKey = (apiKey || "").trim();

  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: bearerValue,
    ...(cleanCnpj
      ? {
          cnpj: cleanCnpj,
          "x-cnpj": cleanCnpj,
        }
      : {}),
    ...(cleanApiKey ? { ApiKey: cleanApiKey } : {}),
    "x-api-key": cleanApiKey || rawTokenValue,
  };
}

/**
 * Verifica se o token salvo em cache (`erp_access_token`) ainda está válido e longe de expirar (margem de 12h)
 */
export function isCachedInovafarmaTokenValid(
  accessToken?: string | null,
  tokenExpiration?: string | null,
): boolean {
  const cleanToken = String(accessToken || "").trim();
  if (!cleanToken) return false;
  const expStr = String(tokenExpiration || "").trim();
  if (!expStr) return false;

  const expTime = new Date(expStr).getTime();
  if (Number.isNaN(expTime)) return false;

  const safetyMarginMs = 12 * 60 * 60 * 1000; // 12 horas antes de expirar
  return Date.now() + safetyMarginMs < expTime;
}

/**
 * Autentica na API do Inovafarma (`POST /api/login`) buscando dinamicamente o login e a senha
 * salvos no cadastro da farmácia específica (`tenant_id`) para gerar o `accessToken` (válido por 30 dias).
 * Reutiliza o token em cache (`erp_access_token`) enquanto estiver válido, a menos que `forceRefresh: true` seja passado.
 */
export async function authenticateInovafarma(params: {
  supabaseClient?: SupabaseClient;
  tenantId?: string;
  baseUrl?: string;
  routeId?: string;
  cnpj?: string;
  login?: string;
  password?: string;
  apiKey?: string;
  forceRefresh?: boolean;
}): Promise<{
  accessToken: string;
  tokenExpiration: string;
  endpointUsed: string;
  fromCache?: boolean;
}> {
  let effectiveLogin = (params.login || "").trim();
  let effectivePassword =
    params.password && !isMaskedErpPassword(params.password)
      ? String(params.password).trim()
      : "";
  let effectiveBaseUrl = (params.baseUrl || "").trim();
  let effectiveRouteId = (params.routeId || "").trim();
  let effectiveCnpj = sanitizeCnpj(params.cnpj || "");
  let effectiveApiKey = (params.apiKey || "").trim();
  let cachedToken = "";
  let cachedExpiration = "";

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
      const cfg = extractTenantErpConfig(tenantRow);
      if (!effectiveLogin) effectiveLogin = cfg.erp_login;
      if (!effectivePassword) effectivePassword = cfg.erp_password;
      if (!effectiveBaseUrl) effectiveBaseUrl = cfg.erp_base_url;
      if (!effectiveRouteId) effectiveRouteId = cfg.erp_route_id;
      if (!effectiveCnpj) effectiveCnpj = cfg.erp_cnpj;
      if (!effectiveApiKey) effectiveApiKey = cfg.erp_api_key;
      cachedToken = cfg.erp_access_token;
      cachedExpiration = cfg.erp_token_expiration;
    }
  }

  // Reutiliza o token salvo durante os 30 dias de validade se não for forçada renovação
  if (
    !params.forceRefresh &&
    !params.password &&
    isCachedInovafarmaTokenValid(cachedToken, cachedExpiration)
  ) {
    return {
      accessToken: cachedToken,
      tokenExpiration: cachedExpiration,
      endpointUsed: "cached_erp_access_token",
      fromCache: true,
    };
  }

  if (!effectiveLogin || !effectivePassword) {
    throw new Error(
      "Credenciais de Login da API e Senha da API não encontradas para esta farmácia. Configure o 'Login da API' e a 'Senha da API' no painel da drogaria.",
    );
  }

  const rawBase = (effectiveBaseUrl || INOVAFARMA_DEFAULT_API_URL).trim();
  const cleanBase = rawBase.replace(/\/+$/, "");
  const cleanRoute = (effectiveRouteId || INOVAFARMA_DEFAULT_ROUTE_ID)
    .trim()
    .replace(/^\/+|\/+$/g, "");

  const candidateUrls: string[] = [];
  try {
    const parsed = new URL(cleanBase);
    const origin = parsed.origin;
    const basePath =
      parsed.pathname && parsed.pathname !== "/" ? parsed.pathname.replace(/\/+$/, "") : "";
    const loginPaths = [
      "/api/login",
      `/api/v1/${cleanRoute}/login`,
      "/login",
      "/v1/login",
      "/api/v1/login",
    ];

    for (const p of loginPaths) {
      if (basePath && !basePath.toLowerCase().endsWith(p.toLowerCase())) {
        const candidate = `${origin}${basePath}${p}`;
        if (!candidateUrls.includes(candidate)) candidateUrls.push(candidate);
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
    ...(effectiveApiKey ? { ApiKey: effectiveApiKey } : {}),
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

        // Verifica regra crítica do Inovafarma: HTTP 200 com { sucesso: false, mensagem: "..." }
        if (
          data &&
          typeof data === "object" &&
          !Array.isArray(data) &&
          (data.sucesso === false || data.Sucesso === false)
        ) {
          const apiMsg =
            data.mensagem || data.Mensagem || data.erro || data.message || "Falha de autenticação no Inovafarma";
          errors.push(`${endpoint} -> ${apiMsg}`);
          break;
        }

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
          const cleanAccessToken = String(extractedToken).replace(/^Bearer\s+/i, "").trim();

          // Calcula validade de 30 dias (ou usa data de expiração retornada pela API)
          let expirationIso = new Date(
            Date.now() + INOVAFARMA_TOKEN_VALIDITY_DAYS * 24 * 60 * 60 * 1000,
          ).toISOString();
          const rawExp =
            data?.expiration ||
            data?.expiresAt ||
            data?.dataExpiracao ||
            data?.validade ||
            data?.data?.expiration;
          if (rawExp) {
            const parsedExp = new Date(rawExp);
            if (!Number.isNaN(parsedExp.getTime()) && parsedExp.getTime() > Date.now()) {
              expirationIso = parsedExp.toISOString();
            }
          }

          if (params.supabaseClient && params.tenantId) {
            await saveTenantInovafarmaState(params.supabaseClient, params.tenantId, {
              erp_access_token: cleanAccessToken,
              erp_token_expiration: expirationIso,
            });
          }

          return {
            accessToken: cleanAccessToken,
            tokenExpiration: expirationIso,
            endpointUsed: endpoint,
            fromCache: false,
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
 * Resolve dinamicamente as credenciais e obtém (ou reutiliza dos 30 dias de validade) o `accessToken`
 * via `POST /api/login` para uma farmácia específica (`tenantId`).
 */
export async function resolveTenantInovafarmaToken(params: {
  supabaseClient: SupabaseClient;
  tenantId: string;
  baseUrlOverride?: string;
  routeIdOverride?: string;
  cnpjOverride?: string;
  tokenOverride?: string;
  loginOverride?: string;
  passwordOverride?: string;
  apiKeyOverride?: string;
  forceRefresh?: boolean;
}): Promise<{
  token: string;
  tokenExpiration?: string;
  cnpj: string;
  baseUrl: string;
  routeId: string;
  apiKey: string;
  authMethod: "api_login" | "cached_token" | "integration_token";
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

  const cfg = extractTenantErpConfig(tenant);

  const baseUrl = (params.baseUrlOverride || cfg.erp_base_url || INOVAFARMA_DEFAULT_API_URL).trim();
  const routeId = (params.routeIdOverride || cfg.erp_route_id || INOVAFARMA_DEFAULT_ROUTE_ID)
    .trim()
    .replace(/^\/+|\/+$/g, "");
  const cnpj = sanitizeCnpj(params.cnpjOverride || cfg.erp_cnpj || "");
  const apiKey = (params.apiKeyOverride ?? cfg.erp_api_key ?? "").trim();

  const loginToUse = (params.loginOverride || cfg.erp_login).trim();
  const passwordToUse =
    params.passwordOverride && !isMaskedErpPassword(params.passwordOverride)
      ? String(params.passwordOverride).trim()
      : cfg.erp_password;

  // 1. Reutiliza o token salvo em cache se válido (30 dias) e não for forçada renovação
  if (
    !params.forceRefresh &&
    !params.passwordOverride &&
    isCachedInovafarmaTokenValid(cfg.erp_access_token, cfg.erp_token_expiration)
  ) {
    return {
      token: cfg.erp_access_token,
      tokenExpiration: cfg.erp_token_expiration,
      cnpj,
      baseUrl,
      routeId,
      apiKey,
      authMethod: "cached_token",
      tenant,
    };
  }

  // 2. Autentica em POST /api/login se houver Login e Senha configurados
  if (loginToUse && passwordToUse) {
    const authResult = await authenticateInovafarma({
      supabaseClient: params.supabaseClient,
      tenantId: params.tenantId,
      baseUrl,
      routeId,
      cnpj,
      login: loginToUse,
      password: passwordToUse,
      apiKey,
      forceRefresh: true,
    });
    return {
      token: authResult.accessToken,
      tokenExpiration: authResult.tokenExpiration,
      cnpj,
      baseUrl,
      routeId,
      apiKey,
      authMethod: "api_login",
      tenant,
    };
  }

  // 3. Fallback para token manual / cached token caso Login/Senha não estejam preenchidos
  const fallbackToken = (
    params.tokenOverride ||
    cfg.erp_access_token ||
    tenant.integration_token ||
    ""
  ).trim();

  return {
    token: fallbackToken,
    tokenExpiration: cfg.erp_token_expiration || undefined,
    cnpj,
    baseUrl,
    routeId,
    apiKey,
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
 * Calcula intervalo padrão de datas AAAA-MM-DD (janela máxima de 31 dias) a partir de um watermark opcional
 */
export function deriveInovafarmaDateRange(
  inicial?: string,
  final?: string,
  watermarkIsoOrDate?: string,
): { inicial: string; final: string } {
  const todayStr = new Date().toISOString().slice(0, 10);
  const endStr = (final || "").trim().slice(0, 10) || todayStr;

  let startStr = (inicial || "").trim().slice(0, 10);
  if (!startStr && watermarkIsoOrDate) {
    const matchDate = String(watermarkIsoOrDate).trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (matchDate) {
      startStr = matchDate[1];
    }
  }

  if (!startStr) {
    const d = new Date(`${endStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 7);
    startStr = d.toISOString().slice(0, 10);
  }

  // Garante janela máxima de 31 dias exigida pelo Inovafarma para não estourar erro
  const startDate = new Date(`${startStr}T00:00:00Z`);
  const endDate = new Date(`${endStr}T00:00:00Z`);
  if (!Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime())) {
    if (startDate.getTime() > endDate.getTime()) {
      startStr = endStr;
    } else {
      const diffDays = Math.round(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (diffDays > INOVAFARMA_MAX_DATE_WINDOW_DAYS) {
        const clampedStart = new Date(endDate.getTime());
        clampedStart.setUTCDate(clampedStart.getUTCDate() - INOVAFARMA_MAX_DATE_WINDOW_DAYS);
        startStr = clampedStart.toISOString().slice(0, 10);
      }
    }
  }

  return { inicial: startStr, final: endStr };
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
  const startStr = (inicial || "").trim().slice(0, 10);
  const endStr = (final || "").trim().slice(0, 10);

  if (!startStr || !endStr) {
    throw new Error(
      "Os parâmetros de data 'inicial' e 'final' (formato AAAA-MM-DD) são obrigatórios nas rotas /produtosalterados e /clientesalterados para evitar erro de variável escalar @INICIAL.",
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
 * Normaliza um item bruto retornado pela API Pública de E-commerce v1 do Inovafarma (Portal PS):
 * - Salva obrigatoriamente o `CODIGOPRODUTO` (`internalCode` / `erpProductId`)
 * - Trata `EANADICIONAL` preservando o `CODIGOPRODUTO`
 * - Usa `MENORPRECOVENDA` como preço final de venda (`price`) e `PRECOVENDA` como preço "De" (`originalPrice`) quando maior
 * - Copia `UNIDADEMEDIDA` (2 ou 3 caracteres: `UN`, `CX`, etc.)
 */
export function normalizeInovafarmaProduct(
  raw: InovafarmaRawProduct,
): NormalizedInovafarmaProduct | null {
  if (!raw || typeof raw !== "object") return null;

  const rawEan =
    raw.CODIGOBARRAS ??
    raw.ean ??
    raw.codigoBarras ??
    raw.codBarras ??
    raw.codigo_barras ??
    raw.gtin ??
    raw.barcode ??
    raw.ean13 ??
    "";

  const rawCodigoProduto =
    raw.CODIGOPRODUTO ??
    raw.codigoProduto ??
    raw.codigo_produto ??
    raw.codProduto ??
    raw.codigoInterno ??
    raw.codigo_interno ??
    raw.codigo ??
    raw.idProduto ??
    raw.sku ??
    raw.id ??
    "";

  const rawEanAdicional =
    raw.EANADICIONAL ?? raw.eanAdicional ?? raw.ean_adicional ?? null;

  const additionalEans: string[] = [];
  if (Array.isArray(rawEanAdicional)) {
    for (const item of rawEanAdicional) {
      const cleaned = sanitizeInovafarmaEan(item);
      if (cleaned && !additionalEans.includes(cleaned)) {
        additionalEans.push(cleaned);
      }
    }
  } else if (rawEanAdicional !== null && rawEanAdicional !== undefined) {
    const parts = String(rawEanAdicional).split(/[;,|\s]+/);
    for (const part of parts) {
      const cleaned = sanitizeInovafarmaEan(part);
      if (cleaned && !additionalEans.includes(cleaned)) {
        additionalEans.push(cleaned);
      }
    }
  }

  const primaryBarcode = sanitizeInovafarmaEan(rawEan) || additionalEans[0] || "";
  const erpProductId = String(rawCodigoProduto ?? "").trim();
  const internalCode = erpProductId || primaryBarcode;

  if (!primaryBarcode && !internalCode) {
    return null;
  }

  const rawName =
    raw.DESCRICAO ??
    raw.NOME ??
    raw.nome ??
    raw.descricao ??
    raw.nomeProduto ??
    raw.descricaoProduto ??
    raw.produto ??
    raw.name ??
    raw.title ??
    "";

  const name = String(rawName ?? "").trim();
  const finalName = name || `Produto (${primaryBarcode || internalCode})`;

  const unitMeasure = normalizeUnidadeMedida(
    raw.UNIDADEMEDIDA ??
      raw.unidadeMedida ??
      raw.unidade_medida ??
      raw.unidade ??
      "UN",
  );

  const rawPrecoVenda =
    raw.PRECOVENDA ??
    raw.precoVenda ??
    raw.preco_venda ??
    raw.valorVenda ??
    raw.preco ??
    raw.valor ??
    raw.price ??
    raw.salePrice;

  const rawMenorPrecoVenda =
    raw.MENORPRECOVENDA ??
    raw.menorPrecoVenda ??
    raw.menor_preco_venda;

  const rawPromo =
    raw.PRECOPROMOCIONAL ??
    raw.precoPromocional ??
    raw.preco_promocional ??
    raw.valorPromocao ??
    raw.precoOferta ??
    raw.promotionalPrice;

  const rawCost =
    raw.PRECOCUSTO ??
    raw.precoCusto ??
    raw.preco_custo ??
    raw.valorCusto ??
    raw.custo ??
    raw.costPrice;

  const rawStock =
    raw.ESTOQUE ??
    raw.SALDOESTOQUE ??
    raw.estoque ??
    raw.saldo ??
    raw.saldoEstoque ??
    raw.qtdEstoque ??
    raw.quantidade ??
    raw.estoqueAtual ??
    raw.stock ??
    raw.qty;

  const precoVendaVal = Math.max(0, roundCurrency(parseInovafarmaNumber(rawPrecoVenda, 0)));
  const menorPrecoVal = Math.max(0, roundCurrency(parseInovafarmaNumber(rawMenorPrecoVenda, 0)));
  const promoExplicitVal = parseInovafarmaNumber(rawPromo, -1);
  const costPriceVal = parseInovafarmaNumber(rawCost, -1);
  const costPrice = costPriceVal >= 0 ? roundCurrency(costPriceVal) : null;

  // Regra Inovafarma v1: Utilize MENORPRECOVENDA como preço final de venda e PRECOVENDA como preço "De" quando maior
  let finalSellingPrice = menorPrecoVal > 0 ? menorPrecoVal : precoVendaVal;
  let originalCompareAtPrice: number | null = null;
  let promotionalPrice: number | null = null;

  if (menorPrecoVal > 0 && precoVendaVal > menorPrecoVal) {
    finalSellingPrice = menorPrecoVal;
    originalCompareAtPrice = precoVendaVal;
  } else if (promoExplicitVal > 0 && precoVendaVal > promoExplicitVal) {
    finalSellingPrice = promoExplicitVal;
    originalCompareAtPrice = precoVendaVal;
    promotionalPrice = roundCurrency(promoExplicitVal);
  }

  if (finalSellingPrice === 0 && costPrice !== null && costPrice > 0) {
    finalSellingPrice = roundCurrency(costPrice * 1.5);
  }

  const stock = Math.max(0, Math.floor(parseInovafarmaNumber(rawStock, 0)));

  const category =
    String(
      raw.CATEGORIA ??
        raw.GRUPO ??
        raw.SECAO ??
        raw.categoria ??
        raw.departamento ??
        raw.grupo ??
        raw.secao ??
        raw.category ??
        "Geral",
    ).trim() || "Geral";

  const manufacturer = String(
    raw.FABRICANTE ??
      raw.LABORATORIO ??
      raw.fabricante ??
      raw.laboratorio ??
      raw.marca ??
      "",
  ).trim();

  const activeIngredient = String(
    raw.PRINCIPIOATIVO ??
      raw.principioAtivo ??
      raw.principio_ativo ??
      raw.substancia ??
      "",
  ).trim();

  const updatedAtErp = String(
    raw.DATAATUALIZACAOPRODUTO ??
      raw.dataAtualizacaoProduto ??
      raw.data_atualizacao_produto ??
      "",
  ).trim();

  return {
    barcode: primaryBarcode || internalCode,
    internalCode: internalCode || primaryBarcode,
    erpProductId: erpProductId || internalCode || primaryBarcode,
    additionalEans,
    unitMeasure,
    name: finalName,
    price: finalSellingPrice,
    originalPrice: originalCompareAtPrice,
    promotionalPrice,
    costPrice,
    stock,
    category,
    manufacturer: manufacturer || undefined,
    activeIngredient: activeIngredient || undefined,
    updatedAtErp: updatedAtErp || undefined,
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
      "metodosPagamentos",
      "metodospagamentos",
      "formasPagamento",
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
  queryParams?: Record<string, string | number | undefined>,
): string {
  const url = new URL(baseEndpoint);
  if (queryParams) {
    for (const [key, val] of Object.entries(queryParams)) {
      if (val !== undefined && val !== null && String(val) !== "") {
        url.searchParams.set(key, String(val));
      }
    }
  }
  return url.toString();
}

/**
 * Constrói a lista priorizada de URLs candidatas para um recurso da API Pública v1 do Inovafarma:
 * Padrão oficial: `{erp_base_url}/api/v1/{erp_route_id}/{resourcePath}`
 */
export function buildInovafarmaCandidateUrls(params: {
  baseUrl?: string;
  routeId?: string;
  resourcePaths: string[];
}): string[] {
  const rawBase = (params.baseUrl || INOVAFARMA_DEFAULT_API_URL).trim();
  const cleanBase = rawBase.replace(/\/+$/, "");
  const cleanRoute = (params.routeId || INOVAFARMA_DEFAULT_ROUTE_ID)
    .trim()
    .replace(/^\/+|\/+$/g, "");

  const candidateUrls: string[] = [];
  const addUnique = (u: string) => {
    if (u && !candidateUrls.includes(u)) candidateUrls.push(u);
  };

  try {
    const parsed = new URL(cleanBase);
    const origin = parsed.origin;
    const basePath =
      parsed.pathname && parsed.pathname !== "/" ? parsed.pathname.replace(/\/+$/, "") : "";

    for (const rawPath of params.resourcePaths) {
      const cleanResource = rawPath.replace(/^\/+/, "");
      // 1. Se basePath já inclui /api/v1/{rota}
      if (basePath) {
        if (basePath.toLowerCase().endsWith(`/${cleanResource.toLowerCase()}`)) {
          addUnique(`${origin}${basePath}`);
        } else {
          addUnique(`${origin}${basePath}/${cleanResource}`);
        }
      }
      // 2. Rota oficial da API Pública v1: /api/v1/{integracao}/{recurso}
      if (cleanRoute && !cleanResource.toLowerCase().startsWith("api/v1/")) {
        addUnique(`${origin}/api/v1/${cleanRoute}/${cleanResource}`);
      }
      // 3. Fallbacks diretos para servidores mock ou legados
      addUnique(`${origin}/${cleanResource}`);
      if (!cleanResource.toLowerCase().startsWith("api/")) {
        addUnique(`${origin}/api/${cleanResource}`);
        addUnique(`${origin}/api/v1/${cleanResource}`);
      }
    }
  } catch {
    for (const rawPath of params.resourcePaths) {
      const cleanResource = rawPath.replace(/^\/+/, "");
      addUnique(`${INOVAFARMA_DEFAULT_API_URL}/api/v1/${cleanRoute}/${cleanResource}`);
      addUnique(`${INOVAFARMA_DEFAULT_API_URL}/${cleanResource}`);
    }
  }

  return candidateUrls;
}

/**
 * WRAPPER HTTP GLOBAL E TRATAMENTO DE ERROS DO INOVAFARMA (Portal PS v1):
 * - Injeta automaticamente `Authorization: Bearer <accessToken>`, `cnpj: <erp_cnpj>` e `ApiKey: <erp_api_key>` (se configurado).
 * - Trata HTTP 204 como "Sem resultados" (retornando `empty: true` e `data: null`), nunca como erro.
 * - Trata HTTP 401 renovando o token automaticamente em `POST /api/login` e refazendo a chamada.
 * - Trata HTTP 429 aguardando 60 segundos (ou `rateLimitWaitMs`) antes de tentar novamente.
 * - Verifica se o JSON retornado em HTTP 200 possui `{ sucesso: false, mensagem: "..." }`. Se possuir, grava no log de integração e dispara erro claro com a `mensagem` da API.
 */
export async function inovafarmaHttpRequest<T = any>(params: {
  method: "GET" | "POST";
  baseUrl?: string;
  routeId?: string;
  token: string;
  cnpj: string;
  apiKey?: string;
  resourcePaths: string[];
  queryParams?: Record<string, string | number | undefined>;
  body?: any;
  supabaseClient?: SupabaseClient;
  tenantId?: string;
  login?: string;
  password?: string;
  rateLimitWaitMs?: number;
  timeoutMs?: number;
}): Promise<{
  status: number;
  data: T | null;
  empty: boolean;
  endpointUsed: string;
  refreshedToken?: string;
}> {
  let currentToken = (params.token || "").trim();
  const cleanCnpj = sanitizeCnpj(params.cnpj);
  const candidateEndpoints = buildInovafarmaCandidateUrls({
    baseUrl: params.baseUrl,
    routeId: params.routeId,
    resourcePaths: params.resourcePaths,
  });

  const errors: string[] = [];
  let hasRetried401 = false;
  let refreshedToken: string | undefined;

  for (let i = 0; i < candidateEndpoints.length; i++) {
    const baseEndpoint = candidateEndpoints[i];
    const fullUrl = buildUrlWithQueryParams(baseEndpoint, params.queryParams);
    const headers = buildInovafarmaHeaders(currentToken, cleanCnpj, params.apiKey, {
      includeCnpjHeader: true,
    });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs ?? 25000);

      let response = await fetch(fullUrl, {
        method: params.method,
        headers,
        ...(params.method === "POST" && params.body !== undefined
          ? { body: JSON.stringify(params.body) }
          : {}),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // Tratamento de Rate Limit HTTP 429: aguarda 60 segundos antes de tentar novamente
      if (response.status === 429) {
        const waitMs = params.rateLimitWaitMs ?? 60000;
        console.warn(
          `[Inovafarma HTTP 429] Rate limit atingido em ${fullUrl}. Aguardando ${Math.round(waitMs / 1000)}s antes de tentar novamente...`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));

        const retryController = new AbortController();
        const retryTimeout = setTimeout(() => retryController.abort(), params.timeoutMs ?? 25000);
        response = await fetch(fullUrl, {
          method: params.method,
          headers,
          ...(params.method === "POST" && params.body !== undefined
            ? { body: JSON.stringify(params.body) }
            : {}),
          signal: retryController.signal,
        });
        clearTimeout(retryTimeout);
      }

      // Tratamento de Token Expirado HTTP 401: renova automaticamente em POST /api/login e refaz a chamada
      if (
        response.status === 401 &&
        !hasRetried401 &&
        ((params.supabaseClient && params.tenantId) || (params.login && params.password))
      ) {
        hasRetried401 = true;
        try {
          const reAuth = await authenticateInovafarma({
            supabaseClient: params.supabaseClient,
            tenantId: params.tenantId,
            baseUrl: params.baseUrl,
            routeId: params.routeId,
            cnpj: cleanCnpj,
            login: params.login,
            password: params.password,
            apiKey: params.apiKey,
            forceRefresh: true,
          });
          currentToken = reAuth.accessToken;
          refreshedToken = reAuth.accessToken;
          // Repete a mesma URL com o novo token recém-gerado
          i--;
          continue;
        } catch (reAuthErr: any) {
          errors.push(`Renovação 401 falhou: ${reAuthErr?.message || "Não autorizado"}`);
        }
      }

      // Tratamento de HTTP 204 (No Content): significa "Sem resultados", NUNCA um erro
      if (response.status === 204) {
        return {
          status: 204,
          data: null,
          empty: true,
          endpointUsed: fullUrl,
          refreshedToken,
        };
      }

      const contentType = response.headers.get("content-type") || "";
      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        errors.push(
          `${fullUrl} -> HTTP ${response.status}${errText ? ` (${errText.slice(0, 140)})` : ""}`,
        );
        continue;
      }

      if (contentType.includes("text/html")) {
        errors.push(`${fullUrl} -> Retornou página HTML de documentação em vez de JSON da API`);
        continue;
      }

      const rawText = await response.text();
      if (!rawText || !rawText.trim()) {
        return {
          status: 204,
          data: null,
          empty: true,
          endpointUsed: fullUrl,
          refreshedToken,
        };
      }

      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch {
        errors.push(`${fullUrl} -> Resposta não é um JSON válido`);
        continue;
      }

      // Regra Crítica do Inovafarma: HTTP 200 NÃO significa sucesso garantido!
      // Erros de consulta, parâmetros ausentes (@INICIAL) e vendas rejeitadas retornam HTTP 200 com { sucesso: false, mensagem: "..." }
      if (
        data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        (data.sucesso === false || data.Sucesso === false)
      ) {
        const apiErrorMessage = String(
          data.mensagem ||
            data.Mensagem ||
            data.erro ||
            data.message ||
            "A API do Inovafarma rejeitou a operação (sucesso: false).",
        ).trim();

        if (params.supabaseClient && params.tenantId) {
          try {
            await params.supabaseClient.from("integration_logs").insert({
              tenant_id: params.tenantId,
              endpoint: fullUrl,
              payload: {
                method: params.method,
                queryParams: params.queryParams,
                requestBody: params.body,
                erpResponse: data,
              },
              status: "FAILED",
              error_message: apiErrorMessage,
            });
          } catch (_) {}
        }

        throw new Error(`Erro retornado pelo Inovafarma: ${apiErrorMessage}`);
      }

      return {
        status: response.status,
        data: data as T,
        empty: false,
        endpointUsed: fullUrl,
        refreshedToken,
      };
    } catch (err: any) {
      if (err?.message?.startsWith("Erro retornado pelo Inovafarma:")) {
        throw err;
      }
      errors.push(`${fullUrl} -> ${err?.message || "Falha de conexão"}`);
    }
  }

  const finalErrorMsg = `Não foi possível consultar a API do Inovafarma (Portal PS). Verifique se a URL Base, a Rota ({integracao}), o CNPJ (${cleanCnpj}) e as credenciais estão ativos. Detalhes: ${errors.slice(0, 3).join(" | ")}`;
  if (params.supabaseClient && params.tenantId) {
    try {
      await params.supabaseClient.from("integration_logs").insert({
        tenant_id: params.tenantId,
        endpoint: params.resourcePaths[0] || "/inovafarma",
        payload: {
          method: params.method,
          queryParams: params.queryParams,
          errors: errors.slice(0, 5),
        },
        status: "FAILED",
        error_message: finalErrorMsg,
      });
    } catch (_) {}
  }
  throw new Error(finalErrorMsg);
}

/**
 * Executa requisição GET autenticada para endpoints de listagem do Inovafarma,
 * tratando HTTP 204 como lista vazia `[]`.
 */
async function performInovafarmaGet<T = any>(params: {
  baseUrl?: string;
  routeId?: string;
  token: string;
  cnpj: string;
  apiKey?: string;
  paths: string[];
  queryParams?: Record<string, string | number | undefined>;
  supabaseClient?: SupabaseClient;
  tenantId?: string;
  login?: string;
  password?: string;
  rateLimitWaitMs?: number;
}): Promise<{ items: T[]; endpointUsed: string; status: number; refreshedToken?: string }> {
  const res = await inovafarmaHttpRequest<any>({
    method: "GET",
    baseUrl: params.baseUrl,
    routeId: params.routeId,
    token: params.token,
    cnpj: params.cnpj,
    apiKey: params.apiKey,
    resourcePaths: params.paths,
    queryParams: params.queryParams,
    supabaseClient: params.supabaseClient,
    tenantId: params.tenantId,
    login: params.login,
    password: params.password,
    rateLimitWaitMs: params.rateLimitWaitMs,
  });

  if (res.empty || res.status === 204 || res.data === null) {
    return {
      items: [],
      endpointUsed: res.endpointUsed,
      status: 204,
      refreshedToken: res.refreshedToken,
    };
  }

  const extracted = extractArrayFromInovafarmaResponse<T>(res.data);
  if (extracted) {
    return {
      items: extracted,
      endpointUsed: res.endpointUsed,
      status: res.status,
      refreshedToken: res.refreshedToken,
    };
  }

  if (typeof res.data === "object") {
    return {
      items: [res.data as T],
      endpointUsed: res.endpointUsed,
      status: res.status,
      refreshedToken: res.refreshedToken,
    };
  }

  return {
    items: [],
    endpointUsed: res.endpointUsed,
    status: res.status,
    refreshedToken: res.refreshedToken,
  };
}

/**
 * Testa a conectividade oficial com o servidor do Inovafarma (`GET /api/v1/{integracao}/server`):
 * Deve retornar HTTP 200 com array.
 */
export async function checkInovafarmaServerConnectivity(params: {
  baseUrl?: string;
  routeId?: string;
  token: string;
  cnpj: string;
  apiKey?: string;
  supabaseClient?: SupabaseClient;
  tenantId?: string;
  login?: string;
  password?: string;
}): Promise<{
  connected: boolean;
  status: number;
  endpointUsed: string;
  serverInfo: any[];
  message: string;
}> {
  const { items, endpointUsed, status } = await performInovafarmaGet<any>({
    baseUrl: params.baseUrl,
    routeId: params.routeId,
    token: params.token,
    cnpj: params.cnpj,
    apiKey: params.apiKey,
    paths: ["server"],
    supabaseClient: params.supabaseClient,
    tenantId: params.tenantId,
    login: params.login,
    password: params.password,
  });

  const isConnected = status === 200 && Array.isArray(items);
  return {
    connected: isConnected,
    status,
    endpointUsed,
    serverInfo: items || [],
    message: isConnected
      ? `Conectividade com Inovafarma (/server) validada com sucesso (HTTP ${status}).`
      : `Servidor respondeu com HTTP ${status} sem array ativo.`,
  };
}

/**
 * Busca produtos paginados (`GET /api/v1/{integracao}/produtos?offset=1&limit=500`):
 * - `offset` começa em 1 e avança somando `limit` (+500) a cada página até receber HTTP 204 ou array vazio.
 */
export async function fetchInovafarmaProducts(params: {
  baseUrl?: string;
  routeId?: string;
  token: string;
  cnpj: string;
  apiKey?: string;
  offset?: number;
  limit?: number;
  fetchAllPages?: boolean;
  supabaseClient?: SupabaseClient;
  tenantId?: string;
  login?: string;
  password?: string;
}): Promise<{
  products: InovafarmaRawProduct[];
  endpointUsed: string;
  highestUpdatedAt?: string;
}> {
  const { offset: initialOffset, limit } = normalizeInovafarmaPagination(
    params.offset,
    params.limit,
  );
  const fetchAll = params.fetchAllPages !== false && params.offset === undefined;

  const allProducts: InovafarmaRawProduct[] = [];
  let currentOffset = initialOffset;
  let lastEndpointUsed = "";
  let currentToken = params.token;
  let highestUpdatedAt = "";
  const MAX_PAGES = 50; // Até 25.000 itens com limit=500

  for (let page = 0; page < MAX_PAGES; page++) {
    const { items, endpointUsed, status, refreshedToken } =
      await performInovafarmaGet<InovafarmaRawProduct>({
        baseUrl: params.baseUrl,
        routeId: params.routeId,
        token: currentToken,
        cnpj: params.cnpj,
        apiKey: params.apiKey,
        paths: ["produtos"],
        queryParams: {
          offset: currentOffset,
          limit,
        },
        supabaseClient: params.supabaseClient,
        tenantId: params.tenantId,
        login: params.login,
        password: params.password,
      });

    if (refreshedToken) currentToken = refreshedToken;
    lastEndpointUsed = endpointUsed;

    // Para a paginação ao receber HTTP 204 ou array vazio
    if (status === 204 || !items || items.length === 0) {
      break;
    }

    for (const item of items) {
      allProducts.push(item);
      const rawUpdated = String(
        item.DATAATUALIZACAOPRODUTO ??
          item.dataAtualizacaoProduto ??
          item.data_atualizacao_produto ??
          "",
      ).trim();
      if (rawUpdated && (!highestUpdatedAt || rawUpdated > highestUpdatedAt)) {
        highestUpdatedAt = rawUpdated;
      }
    }

    if (!fetchAll || items.length < limit) {
      break;
    }

    // Offset avança somando o limit a cada página (ex: 1 -> 501 -> 1001)
    currentOffset += limit;
  }

  return {
    products: allProducts,
    endpointUsed: lastEndpointUsed,
    highestUpdatedAt: highestUpdatedAt || undefined,
  };
}

/**
 * Busca produtos alterados (`GET /api/v1/{integracao}/produtosalterados?offset=1&limit=500&inicial=AAAA-MM-DD&final=AAAA-MM-DD`):
 * - Sempre envia `inicial` e `final` juntos (janela máx 31 dias) para evitar erro de variável escalar `@INICIAL`.
 * - Retorna a maior `DATAATUALIZACAOPRODUTO` recebida para salvar em `last_product_sync`.
 */
export async function fetchInovafarmaProdutosAlterados(params: {
  baseUrl?: string;
  routeId?: string;
  token: string;
  cnpj: string;
  apiKey?: string;
  inicial?: string;
  final?: string;
  lastProductSyncWatermark?: string;
  offset?: number;
  limit?: number;
  fetchAllPages?: boolean;
  supabaseClient?: SupabaseClient;
  tenantId?: string;
  login?: string;
  password?: string;
}): Promise<{
  products: InovafarmaRawProduct[];
  endpointUsed: string;
  inicialUsed: string;
  finalUsed: string;
  highestUpdatedAt?: string;
}> {
  const derivedDates =
    params.inicial && params.final
      ? { inicial: params.inicial, final: params.final }
      : deriveInovafarmaDateRange(
          params.inicial,
          params.final,
          params.lastProductSyncWatermark,
        );

  const { inicial, final } = validateInovafarmaDateRange(
    derivedDates.inicial,
    derivedDates.final,
  );
  const { offset: initialOffset, limit } = normalizeInovafarmaPagination(
    params.offset,
    params.limit,
  );
  const fetchAll = params.fetchAllPages !== false && params.offset === undefined;

  const allProducts: InovafarmaRawProduct[] = [];
  let currentOffset = initialOffset;
  let lastEndpointUsed = "";
  let currentToken = params.token;
  let highestUpdatedAt = "";
  const MAX_PAGES = 50;

  for (let page = 0; page < MAX_PAGES; page++) {
    const { items, endpointUsed, status, refreshedToken } =
      await performInovafarmaGet<InovafarmaRawProduct>({
        baseUrl: params.baseUrl,
        routeId: params.routeId,
        token: currentToken,
        cnpj: params.cnpj,
        apiKey: params.apiKey,
        paths: ["produtosalterados"],
        queryParams: {
          offset: currentOffset,
          limit,
          inicial,
          final,
        },
        supabaseClient: params.supabaseClient,
        tenantId: params.tenantId,
        login: params.login,
        password: params.password,
      });

    if (refreshedToken) currentToken = refreshedToken;
    lastEndpointUsed = endpointUsed;

    if (status === 204 || !items || items.length === 0) {
      break;
    }

    for (const item of items) {
      allProducts.push(item);
      const rawUpdated = String(
        item.DATAATUALIZACAOPRODUTO ??
          item.dataAtualizacaoProduto ??
          item.data_atualizacao_produto ??
          "",
      ).trim();
      if (rawUpdated && (!highestUpdatedAt || rawUpdated > highestUpdatedAt)) {
        highestUpdatedAt = rawUpdated;
      }
    }

    if (!fetchAll || items.length < limit) {
      break;
    }

    currentOffset += limit;
  }

  return {
    products: allProducts,
    endpointUsed: lastEndpointUsed,
    inicialUsed: inicial,
    finalUsed: final,
    highestUpdatedAt: highestUpdatedAt || undefined,
  };
}

/**
 * Busca clientes (`GET /api/v1/{integracao}/clientes?offset=1&limit=500`)
 */
export async function fetchInovafarmaClientes(params: {
  baseUrl?: string;
  routeId?: string;
  token: string;
  cnpj: string;
  apiKey?: string;
  offset?: number;
  limit?: number;
  supabaseClient?: SupabaseClient;
  tenantId?: string;
}): Promise<{ clientes: any[]; endpointUsed: string; highestUpdatedAt?: string }> {
  const { offset, limit } = normalizeInovafarmaPagination(params.offset, params.limit);
  const { items, endpointUsed } = await performInovafarmaGet<any>({
    baseUrl: params.baseUrl,
    routeId: params.routeId,
    token: params.token,
    cnpj: params.cnpj,
    apiKey: params.apiKey,
    paths: ["clientes"],
    queryParams: { offset, limit },
    supabaseClient: params.supabaseClient,
    tenantId: params.tenantId,
  });

  let highestUpdatedAt = "";
  for (const c of items) {
    const dt = String(
      c?.DATAATUALIZACAOCLIENTE ?? c?.dataAtualizacaoCliente ?? "",
    ).trim();
    if (dt && (!highestUpdatedAt || dt > highestUpdatedAt)) {
      highestUpdatedAt = dt;
    }
  }

  if (highestUpdatedAt && params.supabaseClient && params.tenantId) {
    await saveTenantInovafarmaState(params.supabaseClient, params.tenantId, {
      last_customer_sync: highestUpdatedAt,
    });
  }

  return {
    clientes: items,
    endpointUsed,
    highestUpdatedAt: highestUpdatedAt || undefined,
  };
}

/**
 * Busca clientes alterados (`GET /api/v1/{integracao}/clientesalterados?offset=1&limit=500&inicial=AAAA-MM-DD&final=AAAA-MM-DD`)
 */
export async function fetchInovafarmaClientesAlterados(params: {
  baseUrl?: string;
  routeId?: string;
  token: string;
  cnpj: string;
  apiKey?: string;
  inicial: string;
  final: string;
  offset?: number;
  limit?: number;
  supabaseClient?: SupabaseClient;
  tenantId?: string;
}): Promise<{ clientes: any[]; endpointUsed: string; highestUpdatedAt?: string }> {
  const { inicial, final } = validateInovafarmaDateRange(params.inicial, params.final);
  const { offset, limit } = normalizeInovafarmaPagination(params.offset, params.limit);
  const { items, endpointUsed } = await performInovafarmaGet<any>({
    baseUrl: params.baseUrl,
    routeId: params.routeId,
    token: params.token,
    cnpj: params.cnpj,
    apiKey: params.apiKey,
    paths: ["clientesalterados"],
    queryParams: { offset, limit, inicial, final },
    supabaseClient: params.supabaseClient,
    tenantId: params.tenantId,
  });

  let highestUpdatedAt = "";
  for (const c of items) {
    const dt = String(
      c?.DATAATUALIZACAOCLIENTE ?? c?.dataAtualizacaoCliente ?? "",
    ).trim();
    if (dt && (!highestUpdatedAt || dt > highestUpdatedAt)) {
      highestUpdatedAt = dt;
    }
  }

  if (highestUpdatedAt && params.supabaseClient && params.tenantId) {
    await saveTenantInovafarmaState(params.supabaseClient, params.tenantId, {
      last_customer_sync: highestUpdatedAt,
    });
  }

  return {
    clientes: items,
    endpointUsed,
    highestUpdatedAt: highestUpdatedAt || undefined,
  };
}

/**
 * Busca funcionários/vendedores (`GET /api/v1/{integracao}/funcionarios?offset=1&limit=500`)
 */
export async function fetchInovafarmaFuncionarios(params: {
  baseUrl?: string;
  routeId?: string;
  token: string;
  cnpj: string;
  apiKey?: string;
  offset?: number;
  limit?: number;
  supabaseClient?: SupabaseClient;
  tenantId?: string;
}): Promise<{ funcionarios: InovafarmaFuncionario[]; endpointUsed: string }> {
  const { offset, limit } = normalizeInovafarmaPagination(params.offset, params.limit);
  const { items, endpointUsed } = await performInovafarmaGet<any>({
    baseUrl: params.baseUrl,
    routeId: params.routeId,
    token: params.token,
    cnpj: params.cnpj,
    apiKey: params.apiKey,
    paths: ["funcionarios"],
    queryParams: { offset, limit },
    supabaseClient: params.supabaseClient,
    tenantId: params.tenantId,
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
      const ativo = raw.ativo !== undefined ? Boolean(raw.ativo) : true;
      return { codigoFuncionario, cpf, nome, ativo };
    })
    .filter((f) => Boolean(f.codigoFuncionario || f.cpf));

  return { funcionarios, endpointUsed };
}

/**
 * Consulta o dicionário de métodos de pagamento da loja (`GET /api/v1/{integracao}/metodospagamentos`)
 */
export async function fetchInovafarmaMetodosPagamentos(params: {
  baseUrl?: string;
  routeId?: string;
  token: string;
  cnpj: string;
  apiKey?: string;
  supabaseClient?: SupabaseClient;
  tenantId?: string;
}): Promise<{ metodos: InovafarmaMetodoPagamento[]; endpointUsed: string }> {
  const { items, endpointUsed } = await performInovafarmaGet<any>({
    baseUrl: params.baseUrl,
    routeId: params.routeId,
    token: params.token,
    cnpj: params.cnpj,
    apiKey: params.apiKey,
    paths: ["metodospagamentos"],
    supabaseClient: params.supabaseClient,
    tenantId: params.tenantId,
  });

  const metodos: InovafarmaMetodoPagamento[] = (items || []).map((raw: any) => {
    const codigo = String(
      raw.CODIGO ??
        raw.codigo ??
        raw.CODIGOMETODOPAGAMENTO ??
        raw.formaPagamento ??
        raw.id ??
        "",
    ).trim();
    const descricao = String(
      raw.DESCRICAO ?? raw.descricao ?? raw.NOME ?? raw.nome ?? codigo,
    ).trim();
    const isPixOrCard =
      /pix|cartao|cartão|credito|crédito|debito|débito/i.test(descricao) ||
      String(raw.TIPO ?? raw.tipo ?? "").toUpperCase() === "C";
    const tipo = String(raw.TIPO ?? raw.tipo ?? (isPixOrCard ? "C" : "D"))
      .trim()
      .toUpperCase();

    return {
      codigo: codigo || descricao,
      descricao,
      tipo: tipo === "C" ? "C" : "D",
      formaPagamento: codigo || descricao,
      ativo: raw.ATIVO !== undefined ? Boolean(raw.ATIVO) : true,
    };
  });

  return { metodos, endpointUsed };
}

/**
 * Resolve o método de pagamento seguindo a Regra Oficial do PIX no Inovafarma:
 * - No Inovafarma, o PIX é classificado como Cartão (`tipo: "C"`, `formaPagamento: "PIX"` ou código equivalente em `/metodospagamentos`, ex: `"3"`).
 * - Dinheiro usa `tipo: "D"`, `formaPagamento: "DINHEIRO"` (ou `"1"`).
 */
export function resolveInovafarmaFormaPagamento(
  rawMethod: string,
  metodosCadastrados?: InovafarmaMetodoPagamento[],
  rawTipo?: string,
): { tipo: "D" | "C"; formaPagamento: string } {
  const clean = String(rawMethod || "PIX").trim();
  const upper = clean.toUpperCase();

  const isPix =
    upper.includes("PIX") || upper === "3" || upper.includes("MERCADO PAGO");
  const isCash =
    upper.includes("DINHEIRO") ||
    upper.includes("ESPECIE") ||
    upper.includes("ESPÉCIE") ||
    upper === "1";

  if (Array.isArray(metodosCadastrados) && metodosCadastrados.length > 0) {
    if (isPix) {
      const matchedPix = metodosCadastrados.find(
        (m) =>
          m.descricao.toUpperCase().includes("PIX") ||
          m.codigo.toUpperCase() === "PIX" ||
          m.codigo === "3",
      );
      if (matchedPix) {
        return {
          tipo: "C",
          formaPagamento: matchedPix.formaPagamento || "PIX",
        };
      }
    }
    if (isCash) {
      const matchedCash = metodosCadastrados.find(
        (m) =>
          m.descricao.toUpperCase().includes("DINHEIRO") ||
          m.codigo.toUpperCase() === "DINHEIRO" ||
          m.codigo === "1",
      );
      if (matchedCash) {
        return {
          tipo: "D",
          formaPagamento: matchedCash.formaPagamento || "DINHEIRO",
        };
      }
    }
    const matchedOther = metodosCadastrados.find(
      (m) =>
        m.codigo.toUpperCase() === upper ||
        m.descricao.toUpperCase() === upper,
    );
    if (matchedOther) {
      return {
        tipo: matchedOther.tipo === "C" ? "C" : "D",
        formaPagamento: matchedOther.formaPagamento,
      };
    }
  }

  if (isPix) {
    return {
      tipo: "C",
      formaPagamento: upper === "3" ? "3" : "PIX",
    };
  }

  if (isCash) {
    return {
      tipo: "D",
      formaPagamento: upper === "1" ? "1" : "DINHEIRO",
    };
  }

  const explicitTipo = String(rawTipo || "").trim().toUpperCase();
  return {
    tipo: explicitTipo === "D" ? "D" : "C",
    formaPagamento: upper || "CARTAO",
  };
}

/**
 * Resolve e valida o identificador do `vendedor` para o payload `POST /Venda`:
 * - NUNCA permite enviar um nome no campo `vendedor`
 * - Retorna exclusivamente o CPF (11 dígitos) ou o CODIGOFUNCIONARIO numérico mapeado de `/funcionarios`
 */
export async function resolveInovafarmaVendedor(params: {
  rawSeller?: string | number | null;
  baseUrl?: string;
  routeId?: string;
  token?: string;
  cnpj?: string;
  apiKey?: string;
  funcionariosPreloaded?: InovafarmaFuncionario[];
}): Promise<string> {
  const rawStr = String(params.rawSeller ?? "").trim();

  if (rawStr && !/[a-zA-ZÀ-ÿ]/.test(rawStr)) {
    const digitsOnly = rawStr.replace(/\D+/g, "");
    if (digitsOnly.length > 0) {
      return digitsOnly;
    }
  }

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
        routeId: params.routeId,
        token: params.token,
        cnpj: params.cnpj,
        apiKey: params.apiKey,
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

  return "1";
}

/**
 * Gera um `codigoVendaOnLine` único, determinístico e imutável para deduplicação de pedidos no Inovafarma
 */
export function buildImmutableCodigoVendaOnLine(orderId?: string | number): string {
  const clean = String(orderId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "");
  if (clean) return clean.slice(0, 50);
  return `FF-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

/**
 * Monta e valida o payload oficial do `POST /api/v1/{integracao}/Venda` do Inovafarma (Portal PS):
 * 1. Garante `codigoVendaOnLine` único e imutável e `cnpj` no corpo.
 * 2. Garante que `vendedor` contenha apenas CPF ou CODIGOFUNCIONARIO (nunca nome).
 * 3. Garante que todos os itens possuam `codigoProduto` (`CODIGOPRODUTO`) e `unidadeMedida` (`UN`, `CX`, etc.),
 *    distribuindo qualquer desconto no `descontoUnitario` de cada item (nunca `>= valorUnitario`).
 * 4. Fechamento Financeiro Exato (Centavo a Centavo):
 *    `total = Σ (quantidade * (valorUnitario - descontoUnitario)) + entrega.taxa` arredondado em 2 casas decimais.
 *    A soma de `pagamentos[].valor` DEVE ser exatamente igual ao `total`.
 * 5. Regra do PIX: classifica PIX como Cartão (`tipo: "C"`, `formaPagamento: "PIX"` ou `"3"`).
 * 6. Endereço de Entrega: se `retirarNaLoja` for `false`, valida obrigatoriamente `endereco`, `cep` e `cidade`.
 */
export async function buildInovafarmaVendaPayload(
  input: InovafarmaVendaInput,
  authContext?: {
    baseUrl?: string;
    routeId?: string;
    token?: string;
    cnpj?: string;
    apiKey?: string;
    funcionariosPreloaded?: InovafarmaFuncionario[];
    metodosPagamentoPreloaded?: InovafarmaMetodoPagamento[];
  },
): Promise<InovafarmaVendaPayload> {
  if (!input.itens || !Array.isArray(input.itens) || input.itens.length === 0) {
    throw new Error(
      "O pedido deve conter pelo menos um item para envio ao Inovafarma (POST /Venda).",
    );
  }

  const retirarNaLoja = Boolean(input.retirarNaLoja);
  const rawEndereco = input.cliente?.endereco;
  const logradouro = String(
    rawEndereco?.endereco || rawEndereco?.logradouro || "",
  ).trim();
  const cep = String(rawEndereco?.cep || "").replace(/\D+/g, "").trim();
  const cidade = String(rawEndereco?.cidade || "").trim();

  // Regra 6: Se retirarNaLoja === false, valida obrigatoriamente que endereco, cep e cidade estão preenchidos
  if (!retirarNaLoja && input.cliente?.endereco) {
    if (!logradouro || !cep || !cidade) {
      throw new Error(
        `Para pedidos de entrega (retirarNaLoja: false), os campos 'endereco' (${logradouro || "vazio"}), 'cep' (${cep || "vazio"}) e 'cidade' (${cidade || "vazio"}) são obrigatórios para evitar que o Inovafarma sobrescreva com o endereço da própria farmácia.`,
      );
    }
  }

  // 1. Resolve vendedor (apenas CPF ou CODIGOFUNCIONARIO, nunca nome)
  const vendedorCodigoOuCpf = await resolveInovafarmaVendedor({
    rawSeller: input.vendedor,
    baseUrl: authContext?.baseUrl,
    routeId: authContext?.routeId,
    token: authContext?.token,
    cnpj: authContext?.cnpj || input.cnpj,
    apiKey: authContext?.apiKey,
    funcionariosPreloaded: authContext?.funcionariosPreloaded,
  });

  // 2. Prepara itens brutos e valida codigoProduto e unidadeMedida
  const preparedItems = input.itens.map((raw, idx) => {
    const quantidade = Math.max(1, Math.floor(parseInovafarmaNumber(raw.quantidade, 1)));
    const valorUnitario = roundCurrency(
      Math.max(0, parseInovafarmaNumber(raw.valorUnitario ?? raw.precoUnitario, 0)),
    );
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
    const codigoProduto = String(
      raw.codigoProduto ?? raw.codigoInterno ?? ean ?? idx + 1,
    ).trim();
    const unidadeMedida = normalizeUnidadeMedida(raw.unidadeMedida || "UN");

    if (!codigoProduto) {
      throw new Error(
        `O item #${idx + 1} não possui 'codigoProduto' (CODIGOPRODUTO do ERP) válido para envio ao Inovafarma.`,
      );
    }

    return {
      ean: ean || undefined,
      codigoBarras: ean || undefined,
      codigoProduto,
      unidadeMedida,
      quantidade,
      valorUnitario,
      itemBaseDiscountTotal,
      grossSubtotal: roundCurrency(valorUnitario * quantidade),
    };
  });

  const totalGrossItems = roundCurrency(
    preparedItems.reduce((acc, it) => acc + it.grossSubtotal, 0),
  );

  const globalDiscountToDistribute = roundCurrency(
    Math.max(0, parseInovafarmaNumber(input.descontoGlobal, 0)),
  );

  // 3. Distribui o desconto global diretamente no `descontoUnitario` de cada item (nunca >= valorUnitario)
  let remainingGlobalDiscount = globalDiscountToDistribute;

  const finalItems: InovafarmaVendaItemPayload[] = preparedItems.map((it, index) => {
    let allocatedGlobalDiscount = 0;
    if (globalDiscountToDistribute > 0 && totalGrossItems > 0) {
      if (index === preparedItems.length - 1) {
        allocatedGlobalDiscount = roundCurrency(Math.max(0, remainingGlobalDiscount));
      } else {
        const share = (it.grossSubtotal / totalGrossItems) * globalDiscountToDistribute;
        const unitShare = roundCurrency(share / it.quantidade);
        allocatedGlobalDiscount = roundCurrency(unitShare * it.quantidade);
        remainingGlobalDiscount = roundCurrency(
          remainingGlobalDiscount - allocatedGlobalDiscount,
        );
      }
    }

    const totalDiscountForItem = roundCurrency(
      it.itemBaseDiscountTotal + allocatedGlobalDiscount,
    );
    let descontoUnitario = roundCurrency(totalDiscountForItem / it.quantidade);

    // Garante que descontoUnitario NUNCA seja maior ou igual ao valorUnitario
    if (it.valorUnitario > 0 && descontoUnitario >= it.valorUnitario) {
      descontoUnitario = roundCurrency(Math.max(0, it.valorUnitario - 0.01));
    } else if (it.valorUnitario === 0) {
      descontoUnitario = 0;
    }

    const valorLiquidoUnitario = roundCurrency(
      Math.max(0, it.valorUnitario - descontoUnitario),
    );
    const subtotalLiquido = roundCurrency(it.quantidade * valorLiquidoUnitario);

    return {
      ...(it.codigoBarras ? { codigoBarras: it.codigoBarras, ean: it.ean } : {}),
      codigoProduto: it.codigoProduto,
      unidadeMedida: it.unidadeMedida,
      quantidade: it.quantidade,
      valorUnitario: it.valorUnitario,
      precoUnitario: it.valorUnitario,
      descontoUnitario,
      valorLiquidoUnitario,
      subtotalLiquido,
    };
  });

  // 4. Fechamento Financeiro Exato (Centavo a Centavo):
  // total = Σ (quantidade * (valorUnitario - descontoUnitario)) + entrega.taxa
  const valorTotalItens = roundCurrency(
    finalItems.reduce(
      (acc, it) =>
        acc + roundCurrency(it.quantidade * (it.valorUnitario - it.descontoUnitario)),
      0,
    ),
  );
  const taxaEntrega = roundCurrency(
    Math.max(0, parseInovafarmaNumber(input.taxaEntrega, 0)),
  );
  const valorTotalVenda = roundCurrency(valorTotalItens + taxaEntrega);

  // 5. Dicionário de Pagamentos (Regra do PIX)
  let metodosCadastrados = authContext?.metodosPagamentoPreloaded || [];
  if (
    metodosCadastrados.length === 0 &&
    authContext?.token &&
    authContext?.cnpj &&
    sanitizeCnpj(authContext.cnpj).length >= 11
  ) {
    try {
      const fetchedMetodos = await fetchInovafarmaMetodosPagamentos({
        baseUrl: authContext.baseUrl,
        routeId: authContext.routeId,
        token: authContext.token,
        cnpj: authContext.cnpj,
        apiKey: authContext.apiKey,
      });
      metodosCadastrados = fetchedMetodos.metodos;
    } catch {
      metodosCadastrados = [];
    }
  }

  const rawPagamentos =
    Array.isArray(input.pagamentos) && input.pagamentos.length > 0
      ? input.pagamentos.map((p) => {
          const resolved = resolveInovafarmaFormaPagamento(
            p.formaPagamento || input.formaPagamentoPadrao || "DINHEIRO",
            metodosCadastrados,
            p.tipo,
          );
          return {
            tipo: resolved.tipo,
            formaPagamento: resolved.formaPagamento,
            valor: roundCurrency(parseInovafarmaNumber(p.valor, 0)),
            parcelas: Math.max(1, Math.floor(parseInovafarmaNumber(p.parcelas, 1))),
          };
        })
      : (() => {
          const resolved = resolveInovafarmaFormaPagamento(
            input.formaPagamentoPadrao || "PIX",
            metodosCadastrados,
          );
          return [
            {
              tipo: resolved.tipo,
              formaPagamento: resolved.formaPagamento,
              valor: valorTotalVenda,
              parcelas: 1,
            },
          ];
        })();

  const somaPagamentos = roundCurrency(
    rawPagamentos.reduce((acc, p) => acc + p.valor, 0),
  );

  const diferencaFinanceira = roundCurrency(Math.abs(somaPagamentos - valorTotalVenda));
  if (diferencaFinanceira > 0.001) {
    throw new Error(
      `Divergência financeira bloqueada no envio para o PDV Inovafarma: o somatório dos pagamentos (R$ ${somaPagamentos.toFixed(2)}) não bate com o cálculo líquido dos itens (R$ ${valorTotalItens.toFixed(2)}) + taxa de entrega (R$ ${taxaEntrega.toFixed(2)}) = R$ ${valorTotalVenda.toFixed(2)}.`,
    );
  }

  const codigoVendaOnLine = buildImmutableCodigoVendaOnLine(
    input.codigoVendaOnLine || input.pedidoId,
  );
  const cleanCnpj = sanitizeCnpj(input.cnpj || authContext?.cnpj || "");

  const payload: InovafarmaVendaPayload = {
    ...(cleanCnpj ? { cnpj: cleanCnpj } : {}),
    codigoVendaOnLine,
    ...(input.pedidoId ? { numeroPedido: String(input.pedidoId) } : { numeroPedido: codigoVendaOnLine }),
    vendedor: vendedorCodigoOuCpf,
    dataHora: new Date().toISOString(),
    retirarNaLoja,
    taxaEntrega,
    entrega: {
      retirarNaLoja,
      taxa: taxaEntrega,
      ...(rawEndereco
        ? {
            endereco: logradouro,
            numero: String(rawEndereco.numero || "S/N").trim(),
            ...(rawEndereco.complemento
              ? { complemento: String(rawEndereco.complemento).trim() }
              : {}),
            bairro: String(rawEndereco.bairro || "").trim(),
            cidade,
            ...(rawEndereco.uf
              ? { uf: String(rawEndereco.uf).trim().toUpperCase() }
              : {}),
            ...(cep ? { cep } : {}),
          }
        : {}),
    },
    ...(input.cliente
      ? {
          cliente: {
            nome: String(input.cliente.nome || "Cliente Consumidor").trim(),
            cpf: sanitizeCpf(input.cliente.cpf),
            telefone: String(input.cliente.telefone || "").replace(/\D+/g, ""),
            ...(rawEndereco
              ? {
                  endereco: {
                    logradouro,
                    endereco: logradouro,
                    numero: String(rawEndereco.numero || "S/N").trim(),
                    ...(rawEndereco.complemento
                      ? { complemento: String(rawEndereco.complemento).trim() }
                      : {}),
                    bairro: String(rawEndereco.bairro || "").trim(),
                    cidade,
                    ...(rawEndereco.uf
                      ? { uf: String(rawEndereco.uf).trim().toUpperCase() }
                      : {}),
                    ...(cep ? { cep } : {}),
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
    total: valorTotalVenda,
    ...(input.observacao ? { observacao: String(input.observacao).trim() } : {}),
  };

  return payload;
}

/**
 * Consulta uma venda pelo `codigoVendaOnLine` no Inovafarma (`GET /api/v1/{integracao}/vendaporid/{codigoVendaOnLine}`):
 * - HTTP 204 = venda ainda não registrada no ERP (`found: false`)
 * - HTTP 200 = venda localizada no ERP (`found: true`), extraindo `CODIGOVENDAINOVA`, NF-e, entrega e cancelamento
 */
export async function fetchInovafarmaVendaPorId(params: {
  baseUrl?: string;
  routeId?: string;
  token: string;
  cnpj: string;
  apiKey?: string;
  codigoVendaOnLine: string;
  valorPedidoFarmaFlow?: number;
  supabaseClient?: SupabaseClient;
  tenantId?: string;
}): Promise<InovafarmaVendaReconciliationResult> {
  const cleanCodigo = String(params.codigoVendaOnLine || "").trim();
  if (!cleanCodigo) {
    throw new Error("codigoVendaOnLine é obrigatório para consultar /vendaporid.");
  }

  const res = await inovafarmaHttpRequest<any>({
    method: "GET",
    baseUrl: params.baseUrl,
    routeId: params.routeId,
    token: params.token,
    cnpj: params.cnpj,
    apiKey: params.apiKey,
    resourcePaths: [`vendaporid/${encodeURIComponent(cleanCodigo)}`],
    supabaseClient: params.supabaseClient,
    tenantId: params.tenantId,
  });

  if (res.empty || res.status === 204 || !res.data) {
    return {
      found: false,
      httpStatus: 204,
      codigoVendaOnLine: cleanCodigo,
      codigoVendaInova: null,
      numeroNotaFiscal: null,
      chaveAcessoNotaFiscal: null,
      valorNotaFiscal: null,
      valorPedidoFarmaFlow:
        params.valorPedidoFarmaFlow !== undefined
          ? roundCurrency(params.valorPedidoFarmaFlow)
          : null,
      divergenciaNotaFiscal: false,
      diferencaValorNotaFiscal: 0,
      enviadoParaEntrega: false,
      entregaFinalizada: false,
      vendaEliminada: false,
      statusFarmaFlowSugerido: "enviado_ao_pdv",
    };
  }

  const record = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!record || typeof record !== "object") {
    return {
      found: false,
      httpStatus: 204,
      codigoVendaOnLine: cleanCodigo,
      codigoVendaInova: null,
      numeroNotaFiscal: null,
      chaveAcessoNotaFiscal: null,
      valorNotaFiscal: null,
      valorPedidoFarmaFlow:
        params.valorPedidoFarmaFlow !== undefined
          ? roundCurrency(params.valorPedidoFarmaFlow)
          : null,
      divergenciaNotaFiscal: false,
      diferencaValorNotaFiscal: 0,
      enviadoParaEntrega: false,
      entregaFinalizada: false,
      vendaEliminada: false,
      statusFarmaFlowSugerido: "enviado_ao_pdv",
    };
  }

  const codigoVendaInova =
    String(
      record.CODIGOVENDAINOVA ??
        record.codigoVendaInova ??
        record.codigo_venda_inova ??
        record.CODIGOVENDA ??
        record.codigoVenda ??
        "",
    ).trim() || null;

  const numeroNotaFiscal =
    String(
      record.NUMERONOTAFISCAL ??
        record.numeroNotaFiscal ??
        record.numero_nota_fiscal ??
        "",
    ).trim() || null;

  const chaveAcessoNotaFiscal =
    String(
      record.CHAVEACESSONOTAFISCAL ??
        record.chaveAcessoNotaFiscal ??
        record.chave_acesso_nota_fiscal ??
        "",
    ).trim() || null;

  const rawValorNf =
    record.VALORNOTAFISCAL ??
    record.valorNotaFiscal ??
    record.valor_nota_fiscal ??
    record.VALORTOTAL ??
    record.valorTotal;
  const parsedValorNf = parseInovafarmaNumber(rawValorNf, -1);
  const valorNotaFiscal = parsedValorNf >= 0 ? roundCurrency(parsedValorNf) : null;

  const enviadoParaEntrega = Boolean(
    record.ENVIADOPARAENTREGA ?? record.enviadoParaEntrega ?? false,
  );
  const entregaFinalizada = Boolean(
    record.ENTREGAFINALIZADA ?? record.entregaFinalizada ?? false,
  );
  const vendaEliminada = Boolean(
    record.VENDAELIMINADA ?? record.vendaEliminada ?? false,
  );

  const valorEsperado =
    params.valorPedidoFarmaFlow !== undefined && params.valorPedidoFarmaFlow !== null
      ? roundCurrency(Number(params.valorPedidoFarmaFlow))
      : null;

  let divergenciaNotaFiscal = false;
  let diferencaValorNotaFiscal = 0;
  if (valorNotaFiscal !== null && valorEsperado !== null && valorNotaFiscal > 0) {
    diferencaValorNotaFiscal = roundCurrency(Math.abs(valorNotaFiscal - valorEsperado));
    divergenciaNotaFiscal = diferencaValorNotaFiscal > 0.01;
  }

  let statusFarmaFlowSugerido = "enviado_ao_pdv";
  if (vendaEliminada) {
    statusFarmaFlowSugerido = "cancelled";
  } else if (entregaFinalizada) {
    statusFarmaFlowSugerido = "concluido_no_pdv";
  } else if (enviadoParaEntrega) {
    statusFarmaFlowSugerido = "dispatched";
  } else if (codigoVendaInova || numeroNotaFiscal) {
    statusFarmaFlowSugerido = "impresso_no_pdv";
  }

  return {
    found: true,
    httpStatus: 200,
    codigoVendaOnLine: cleanCodigo,
    codigoVendaInova,
    numeroNotaFiscal,
    chaveAcessoNotaFiscal,
    valorNotaFiscal,
    valorPedidoFarmaFlow: valorEsperado,
    divergenciaNotaFiscal,
    diferencaValorNotaFiscal,
    enviadoParaEntrega,
    entregaFinalizada,
    vendaEliminada,
    statusFarmaFlowSugerido,
    rawErpData: record,
  };
}

/**
 * Executa o checklist completo e envia uma venda (`POST /api/v1/{integracao}/Venda`) para o Inovafarma:
 * 1. Verifica conectividade em `GET /api/v1/{integracao}/server` (quando `checkServerConnectivity !== false`).
 * 2. Deduplicação: consulta `GET /api/v1/{integracao}/vendaporid/{codigoVendaOnLine}` antes de enviar/reenviar.
 * 3. Envia `POST /api/v1/{integracao}/Venda` passando pelo wrapper global (que valida `{ sucesso: false }`).
 */
export async function sendInovafarmaVenda(params: {
  baseUrl?: string;
  routeId?: string;
  token: string;
  cnpj: string;
  apiKey?: string;
  venda: InovafarmaVendaInput;
  checkServerConnectivity?: boolean;
  skipDeduplicationCheck?: boolean;
  supabaseClient?: SupabaseClient;
  tenantId?: string;
}): Promise<{
  success: boolean;
  alreadyExistsInErp?: boolean;
  endpointUsed: string;
  codigoVendaOnLine: string;
  codigoVendaInova?: string | null;
  payloadEnviado: InovafarmaVendaPayload;
  response: any;
}> {
  const payloadEnviado = await buildInovafarmaVendaPayload(
    {
      ...params.venda,
      cnpj: params.venda.cnpj || params.cnpj,
    },
    {
      baseUrl: params.baseUrl,
      routeId: params.routeId,
      token: params.token,
      cnpj: params.cnpj,
      apiKey: params.apiKey,
    },
  );

  // 1. Checklist de Conectividade: GET /api/v1/{integracao}/server
  if (params.checkServerConnectivity) {
    try {
      await checkInovafarmaServerConnectivity({
        baseUrl: params.baseUrl,
        routeId: params.routeId,
        token: params.token,
        cnpj: params.cnpj,
        apiKey: params.apiKey,
        supabaseClient: params.supabaseClient,
        tenantId: params.tenantId,
      });
    } catch (serverErr: any) {
      console.warn(
        "[Inovafarma Venda] Aviso na verificação prévia de /server:",
        serverErr?.message,
      );
    }
  }

  // 2. Checklist de Deduplicação: consulta GET /vendaporid/{codigoVendaOnLine} antes de enviar/reenviar
  if (!params.skipDeduplicationCheck && payloadEnviado.codigoVendaOnLine) {
    try {
      const existingCheck = await fetchInovafarmaVendaPorId({
        baseUrl: params.baseUrl,
        routeId: params.routeId,
        token: params.token,
        cnpj: params.cnpj,
        apiKey: params.apiKey,
        codigoVendaOnLine: payloadEnviado.codigoVendaOnLine,
        valorPedidoFarmaFlow: payloadEnviado.valorTotalVenda,
        supabaseClient: params.supabaseClient,
        tenantId: params.tenantId,
      });

      if (existingCheck.found && existingCheck.httpStatus === 200) {
        return {
          success: true,
          alreadyExistsInErp: true,
          endpointUsed: `/vendaporid/${payloadEnviado.codigoVendaOnLine}`,
          codigoVendaOnLine: payloadEnviado.codigoVendaOnLine,
          codigoVendaInova: existingCheck.codigoVendaInova,
          payloadEnviado,
          response: existingCheck.rawErpData,
        };
      }
    } catch {
      // Se o servidor mock/custom não implementar /vendaporid, prossegue para o POST /Venda
    }
  }

  // 3. Dispara POST /api/v1/{integracao}/Venda via wrapper global (valida HTTP 200 com { sucesso: false })
  const res = await inovafarmaHttpRequest<any>({
    method: "POST",
    baseUrl: params.baseUrl,
    routeId: params.routeId,
    token: params.token,
    cnpj: params.cnpj,
    apiKey: params.apiKey,
    resourcePaths: ["Venda", "venda"],
    body: payloadEnviado,
    supabaseClient: params.supabaseClient,
    tenantId: params.tenantId,
  });

  const codigoVendaInova =
    res.data?.CODIGOVENDAINOVA ??
    res.data?.codigoVendaInova ??
    res.data?.codigo_venda_inova ??
    res.data?.codigoVenda ??
    null;

  return {
    success: true,
    alreadyExistsInErp: false,
    endpointUsed: res.endpointUsed,
    codigoVendaOnLine: payloadEnviado.codigoVendaOnLine,
    codigoVendaInova: codigoVendaInova ? String(codigoVendaInova) : null,
    payloadEnviado,
    response: res.data ?? { ok: true },
  };
}

/**
 * Concilia os pedidos enviados de uma farmácia (`GET /api/v1/{integracao}/vendaporid/{codigoVendaOnLine}`):
 * - Atualiza o pedido no FarmaFlow com `CODIGOVENDAINOVA`, dados da Nota Fiscal (`NUMERONOTAFISCAL`, `CHAVEACESSONOTAFISCAL`),
 *   status de entrega (`ENVIADOPARAENTREGA`, `ENTREGAFINALIZADA`) e verifica se a venda foi cancelada (`VENDAELIMINADA: true`).
 * - Compara `VALORNOTAFISCAL` com o total do pedido e sinaliza divergências.
 */
export async function reconcilePendingInovafarmaOrders(params: {
  supabaseClient: SupabaseClient;
  tenantId: string;
  orderId?: string;
  codigoVendaOnLine?: string;
}): Promise<{
  success: boolean;
  tenantId: string;
  totalChecked: number;
  reconciledCount: number;
  cancelledInErpCount: number;
  divergentInvoicesCount: number;
  results: Array<InovafarmaVendaReconciliationResult & { orderId?: string }>;
}> {
  const resolved = await resolveTenantInovafarmaToken({
    supabaseClient: params.supabaseClient,
    tenantId: params.tenantId,
  });

  if (!resolved.token || !resolved.cnpj) {
    throw new Error(
      "Credenciais do Inovafarma (Login/Senha ou Token + CNPJ) não configuradas para conciliar vendas.",
    );
  }

  let ordersToReconcile: any[] = [];
  if (params.orderId) {
    const { data: singleOrder } = await params.supabaseClient
      .from("orders")
      .select("*")
      .eq("id", params.orderId)
      .eq("tenant_id", params.tenantId)
      .maybeSingle();
    if (singleOrder) ordersToReconcile = [singleOrder];
  } else if (params.codigoVendaOnLine) {
    const singleCheck = await fetchInovafarmaVendaPorId({
      baseUrl: resolved.baseUrl,
      routeId: resolved.routeId,
      token: resolved.token,
      cnpj: resolved.cnpj,
      apiKey: resolved.apiKey,
      codigoVendaOnLine: params.codigoVendaOnLine,
      supabaseClient: params.supabaseClient,
      tenantId: params.tenantId,
    });
    return {
      success: true,
      tenantId: params.tenantId,
      totalChecked: 1,
      reconciledCount: singleCheck.found ? 1 : 0,
      cancelledInErpCount: singleCheck.vendaEliminada ? 1 : 0,
      divergentInvoicesCount: singleCheck.divergenciaNotaFiscal ? 1 : 0,
      results: [singleCheck],
    };
  } else {
    const { data: candidateOrders } = await params.supabaseClient
      .from("orders")
      .select("*")
      .eq("tenant_id", params.tenantId)
      .in("status", ["enviado_ao_pdv", "impresso_no_pdv", "confirmed", "dispatched"])
      .order("created_at", { ascending: false })
      .limit(30);

    ordersToReconcile = (candidateOrders || []).filter((o: any) => {
      const hasDefinitiveInovaCode = Boolean(
        o.codigo_venda_inova || o.codigoVendaInova,
      );
      const isFinalized = o.status === "concluido_no_pdv" || o.status === "cancelled";
      return !isFinalized || !hasDefinitiveInovaCode;
    });
  }

  const results: Array<InovafarmaVendaReconciliationResult & { orderId?: string }> = [];
  let reconciledCount = 0;
  let cancelledInErpCount = 0;
  let divergentInvoicesCount = 0;

  for (const order of ordersToReconcile) {
    const codigoOnline = buildImmutableCodigoVendaOnLine(
      order.codigo_venda_online || order.codigoVendaOnLine || order.id,
    );
    const orderTotal = roundCurrency(
      Number(order.total ?? order.total_amount ?? order.valor_total ?? 0),
    );

    const check = await fetchInovafarmaVendaPorId({
      baseUrl: resolved.baseUrl,
      routeId: resolved.routeId,
      token: resolved.token,
      cnpj: resolved.cnpj,
      apiKey: resolved.apiKey,
      codigoVendaOnLine: codigoOnline,
      valorPedidoFarmaFlow: orderTotal,
      supabaseClient: params.supabaseClient,
      tenantId: params.tenantId,
    });

    if (check.found) {
      reconciledCount++;
      if (check.vendaEliminada) cancelledInErpCount++;
      if (check.divergenciaNotaFiscal) divergentInvoicesCount++;

      const updateFields: Record<string, any> = {
        status: check.statusFarmaFlowSugerido,
        codigo_venda_online: codigoOnline,
        codigo_venda_inova: check.codigoVendaInova,
        numero_nota_fiscal: check.numeroNotaFiscal,
        chave_acesso_nota_fiscal: check.chaveAcessoNotaFiscal,
        valor_nota_fiscal: check.valorNotaFiscal,
        divergencia_nota_fiscal: check.divergenciaNotaFiscal,
      };

      const { error: updErr } = await params.supabaseClient
        .from("orders")
        .update(updateFields)
        .eq("id", order.id)
        .eq("tenant_id", params.tenantId);

      // Fallback caso as colunas opcionais de NF/Inova ainda não existam na tabela orders
      if (updErr) {
        await params.supabaseClient
          .from("orders")
          .update({ status: check.statusFarmaFlowSugerido })
          .eq("id", order.id)
          .eq("tenant_id", params.tenantId);
      }

      await params.supabaseClient.from("integration_logs").insert({
        tenant_id: params.tenantId,
        endpoint: `/vendaporid/${codigoOnline}`,
        payload: {
          orderId: order.id,
          codigoVendaOnLine: codigoOnline,
          codigoVendaInova: check.codigoVendaInova,
          numeroNotaFiscal: check.numeroNotaFiscal,
          chaveAcessoNotaFiscal: check.chaveAcessoNotaFiscal,
          valorNotaFiscal: check.valorNotaFiscal,
          valorPedidoFarmaFlow: orderTotal,
          divergenciaNotaFiscal: check.divergenciaNotaFiscal,
          diferencaValorNotaFiscal: check.diferencaValorNotaFiscal,
          enviadoParaEntrega: check.enviadoParaEntrega,
          entregaFinalizada: check.entregaFinalizada,
          vendaEliminada: check.vendaEliminada,
        },
        status: check.divergenciaNotaFiscal ? "FAILED" : "SUCCESS",
        error_message: check.divergenciaNotaFiscal
          ? `Divergência financeira na Nota Fiscal: Pedido R$ ${orderTotal.toFixed(2)} vs NF-e R$ ${(check.valorNotaFiscal || 0).toFixed(2)}`
          : check.vendaEliminada
            ? "Venda eliminada/cancelada no balcão do PDV Inovafarma (VENDAELIMINADA: true)."
            : undefined,
      });
    }

    results.push({ ...check, orderId: order.id });
  }

  return {
    success: true,
    tenantId: params.tenantId,
    totalChecked: ordersToReconcile.length,
    reconciledCount,
    cancelledInErpCount,
    divergentInvoicesCount,
    results,
  };
}

/**
 * Sincroniza em lote (upsert) os produtos do Inovafarma (`/produtos` ou `/produtosalterados`)
 * na tabela `products` do Supabase, vinculando ao `tenant_id` da farmácia:
 * - Salva obrigatoriamente o `CODIGOPRODUTO` (`internal_code`), unificando produtos repetidos por `EANADICIONAL`.
 * - Usa `MENORPRECOVENDA` como preço final de venda e `PRECOVENDA` como preço "De" (`original_price`), respeitando `ignore_erp_prices`.
 * - Copia `UNIDADEMEDIDA` (2 ou 3 caracteres: `UN`, `CX`, etc.).
 * - Atualiza o watermark `last_product_sync` com a maior `DATAATUALIZACAOPRODUTO` recebida.
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
    throw new Error(
      "tenant_id da farmácia é obrigatório para sincronização com o Inovafarma.",
    );
  }

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

  const cfg = extractTenantErpConfig(tenant);
  const effectiveUrl = (options.erpUrl || cfg.erp_base_url || INOVAFARMA_DEFAULT_API_URL).trim();
  const effectiveRouteId = (
    options.erpRouteId ||
    cfg.erp_route_id ||
    INOVAFARMA_DEFAULT_ROUTE_ID
  )
    .trim()
    .replace(/^\/+|\/+$/g, "");
  const effectiveCnpj = sanitizeCnpj(options.cnpj || cfg.erp_cnpj || "");
  const effectiveApiKey = (options.apiKey ?? cfg.erp_api_key ?? "").trim();
  const ignoreErpPrices =
    options.ignoreErpPrices !== undefined
      ? Boolean(options.ignoreErpPrices)
      : cfg.ignore_erp_prices;

  const savedLogin = (options.apiLogin || cfg.erp_login).trim();
  const savedPassword =
    options.apiPassword && !isMaskedErpPassword(options.apiPassword)
      ? String(options.apiPassword).trim()
      : cfg.erp_password;

  let effectiveToken = (
    options.apiToken ||
    cfg.erp_access_token ||
    tenant.integration_token ||
    ""
  ).trim();

  let rawProducts: InovafarmaRawProduct[] = [];
  let endpointUsed = "payload_direto";
  let highestUpdatedAtWatermark = "";

  try {
    // Reutiliza o token válido por 30 dias ou gera um novo em POST /api/login se ausente/expirado
    if (
      (!Array.isArray(options.productsOverride) || options.productsOverride.length === 0) &&
      savedLogin &&
      savedPassword
    ) {
      const loginResult = await authenticateInovafarma({
        supabaseClient,
        tenantId,
        baseUrl: effectiveUrl,
        routeId: effectiveRouteId,
        cnpj: effectiveCnpj,
        login: savedLogin,
        password: savedPassword,
        apiKey: effectiveApiKey,
      });
      effectiveToken = loginResult.accessToken;
    }

    if (Array.isArray(options.productsOverride) && options.productsOverride.length > 0) {
      rawProducts = options.productsOverride;
      endpointUsed = "push_payload";
    } else if (options.mode === "delta" || (options.inicial && options.final)) {
      const fetched = await fetchInovafarmaProdutosAlterados({
        baseUrl: effectiveUrl,
        routeId: effectiveRouteId,
        token: effectiveToken,
        cnpj: effectiveCnpj,
        apiKey: effectiveApiKey,
        inicial: options.inicial,
        final: options.final,
        lastProductSyncWatermark: cfg.last_product_sync,
        offset: options.offset,
        limit: options.limit,
        supabaseClient,
        tenantId,
        login: savedLogin,
        password: savedPassword,
      });
      rawProducts = fetched.products;
      endpointUsed = fetched.endpointUsed;
      if (fetched.highestUpdatedAt) {
        highestUpdatedAtWatermark = fetched.highestUpdatedAt;
      }
    } else {
      const fetched = await fetchInovafarmaProducts({
        baseUrl: effectiveUrl,
        routeId: effectiveRouteId,
        token: effectiveToken,
        cnpj: effectiveCnpj,
        apiKey: effectiveApiKey,
        offset: options.offset,
        limit: options.limit,
        supabaseClient,
        tenantId,
        login: savedLogin,
        password: savedPassword,
      });
      rawProducts = fetched.products;
      endpointUsed = fetched.endpointUsed;
      if (fetched.highestUpdatedAt) {
        highestUpdatedAtWatermark = fetched.highestUpdatedAt;
      }
    }

    // 3. Normaliza e deduplica por CODIGOPRODUTO (quando o produto vem repetido por possuir EANADICIONAL) ou por EAN
    const normalizedMap = new Map<string, NormalizedInovafarmaProduct>();
    let skippedCount = 0;

    for (const rawItem of rawProducts) {
      const normalized = normalizeInovafarmaProduct(rawItem);
      if (!normalized) {
        skippedCount++;
        continue;
      }

      if (
        normalized.updatedAtErp &&
        (!highestUpdatedAtWatermark || normalized.updatedAtErp > highestUpdatedAtWatermark)
      ) {
        highestUpdatedAtWatermark = normalized.updatedAtErp;
      }

      // Chave primária de agrupamento: CODIGOPRODUTO se presente, evitando duplicar itens com EANADICIONAL
      const dedupKey = normalized.erpProductId
        ? `COD:${normalized.erpProductId}`
        : `EAN:${normalized.barcode}`;

      const prev = normalizedMap.get(dedupKey);
      if (prev) {
        const mergedAdditional = Array.from(
          new Set([
            ...prev.additionalEans,
            ...normalized.additionalEans,
            ...(normalized.barcode && normalized.barcode !== prev.barcode
              ? [normalized.barcode]
              : []),
          ]),
        );
        normalizedMap.set(dedupKey, {
          ...prev,
          ...normalized,
          barcode: prev.barcode || normalized.barcode,
          internalCode: normalized.erpProductId || prev.internalCode,
          erpProductId: normalized.erpProductId || prev.erpProductId,
          additionalEans: mergedAdditional,
        });
      } else {
        normalizedMap.set(dedupKey, normalized);
      }
    }

    const validProducts = Array.from(normalizedMap.values());
    const finalWatermark = highestUpdatedAtWatermark || syncedAt;

    if (validProducts.length === 0) {
      await saveTenantInovafarmaState(supabaseClient, tenantId, {
        last_product_sync: finalWatermark,
      });

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
        lastProductSync: finalWatermark,
        message:
          "A API do Inovafarma respondeu com sucesso (HTTP 200/204), mas nenhum produto novo/alterado foi retornado no período.",
      };

      await supabaseClient.from("integration_logs").insert({
        tenant_id: tenantId,
        endpoint: options.mode === "delta" ? "/inovafarma/produtosalterados" : "/inovafarma/sync",
        payload: {
          endpointUsed,
          routeId: effectiveRouteId,
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
          "id, barcode, internal_code, name, price, original_price, promotional_price, stock, category, department, subcategory, presentation, image, images, description, is_featured, is_ai_enriched",
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

    // 5. Prepara lote para upsert salvando CODIGOPRODUTO (internal_code) e UNIDADEMEDIDA (presentation)
    let insertedCount = 0;
    let updatedCount = 0;
    const upsertPayloads: any[] = [];

    for (const item of validProducts) {
      const existing =
        (item.internalCode && existingByInternalCode.get(item.internalCode)) ||
        (item.barcode && existingByBarcode.get(item.barcode));

      if (existing) {
        updatedCount++;
        const updatedRow: any = {
          id: existing.id,
          tenant_id: tenantId,
          barcode: item.barcode || existing.barcode,
          internal_code: item.erpProductId || item.internalCode || existing.internal_code || item.barcode,
          name: existing.name || item.name,
          stock: item.stock,
          category: existing.category || item.category || "Geral",
          presentation: item.unitMeasure || existing.presentation || "UN",
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
          if (item.originalPrice !== null && item.originalPrice > updatedRow.price) {
            updatedRow.original_price = item.originalPrice;
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
          internal_code: item.erpProductId || item.internalCode || item.barcode,
          name: item.name,
          presentation: item.unitMeasure || "UN",
          description: item.activeIngredient
            ? `Princípio Ativo: ${item.activeIngredient}`
            : "",
          price: item.price,
          ...(item.originalPrice !== null ? { original_price: item.originalPrice } : {}),
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
          const { department, subcategory, original_price, presentation, ...rest } = row;
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

    // 7. Salva o watermark last_product_sync
    await saveTenantInovafarmaState(supabaseClient, tenantId, {
      last_product_sync: finalWatermark,
    });

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
      lastProductSync: finalWatermark,
      message: `Sincronização Inovafarma concluída: ${validProducts.length} produtos processados (${insertedCount} novos, ${updatedCount} atualizados).`,
    };

    await supabaseClient.from("integration_logs").insert({
      tenant_id: tenantId,
      endpoint: options.mode === "delta" ? "/inovafarma/produtosalterados" : "/inovafarma/sync",
      payload: {
        endpointUsed,
        routeId: effectiveRouteId,
        cnpj: effectiveCnpj,
        inicial: options.inicial,
        final: options.final,
        totalFetched: rawProducts.length,
        totalValid: validProducts.length,
        insertedCount,
        updatedCount,
        skippedCount,
        ignoreErpPrices,
        lastProductSync: finalWatermark,
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
        routeId: effectiveRouteId,
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
  erpRouteId?: string;
  apiToken?: string;
  apiKey?: string;
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
    throw new Error(
      data.error || data.details || `Falha na sincronização (HTTP ${response.status})`,
    );
  }
  return data as InovafarmaSyncResult;
}

/**
 * Helper cliente (Frontend) para testar a conectividade com o servidor do Inovafarma (`GET /api/v1/{integracao}/server`)
 */
export async function triggerInovafarmaConnectivityTest(params: {
  tenantId: string;
  erpUrl?: string;
  erpRouteId?: string;
  cnpj?: string;
  apiLogin?: string;
  apiPassword?: string;
  apiKey?: string;
  apiToken?: string;
}): Promise<{
  success: boolean;
  connected: boolean;
  endpointUsed: string;
  message: string;
  serverInfo?: any[];
  tokenExpiration?: string;
}> {
  const response = await fetch("/api/integration/inovafarma/server", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(
      data.error || data.details || `Falha ao testar conectividade (/server) (HTTP ${response.status})`,
    );
  }
  return data;
}

/**
 * Helper cliente (Frontend) para acionar a conciliação de vendas enviadas ao Inovafarma (`GET /api/v1/{integracao}/vendaporid/{codigoVendaOnLine}`)
 */
export async function triggerInovafarmaReconciliation(params: {
  tenantId: string;
  orderId?: string;
  codigoVendaOnLine?: string;
}): Promise<{
  success: boolean;
  tenantId: string;
  totalChecked: number;
  reconciledCount: number;
  cancelledInErpCount: number;
  divergentInvoicesCount: number;
  results: Array<InovafarmaVendaReconciliationResult & { orderId?: string }>;
}> {
  const response = await fetch("/api/integration/inovafarma/reconcile", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(
      data.error || data.details || `Falha ao conciliar vendas no Inovafarma (HTTP ${response.status})`,
    );
  }
  return data;
}
