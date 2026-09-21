import { UpsellCard } from "./components/UpsellCard";
import useSWR from "swr";
import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  Suspense,
  lazy,
} from "react";
import {


  ViewMode,
  Product,
  Order,
  CartItem,
  CustomerInfo,
  PharmacyConfig,
  AuthSession,
  calculateItemTotal,
  calculateItemPromotionDetails,
  OrderStatus,
  isControlledProduct,
  PromotionRule,
  CouponRule,
  isPromotionActive,
  checkProductMatchesRule,
  getVariableCombosForProduct,
  VariableComboRequirement,
  getProductVolumePromotionInfo,
} from "./types";

import { Navbar } from "./components/Navbar";
import { TenantSelector } from "./components/TenantSelector";

import { Storefront } from "./components/Storefront";

import { PWAInstallPrompt } from "./components/PWAInstallPrompt";

import { OrderAlert } from "./components/OrderAlert";

import { ChatCentral } from "./components/ChatCentral";


import {
  getTenants,
  getTenantByHostname,
  getProductsByTenant,
  saveProductsByTenant,
  clearProductsCache,
  getOrdersByTenant,
  saveOrderByTenant,
  deleteOrder,
  deleteProduct,
  deleteProducts,
  deleteTenant,
  saveOrdersByTenant,
  saveTenant,
  mapDbProductToApp,
  mapDbOrderToApp,
  logSearch,
  getPromotionsByTenant,
  getCouponsByTenant,
} from "./services/storage";

import { supabase } from "./services/supabase";
// Added Calendar to lucide-react imports to fix missing component error

// Captura imediata de parâmetros de Deep Link antes que qualquer roteador altere o histórico
if (typeof window !== "undefined") {
  try {
    const p = new URLSearchParams(window.location.search);
    const prod = p.get("produto") || p.get("prod") || p.get("product") || p.get("p_id") || p.get("item");
    const search = p.get("busca") || p.get("q") || p.get("search") || p.get("termo");
    if (prod) {
      sessionStorage.setItem("ff_deeplink_produto", prod.trim());
    }
    if (search) {
      sessionStorage.setItem("ff_deeplink_busca", search.trim());
    }
  } catch {}
}

import {

  X,
  Package,
  ShoppingBag,
  ShoppingCart,
  Store,
  ArrowLeft,
  Loader2,
  Key,
  Factory,
  Pill,
  Ban,
  AlertCircle,
  AlertTriangle,
  ClipboardList,
  ShieldAlert,
  Maximize2,
  Plus,
  Sparkles,
  ChevronRight,
  Info,
  CheckCircle2,
  FlaskConical,
  Layers,
  TrendingDown,
  BookOpen,
  History,
  Calendar,
  Percent,
  Tag,
  Printer,
  Users, Inbox,
  TrendingUp,
  Settings,
  Laptop,
  MessageSquare,
  FileText,
  Lock, MessageSquareShare, Zap,
  PanelLeftClose,
  PanelLeftOpen,
  Menu
} from "lucide-react";


import { Toaster, toast } from "sonner";

const AdminPrescriptions = lazy(() =>
  import("./components/AdminPrescriptions").then((m) => ({
    default: m.AdminPrescriptions,
  })),
);

const AdminDesktopApp = lazy(() =>
  import("./components/AdminDesktopApp").then((m) => ({
    default: m.AdminDesktopApp,
  })),
);

const AdminDashboard = lazy(() =>
  import("./components/AdminDashboard").then((m) => ({
    default: m.AdminDashboard,
  })),
);
const AdminProductManager = lazy(() =>
  import("./components/AdminProductManager").then((m) => ({
    default: m.AdminProductManager,
  })),
);
const AdminOrderManager = lazy(() =>
  import("./components/AdminOrderManager").then((m) => ({
    default: m.AdminOrderManager,
  })),
);
const AdminSettings = lazy(() =>
  import("./components/AdminSettings").then((m) => ({
    default: m.AdminSettings,
  })),
);
const AdminAnalytics = lazy(() =>
  import("./components/AdminAnalytics").then((m) => ({
    default: m.AdminAnalytics,
  })),
);
const InboxManagement = lazy(() => import("./components/InboxManagement").then((m) => ({ default: m.InboxManagement })));

const TeamManagement = lazy(() =>
  import("./components/TeamManagement").then((m) => ({
    default: m.TeamManagement,
  })),
);
const AdminManual = lazy(() =>
  import("./components/AdminManual").then((m) => ({ default: m.AdminManual })),
);
const AdminImportHistory = lazy(() =>
  import("./components/AdminImportHistory").then((m) => ({
    default: m.AdminImportHistory,
  })),
);
const AdminCouponManager = lazy(
  () => import("./components/AdminCouponManager"),
);
const AdminPromotionManager = lazy(
  () => import("./components/AdminPromotionManager"),
);
const AdminPriceTags = lazy(() =>
  import("./components/AdminPriceTags").then((m) => ({
    default: m.AdminPriceTags,
  })),
);
const SuperAdminManager = lazy(() =>
  import("./components/SuperAdminManager").then((m) => ({
    default: m.SuperAdminManager,
  })),
);
const Login = lazy(() =>
  import("./components/Login").then((m) => ({ default: m.Login })),
);
const Cart = lazy(() =>
  import("./components/Cart").then((m) => ({ default: m.Cart })),
);

const LoadingFallback = () => (
  <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
    <Loader2 size={48} className="text-emerald-500 animate-spin mb-4" />
    <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">
      Carregando...
    </p>
  </div>
);

const GENERIC_PLACEHOLDER = "https://i.imgur.com/fLz8F3X.png";

const fixImageUrl = (url?: string, width: number = 400): string | null => {
  if (!url || url === "IGNORE" || url === "PENDENTE_CURADORIA") return null;
  if (url.startsWith("data:")) return url;
  if (url.includes("cdn-cosmos.bluesoft.com.br")) return url;

  // Se for uma URL de imagem relativa ou local, não passamos pelo proxy wsrv.nl para evitar falhas/timeouts
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return url;
  }

  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&output=webp&q=80&w=${width}&we&default=${encodeURIComponent(GENERIC_PLACEHOLDER)}`;
};

const THERAPEUTIC_AFFINITY: Record<string, string[]> = {
  Antibiótico: ["Probiótico", "Vitamina", "Higiene", "Conveniência"],
  "Anti-inflamatório": ["Protetor Gástrico", "Analgésico", "Higiene", "Doces"],
  Antigripal: [
    "Vitamina C",
    "Descongestionante Nasal",
    "Antigripal",
    "Conveniência",
  ],
  Analgésico: ["Anti-inflamatório", "Vitamina", "Higiene", "Doces"],
  Dermocosmético: [
    "Protetor Solar",
    "Hidratante Facial",
    "Sabonete Líquido",
    "Cabelos",
  ],
  Infantil: [
    "Higiene Bebê",
    "Fraldas",
    "Pomada para Assadura",
    "Brinquedos",
    "Doces",
  ],
  Vitamina: ["Suplemento Alimentar", "Minerais", "Higiene"],
  Diabetes: [
    "Aparelho de Glicemia",
    "Tiras de Teste",
    "Adoçante",
    "Conveniência",
  ],
  Hipertensão: ["Aparelho de Pressão", "Suplemento Omg 3", "Higiene"],
  Geral: ["Higiene", "Perfumaria", "Doces", "Conveniência"],
};

const SuggestionCard = ({
  p,
  currentTenant,
  setSelectedProduct,
  setPreviewImage,
  handleAddToCart,
  promotions = [],
  activePromoIds = "",
}: any) => {
  const [isAdding, setIsAdding] = useState(false);

  // Configuração Dinâmica de Preço Relacionado a Promoções (Idêntico ao ProductCard)
  const hasDiscount = Boolean(
    (p.originalPrice && p.originalPrice > p.price) ||
    (p.promotionalPrice && p.promotionalPrice > 0 && p.promotionalPrice < (p.originalPrice || p.price))
  );
  const isKit = p.promotionType === "BUY_X_PAY_Y";
  const isDiscountOnQty = p.promotionType === "DISCOUNT_ON_QTY";

  const activePromo = useMemo(() => {
    const idSet = new Set(activePromoIds.split(",").filter(Boolean));
    return promotions.find((promo: any) => {
      if (!idSet.has(promo.id)) return false;

      if (promo.targetType === "PRODUCT" && promo.targetValue === p.id)
        return true;
      if (promo.targetType === "CATEGORY" && promo.targetValue === p.category)
        return true;
      if (
        promo.targetType === "MANUFACTURER" &&
        promo.targetValue === p.manufacturer
      )
        return true;
      if (
        promo.targetType === "SPECIFIC_SELECTION" &&
        promo.specificProductIds?.includes(p.id)
      )
        return true;
      return false;
    });
  }, [promotions, activePromoIds, p.id, p.category, p.manufacturer]);

  let currentPrice = (p.promotionalPrice && p.promotionalPrice > 0 && p.promotionalPrice < p.price)
    ? p.promotionalPrice
    : p.price;

  if (activePromo) {
    if (
      activePromo.type === "LIGHTNING_OFFER" &&
      activePromo.lightningDiscountPercentage
    ) {
      currentPrice =
        p.price * (1 - activePromo.lightningDiscountPercentage / 100);
    } else if (
      activePromo.type === "BUY_X_PAY_Y" &&
      activePromo.buyX &&
      activePromo.payY
    ) {
      currentPrice = (p.price * activePromo.payY) / activePromo.buyX;
    } else if (
      activePromo.type === "FIXED_COMBO" &&
      activePromo.buyX &&
      activePromo.payY
    ) {
      currentPrice = activePromo.payY / activePromo.buyX;
    } else if (
      activePromo.type === "PROGRESSIVE_DISCOUNT" &&
      activePromo.discountThresholds?.[0]
    ) {
      currentPrice =
        p.price *
        (1 - activePromo.discountThresholds[0].discountPercentage / 100);
    }
  } else if (isKit) {
    currentPrice = (p.price * (p.payY || 0)) / (p.buyX || 1);
  } else if (isDiscountOnQty) {
    currentPrice = p.price * (1 - (p.discountQtyPercentage || 0) / 100);
  }

  const showOriginalPrice = Boolean(hasDiscount || currentPrice < (p.originalPrice || p.price));
  const finalOriginalPrice = showOriginalPrice
    ? Math.max(p.originalPrice || 0, p.price)
    : p.price;

  let suggestionImage = fixImageUrl(p.image);
  const isGeneric =
    p.drugType?.trim().toLowerCase() === "genérico" ||
    p.drugType?.trim().toLowerCase() === "generico";
  if (!suggestionImage && isGeneric) {
    const mfgKey = p.manufacturer
      ? Object.keys(currentTenant?.manufacturerLogos || {}).find(
          (k) =>
            k.trim().toLowerCase() === p.manufacturer?.trim().toLowerCase(),
        )
      : null;
    if (mfgKey && currentTenant?.manufacturerLogos?.[mfgKey]) {
      suggestionImage = fixImageUrl(currentTenant.manufacturerLogos[mfgKey]);
    } else {
      suggestionImage = GENERIC_PLACEHOLDER;
    }
  }

  const onAdd = (e: React.MouseEvent) => {
    e.stopPropagation();

    // Fly to cart animation
    const button = e.currentTarget as HTMLButtonElement;
    const rect = button.getBoundingClientRect();

    const ghost = document.createElement("div");
    ghost.className =
      "fixed z-[9999] w-5 h-5 rounded-full shadow-lg pointer-events-none flex items-center justify-center";
    ghost.style.backgroundColor = currentTenant?.primaryColor || "#10b981";
    ghost.style.left = `${rect.left + rect.width / 2 - 10}px`;
    ghost.style.top = `${rect.top + rect.height / 2 - 10}px`;
    ghost.style.transition = "all 0.6s cubic-bezier(0.25, 1, 0.5, 1)";
    document.body.appendChild(ghost);

    // Trigger reflow
    void ghost.offsetWidth;

    // Find cart icon
    const cartIcon = document.getElementById("floating-cart-btn");
    if (cartIcon) {
      const cartRect = cartIcon.getBoundingClientRect();
      ghost.style.left = `${cartRect.left + cartRect.width / 2 - 10}px`;
      ghost.style.top = `${cartRect.top + cartRect.height / 2 - 10}px`;
      ghost.style.transform = "scale(0.2)";
      ghost.style.opacity = "0.5";

      // Trigger cart bounce
      setTimeout(() => {
        cartIcon.classList.remove("animate-bounce");
        void cartIcon.offsetWidth;
        cartIcon.classList.add("animate-bounce");
        setTimeout(() => cartIcon.classList.remove("animate-bounce"), 1000);
      }, 500);
    } else {
      ghost.style.transform = "translateY(-100px) scale(0)";
      ghost.style.opacity = "0";
    }

    setTimeout(() => {
      if (document.body.contains(ghost)) {
        document.body.removeChild(ghost);
      }
    }, 600);

    setIsAdding(true);
    handleAddToCart(p);

    setTimeout(() => {
      setIsAdding(false);
    }, 500);
  };

  return (
    <div
      onClick={() => {
        setSelectedProduct(p);
        setPreviewImage(suggestionImage || null);
        const modalContainer = document.getElementById("product-detail-scroll-container");
        if (modalContainer) {
          modalContainer.scrollTo({ top: 0, behavior: "smooth" });
        }
      }}
      className="bg-white border-2 border-gray-50 p-3 rounded-[2rem] hover:border-brand hover:shadow-xl transition-all cursor-pointer group flex flex-col w-[160px] md:w-[180px] shrink-0 snap-start relative"
    >
      {p.suggestionBadge && (
        <div className="absolute top-2 left-2 z-10">
          <span
            className={`px-2 py-0.5 rounded-lg text-[7px] font-black uppercase tracking-widest shadow-md ${
              p.suggestionBadge === "Mesma Fórmula"
                ? "bg-blue-600 text-white"
                : p.suggestionBadge === "Oferta do Dia"
                  ? "bg-red-600 text-white animate-pulse"
                  : p.suggestionBadge === "Melhor Preço"
                    ? "bg-green-600 text-white"
                    : p.suggestionBadge === "Mais Vendidos"
                      ? "bg-purple-600 text-white"
                      : p.suggestionBadge === "Mesma Marca"
                        ? "bg-teal-600 text-white"
                        : p.suggestionBadge === "Combinar"
                          ? "bg-pink-500 text-white"
                          : p.suggestionBadge === "Aproveite"
                            ? "bg-orange-500 text-white"
                            : p.suggestionBadge.includes("Tam.")
                              ? "bg-gray-900 text-white border border-gray-700 shadow-xl scale-110 origin-top-left"
                              : "bg-brand text-brand-contrast"
            }`}
          >
            {p.suggestionBadge}
          </span>
        </div>
      )}
      {p.promotionType === "BUY_X_PAY_Y" && (
        <div className="absolute top-2 right-2 z-10">
          <span className="px-2 py-0.5 rounded-lg text-[7px] font-black uppercase tracking-widest shadow-md bg-yellow-400 text-yellow-900 border border-yellow-500">
            Leve {p.buyX} Pague {p.payY}
          </span>
        </div>
      )}
      <div className="aspect-square bg-gray-50 rounded-2xl overflow-hidden mb-3 relative flex items-center justify-center p-2">
        {suggestionImage ? (
          <img
            src={suggestionImage}
            loading="lazy"
            className={`max-w-full max-h-full object-contain transition-transform ${p.stock <= 0 ? "opacity-50 grayscale" : "group-hover:scale-110"}`}
            alt={p.name}
            referrerPolicy="no-referrer"
          />
        ) : (
          <Package size={24} className="text-gray-200" />
        )}
        {p.stock > 0 ? (
          <div className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <div className="bg-white p-2 rounded-full shadow-lg">
              <Plus className="text-brand" size={16} strokeWidth={3} />
            </div>
          </div>
        ) : (
          <div className="absolute inset-x-0 bottom-0 py-1 bg-red-600/90 text-white text-[8px] font-black text-center uppercase tracking-widest">
            Indisponível
          </div>
        )}
      </div>
      <h4 className="text-[11px] font-black text-gray-900 line-clamp-2 mb-2 flex-1 leading-tight">
        {p.name}
      </h4>
      <div className="flex items-center justify-between mt-auto">
        <div className="flex flex-col">
          {showOriginalPrice && (
            <span className="text-[10px] font-bold text-gray-400 line-through leading-none mb-0.5">
              R$ {finalOriginalPrice.toFixed(2)}
            </span>
          )}
          <p className="text-[13px] font-black text-emerald-600 leading-none">
            R$ {currentPrice.toFixed(2)}
          </p>
        </div>
        <button
          onClick={onAdd}
          disabled={isAdding || p.stock <= 0}
          className={`p-1.5 text-white rounded-lg transition-colors shadow-sm ${isAdding ? "bg-emerald-500 scale-95" : p.stock <= 0 ? "bg-gray-300 opacity-50 cursor-not-allowed" : "bg-gray-900 hover:bg-emerald-600"}`}
        >
          {isAdding ? (
            <CheckCircle2
              size={14}
              strokeWidth={4}
              className="animate-in zoom-in duration-200"
            />
          ) : (
            <Plus size={14} strokeWidth={4} />
          )}
        </button>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [session, setSession] = useState<AuthSession>(() => {
    const saved = localStorage.getItem("ff_session");
    let parsed = saved ? JSON.parse(saved) : { type: "GUEST" };
    if ((parsed.type === "SUPER_ADMIN" || parsed.type === "PHARMACY_ADMIN") && (!parsed.access_token || !parsed.refresh_token)) {
        parsed = { type: "GUEST" };
        localStorage.removeItem("ff_session");
    }
    return parsed;
  });

  useEffect(() => {
    if (session.type === "GUEST") return;

    // Use getSession to rely on Supabase's native storage and auto-refresh,
    // avoiding race conditions with manual setSession.
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        // If it's a network error, do not log the user out.
        if (error.message && (error.message.includes('fetch') || error.message.includes('network'))) {
          console.warn("Network error during auth check. Keeping current session state.");
          return;
        }
        console.warn("Supabase session error. Logging out.", error);
        setSession({ type: "GUEST" });
        localStorage.removeItem("ff_session");
      } else if (!data.session) {
        // Se realmente não há sessão no Supabase, loga fora
        console.warn("Supabase session missing. Logging out.");
        setSession({ type: "GUEST" });
        localStorage.removeItem("ff_session");
      } else {
        // Sync just in case
        setSession(prev => {
          if (prev.type === "GUEST") return prev;
          const updated = { ...prev, access_token: data.session.access_token, refresh_token: data.session.refresh_token };
          localStorage.setItem("ff_session", JSON.stringify(updated));
          return updated;
        });
      }
    });
  }, []);

  const [view, setView] = useState<ViewMode>(() => {
    const savedView = localStorage.getItem("ff_view");
    // Nunca inicialize no carrinho se a página foi recarregada na raiz,
    // para evitar que o usuário fique preso no carrinho ao abrir o app
    if (savedView === ViewMode.CART) {
      localStorage.setItem("ff_view", ViewMode.CATALOG);
      return ViewMode.CATALOG;
    }
    return (savedView as ViewMode) || ViewMode.CATALOG;
  });

  const [adminTab, setAdminTab] = useState<
    | "dashboard"
    | "orders"
    | "prescriptions"
    | "products"
    | "promotions"
    | "coupons"
    | "price-tags"
    | "settings"
    | "manual"
    | "history"
    | "team"
    | "analytics"
    | "desktop"
    | "chat"
    | "inboxes"
  >(() => {
    return (localStorage.getItem("ff_admin_tab") as any) || "dashboard";
  });

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem("ff_sidebar_collapsed") === "true";
  });
  const [isLoading, setIsLoading] = useState(true);

  const [currentTenant, setCurrentTenant] = useState<PharmacyConfig | null>(
    () => {
      const saved = localStorage.getItem("ff_tenant");
      return saved ? JSON.parse(saved) : null;
    },
  );

  const [networkTenants, setNetworkTenants] = useState<PharmacyConfig[]>([]);
  const [isSwitchingTenant, setIsSwitchingTenant] = useState(false);

  // Determina se a sessão atual possui privilégios de gestão da Matriz / Rede de forma persistente
  const isMatrixAdmin = useMemo(() => {
    if (!session || session.type === "GUEST") return false;
    if (session.type === "SUPER_ADMIN") return true;

    const role = (session.role || "").toLowerCase().trim();
    
    // Operadores, balconistas, atendentes e colaboradores de filial NUNCA possuem acesso de administrador de matriz/rede
    const isRestrictedRole = [
      "operador", 
      "balconista", 
      "atendente", 
      "farmaceutico", 
      "caixa", 
      "vendedor", 
      "entregador", 
      "gerente"
    ].includes(role);
    if (isRestrictedRole) return false;

    // Perfis explicitamente de Administrador Master / Rede
    if (role === "matriz" || role === "admin_matriz" || role === "network_admin" || role === "master" || role === "super_admin") return true;

    // Se o usuário possui flag de isMatrixUser com cargo de dono/admin master
    if (session.isMatrixUser === true && (role === "admin" || role === "owner" || !role)) return true;

    // Se a loja de login é a Matriz da rede e o usuário é Administrador/Proprietário Master
    const isLoginStoreMaster = session.originalTenantId && session.originalTenantId === currentTenant?.id && currentTenant?.isNetworkMaster;
    if (isLoginStoreMaster && (role === "owner" || role === "admin" || !role)) {
      return true;
    }

    return false;
  }, [session, currentTenant?.id, currentTenant?.isNetworkMaster, currentTenant?.networkId]);

  // Carrega lista de filiais / rede estritamente se o usuário for Administrador da Matriz ou SuperAdmin
  useEffect(() => {
    if (!currentTenant) return;

    // Se for guest ou operador de filial com unidade fixa
    if (!session || session.type === "GUEST" || (!isMatrixAdmin && session.type !== "SUPER_ADMIN")) {
      setNetworkTenants([currentTenant]);
      return;
    }

    const loadNetworkTenants = async () => {
      try {
        const allStores = await getTenants();
        if (allStores && allStores.length > 0) {
          // Identifica o ID da Matriz da rede atual:
          const sessionStore = allStores.find(s => s.id === session?.tenantId || s.id === session?.originalTenantId);
          const isSessionStoreMaster = Boolean(sessionStore?.isNetworkMaster);

          const masterNetworkId = 
            (session?.masterTenantId && session.masterTenantId.trim() !== "") ? session.masterTenantId.trim() :
            (currentTenant.networkId && currentTenant.networkId.trim() !== "") ? currentTenant.networkId.trim() :
            (currentTenant.isNetworkMaster ? currentTenant.id : 
            (isSessionStoreMaster ? sessionStore?.id : (sessionStore?.networkId || null)));

          if (masterNetworkId) {
            // Pertence a ESTA rede se:
            // 1. É a Matriz desta rede (s.id === masterNetworkId)
            // 2. É uma Filial vinculada a esta rede (s.networkId === masterNetworkId)
            const related = allStores.filter((s) => {
              const isMatrizOfThisNetwork = s.id === masterNetworkId;
              const isFilialOfThisNetwork = Boolean(s.networkId && s.networkId.trim() === masterNetworkId);
              return isMatrizOfThisNetwork || isFilialOfThisNetwork;
            });

            if (related.length > 0) {
              setNetworkTenants(related);
              // Garante que o status de matriz/rede persista na sessão apenas para quem tem permissão real
              if (isMatrixAdmin && (!session.masterTenantId || !session.isMatrixUser)) {
                setSession(prev => {
                  if (!prev || prev.type === "GUEST") return prev;
                  const updated: AuthSession = {
                    ...prev,
                    isMatrixUser: true,
                    masterTenantId: masterNetworkId,
                    originalTenantId: prev.originalTenantId || prev.tenantId || masterNetworkId
                  };
                  localStorage.setItem("ff_session", JSON.stringify(updated));
                  return updated;
                });
              }
            } else {
              setNetworkTenants([currentTenant]);
            }
          } else {
            // Loja independente sem rede
            setNetworkTenants([currentTenant]);
          }
        }
      } catch (e) {
        console.warn("Failed to load network tenants:", e);
      }
    };
    loadNetworkTenants();
  }, [
    currentTenant?.id, 
    currentTenant?.isNetworkMaster, 
    currentTenant?.networkId, 
    isMatrixAdmin, 
    session?.type, 
    session?.masterTenantId, 
    session?.isMatrixUser, 
    session?.tenantId,
    session?.originalTenantId
  ]);

  const handleSelectTenant = useCallback(async (selected: PharmacyConfig) => {
    if (!selected || selected.id === currentTenant?.id) return;
    setIsSwitchingTenant(true);
    setCurrentTenant(selected);
    localStorage.setItem("ff_tenant", JSON.stringify(selected));

    // Preserva rigorosamente o privilégio de Administrador de Matriz/Rede ao alternar entre filiais
    setSession(prev => {
      if (!prev || prev.type === "GUEST") return prev;
      const isCurrentlyMatrix = isMatrixAdmin || prev.isMatrixUser === true || prev.type === "SUPER_ADMIN";
      const masterId = prev.masterTenantId || (currentTenant?.isNetworkMaster ? currentTenant.id : currentTenant?.networkId) || (selected.isNetworkMaster ? selected.id : selected.networkId);
      
      const updated: AuthSession = {
        ...prev,
        isMatrixUser: isCurrentlyMatrix || prev.isMatrixUser,
        masterTenantId: masterId || prev.masterTenantId,
        originalTenantId: prev.originalTenantId || prev.tenantId || masterId
      };
      localStorage.setItem("ff_session", JSON.stringify(updated));
      return updated;
    });

    try {
      const [prods, ords, promos, coups] = await Promise.all([
        getProductsByTenant(selected.id, setProducts),
        getOrdersByTenant(selected.id),
        getPromotionsByTenant(selected.id, selected.networkId),
        getCouponsByTenant(selected.id, selected.networkId),
      ]);
      setProducts(prods);
      setOrders(ords);
      setPromotions(promos);
      setCoupons(coups);
      window.dispatchEvent(new CustomEvent("ff_tenant_switched", { detail: selected.id }));
    } catch (e) {
      console.warn("Error switching tenant:", e);
    } finally {
      setIsSwitchingTenant(false);
    }
  }, [currentTenant?.id, currentTenant?.isNetworkMaster, currentTenant?.networkId, isMatrixAdmin]);

  const [products, setProducts] = useState<Product[]>([]);
  const [matrizProducts, setMatrizProducts] = useState<Product[]>([]);
  const [promotions, setPromotions] = useState<PromotionRule[]>([]);
  const [coupons, setCoupons] = useState<CouponRule[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  useSWR(currentTenant ? `orders-trigger-${currentTenant.id}` : null, async () => {
    const ords = await getOrdersByTenant(currentTenant.id);
    setOrders(ords);
    return true;
  });
  useSWR(currentTenant ? `orders-trigger-${currentTenant.id}` : null, async () => {
    const ords = await getOrdersByTenant(currentTenant.id);
    setOrders(ords);
    return true;
  });
  const uniqueOrders = useMemo(() => {
    const uniqueMap = new Map<string, Order>();
    (orders || []).forEach((o) => {
      if (o && o.id) {
        uniqueMap.set(o.id, o);
      }
    });
    return Array.from(uniqueMap.values());
  }, [orders]);
  const [recentAlerts, setRecentAlerts] = useState<any[]>([]);
  const [unacknowledgedOrders, setUnacknowledgedOrders] = useState<Order[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showAddedFeedback, setShowAddedFeedback] = useState(false);
  const [globalToast, setGlobalToast] = useState<string | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);

  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const productModalScrollRef = useRef<HTMLDivElement>(null);

  // Scroll to top of product modal whenever a new product is selected
  useEffect(() => {
    if (selectedProduct) {
      if (productModalScrollRef.current) {
        productModalScrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
      }
      const scrollEl = document.getElementById("product-detail-scroll-container");
      if (scrollEl) {
        scrollEl.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
  }, [selectedProduct?.id]);

  // --- DYNAMIC MANIFEST UPDATE ---
  useEffect(() => {
    // Detecta se o usuário está no contexto administrativo/gestão ou vitrine do cliente
    const isAdminContext =
      view === ViewMode.ADMIN_PHARMACY ||
      view === ViewMode.ADMIN_SUPER ||
      view === ViewMode.LOGIN ||
      session.type === "PHARMACY_ADMIN" ||
      session.type === "SUPER_ADMIN" ||
      window.location.pathname.startsWith("/admin") ||
      window.location.pathname.startsWith("/login");

    const tenantId =
      currentTenant?.id ||
      (session.type === "PHARMACY_ADMIN" ? session.tenantId : null) ||
      "default";

    const targetHref = isAdminContext
      ? `/api/v1/manifest/${tenantId}?context=admin`
      : tenantId !== "default"
        ? `/api/v1/manifest/${tenantId}`
        : `/manifest.json`;

    // Atualiza dinamicamente o link do manifesto no <head> recriando o elemento para forçar reavaliação nos navegadores
    const existingLink = document.getElementById("manifest-link") as HTMLLinkElement | null;
    if (existingLink) {
      if (existingLink.getAttribute("href") !== targetHref) {
        existingLink.remove();
        const newLink = document.createElement("link");
        newLink.id = "manifest-link";
        newLink.rel = "manifest";
        newLink.href = targetHref;
        document.head.appendChild(newLink);
      }
    } else {
      const newLink = document.createElement("link");
      newLink.id = "manifest-link";
      newLink.rel = "manifest";
      newLink.href = targetHref;
      document.head.appendChild(newLink);
    }
  }, [currentTenant?.id, view, session.type, (session as any).tenantId]);

  // --- PWA INSTALL TRACKING ---
  useEffect(() => {
    if (!currentTenant) return;
    
    const handleAppInstalled = () => {
      if (localStorage.getItem(`pwa_installed_${currentTenant.id}`)) return;
      localStorage.setItem(`pwa_installed_${currentTenant.id}`, "true");

      fetch(`/api/v1/analytics/${currentTenant.id}/install`, {
        method: "POST",
      }).catch(console.error);
    };

    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, [currentTenant?.id]);

  // --- TRAFFIC SOURCE TRACKING ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const source = params.get("source");
    if (source) {
      sessionStorage.setItem("traffic_source", source.toLowerCase());
    }
  }, []);

  const handleProductClick = useCallback((product: Product) => {
    setSelectedProduct(product);
    if (productModalScrollRef.current) {
      productModalScrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
    const scrollEl = document.getElementById("product-detail-scroll-container");
    if (scrollEl) {
      scrollEl.scrollTo({ top: 0, behavior: "smooth" });
    }
    
    // On-demand fetch of detailed product properties (payload reduction pattern)
    fetch(`/api/v1/products/${encodeURIComponent(product.id)}`)
      .then(res => {
        if (!res.ok) throw new Error("Failed to fetch product details");
        return res.json();
      })
      .then(dbProduct => {
        if (dbProduct) {
          const fullProduct = mapDbProductToApp(dbProduct);
          setSelectedProduct(prev => {
            if (prev && prev.id === product.id) {
              return {
                ...prev,
                description: fullProduct.description || prev.description,
                indications: fullProduct.indications || prev.indications,
                usage: fullProduct.usage || prev.usage,
                sideEffects: fullProduct.sideEffects || prev.sideEffects,
                contraindications: fullProduct.contraindications || prev.contraindications,
                image_url_2: fullProduct.image_url_2 || (prev as any).image_url_2,
                image_url_3: fullProduct.image_url_3 || (prev as any).image_url_3,
                videoUri: fullProduct.videoUri || prev.videoUri,
              };
            }
            return prev;
          });
        }
      })
      .catch(err => console.warn("Could not load full product details:", err));
    
    if (currentTenant?.id) {
      const source = sessionStorage.getItem("traffic_source") || "direct";
      fetch(`/api/v1/analytics/${currentTenant.id}/track-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          productName: product.name,
          source: source
        })
      }).catch(err => console.warn("Analytics tracking failed:", err));
    }
  }, [currentTenant?.id]);

  // --- DEEP LINKING (Direct Product Modal & Search from AI Agent / WhatsApp Links) ---
  const deepLinkProcessedRef = useRef<string | null>(null);
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const prodParam =
        params.get("produto") ||
        params.get("prod") ||
        params.get("product") ||
        params.get("p_id") ||
        params.get("item") ||
        sessionStorage.getItem("ff_deeplink_produto");

      const searchParam =
        params.get("busca") ||
        params.get("q") ||
        params.get("search") ||
        params.get("termo") ||
        sessionStorage.getItem("ff_deeplink_busca");

      if (prodParam && deepLinkProcessedRef.current !== `prod_${prodParam}`) {
        const cleanParam = prodParam.trim();
        let targetProd: Product | undefined = undefined;

        if (products && products.length > 0) {
          targetProd = products.find(
            (p) =>
              String(p.id).toLowerCase() === cleanParam.toLowerCase() ||
              ((p as any).slug &&
                (p as any).slug.toLowerCase() === cleanParam.toLowerCase()) ||
              (p.barcode && p.barcode.toLowerCase() === cleanParam.toLowerCase()) ||
              (p.internalCode &&
                p.internalCode.toLowerCase() === cleanParam.toLowerCase()) ||
              (p.name && p.name.toLowerCase().includes(cleanParam.toLowerCase())),
          );
        }

        if (targetProd) {
          deepLinkProcessedRef.current = `prod_${prodParam}`;
          sessionStorage.removeItem("ff_deeplink_produto");
          handleProductClick(targetProd);
        } else {
          // Se não encontrou na lista carregada no cliente, busca direto na API
          fetch(`/api/v1/products/${encodeURIComponent(cleanParam)}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((dbProd) => {
              if (dbProd && dbProd.id) {
                deepLinkProcessedRef.current = `prod_${prodParam}`;
                sessionStorage.removeItem("ff_deeplink_produto");
                const fullProd = mapDbProductToApp(dbProd);
                handleProductClick(fullProd);
              }
            })
            .catch((err) => console.warn("Failed direct deeplink fetch:", err));
        }
      }

      if (
        searchParam &&
        deepLinkProcessedRef.current !== `search_${searchParam}`
      ) {
        deepLinkProcessedRef.current = `search_${searchParam}`;
        sessionStorage.removeItem("ff_deeplink_busca");
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("ff_search", { detail: searchParam }),
          );
        }, 150);
      }
    } catch (e) {
      console.warn("Deep link resolution error:", e);
    }
  }, [products, handleProductClick]);

  // --- NATIVE BACK BUTTON HANDLING (Browser History Sync) ---
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      // Se houver uma imagem com zoom aberta, fechamos e voltamos
      if (zoomImage) {
        setZoomImage(null);
        return;
      }

      // Se houver um produto selecionado (modal de detalhes), fechamos
      if (selectedProduct) {
        setSelectedProduct(null);
        return;
      }

      // Se a sidebar mobile estiver aberta, fechamos
      if (isSidebarOpen) {
        setIsSidebarOpen(false);
        return;
      }

      // Lógica de navegação de visualização
      const state = event.state;
      if (state && state.view) {
        setView(state.view);
      } else if (view === ViewMode.CART) {
        setView(ViewMode.CATALOG);
      } else if (view === ViewMode.ADMIN_PHARMACY && adminTab !== "dashboard") {
        setAdminTab("dashboard");
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [selectedProduct, zoomImage, isSidebarOpen, view, adminTab]);

  // Sincroniza o estado atual com a URL/History quando algo "navegável" muda
  useEffect(() => {
    const hasModalOpen = !!selectedProduct || !!zoomImage || isSidebarOpen;

    // Se abrimos um modal, empurramos um estado para o histórico para que o 'back' possa fechá-lo
    if (hasModalOpen) {
      window.history.pushState({ isModal: true, view, adminTab }, "");
    }
  }, [selectedProduct, zoomImage, isSidebarOpen]);

  const handleLogout = async () => {
    try {
      // 1. Destrói a sessão no servidor do Supabase primeiro
      await supabase.auth.signOut();
    } catch (error) {
      console.error("Erro no signOut do Supabase:", error);
    } finally {
      // 2. Limpa os storages locais APENAS neste momento manual
      localStorage.clear();
      sessionStorage.clear();

      // 3. Força o redirecionamento duro limpando toda a memória RAM
      window.location.href = "/login";
    }
  };

  const handleViewChange = useCallback(
    async (newView: ViewMode) => {
      if (newView === ViewMode.LOGIN) {
        handleLogout();
        return;
      } else {
        // Se formos para o CATALOG e estarmos visualizando da perspectiva de um admin,
        // a URL precisa refletir a loja para que se copiada ou recarregada não caia no portal.
        let newUrl = "";
        if (newView === ViewMode.CATALOG && currentTenant) {
          newUrl = `/loja/${currentTenant.slug || currentTenant.id}/`;
        }
        window.history.pushState(
          { view: newView, adminTab },
          "",
          newUrl || undefined,
        );
      }

      if (newView === ViewMode.ADMIN_SUPER) {
        setProducts([]);
        setOrders([]);
        setCurrentTenant(null);
      }

      setView(newView);
    },
    [adminTab, currentTenant],
  );

  const handleSearch = useCallback(
    (term: string, count: number) => {
      if (currentTenant) {
        logSearch(currentTenant.id, term, count);
      }
    },
    [currentTenant?.id],
  );

  // --- END OF NAVIGATION HANDLING ---

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "SIGNED_OUT") {
        setSession({ type: "GUEST" });
      } else if ((event === "TOKEN_REFRESHED" || event === "SIGNED_IN" || event === "INITIAL_SESSION") && s) {
        setSession(prev => {
           if (prev.type === "GUEST") return prev;
           const updated = { ...prev, access_token: s.access_token, refresh_token: s.refresh_token };
           localStorage.setItem("ff_session", JSON.stringify(updated));
           return updated;
        });
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    localStorage.setItem("ff_session", JSON.stringify(session));
    localStorage.setItem("ff_view", view);
    localStorage.setItem("ff_admin_tab", adminTab);
    if (currentTenant) {
      localStorage.setItem("ff_tenant", JSON.stringify(currentTenant));
    } else {
      localStorage.removeItem("ff_tenant");
    }
  }, [session, view, adminTab, currentTenant]);

  useEffect(() => {
    if (currentTenant) {
      setCart((prev) => {
        const filtered = prev.filter(
          (item) => item.tenantId === currentTenant.id,
        );
        return filtered.length !== prev.length ? filtered : prev;
      });
    } else {
      setCart([]);
    }
  }, [currentTenant?.id]);

  const hasFixedOrphans = React.useRef(false);

  useEffect(() => {
    hasFixedOrphans.current = false;
  }, [currentTenant?.id]);

  useEffect(() => {
    const fixOrphanedProducts = async () => {
      if (currentTenant && !hasFixedOrphans.current) {
        hasFixedOrphans.current = true;
        // Verifica se existem produtos sem tenantid e os vincula ao tenant atual
        const { data, error } = await supabase
          .from("products")
          .update({ tenant_id: currentTenant.id })
          .is("tenant_id", null);

        if (!error && data) {
          console.log("Produtos órfãos vinculados com sucesso!");
          // Recarrega os produtos após a correção
          getProductsByTenant(currentTenant.id, setProducts, true).then(
            setProducts,
          );
        }
      }
    };
    fixOrphanedProducts();
  }, [currentTenant?.id]);

  useEffect(() => {
    if (currentTenant && !isLoading) {
      getProductsByTenant(currentTenant.id, setProducts).then(setProducts);
      getOrdersByTenant(currentTenant.id).then(setOrders);
      getPromotionsByTenant(currentTenant.id, currentTenant.networkId).then(setPromotions);
      getCouponsByTenant(currentTenant.id, currentTenant.networkId).then(setCoupons);
    }
  }, [currentTenant?.id, isLoading]);

  useEffect(() => {
    if (currentTenant?.networkId && currentTenant.networkId !== currentTenant.id) {
      getProductsByTenant(currentTenant.networkId, setMatrizProducts)
        .then((initialProds) => {
          setMatrizProducts((prev) => (prev.length === 0 && initialProds.length > 0 ? initialProds : prev));
        })
        .catch(console.error);
    } else {
      setMatrizProducts([]);
    }
  }, [currentTenant?.id, currentTenant?.networkId]);

  // Realtime subscription for orders
  useEffect(() => {
    if (
      !currentTenant ||
      (session?.type !== "PHARMACY_ADMIN" && session?.type !== "SUPER_ADMIN")
    )
      return;

    // Request notification permission
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    const channel = supabase
      .channel(`public:orders:tenant_id=eq.${currentTenant.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "orders",
          filter: `tenant_id=eq.${currentTenant.id}`,
        },
        (payload) => {
          const newOrderDb = payload.new;
          const newOrderApp = mapDbOrderToApp(newOrderDb);

          if (newOrderApp.status === "pending") {
            setUnacknowledgedOrders((prev) => [...prev, newOrderApp]);

            // Força disparo de evento visual (Toast) em toda a tela para qualquer perfil
            toast("🚨 Novo Pedido Recebido!", {
              duration: 8000,
              style: {
                background: "#ef4444",
                color: "#fff",
                fontWeight: "bold",
              },
            });

            // Show browser notification using service worker if available
            if (
              "serviceWorker" in navigator &&
              Notification.permission === "granted"
            ) {
              navigator.serviceWorker.ready.then((registration) => {
                const options: any = {
                  body: `Cliente: ${newOrderApp.customer.name} - Valor: R$ ${newOrderApp.total.toFixed(2)}. Clique para ver os itens.`,
                  icon: "/icon-192.png",
                  badge: "/icon-192.png",
                  vibrate: [200, 100, 200, 100, 200],
                  data: window.location.href, // Or build a specific URL if needed
                  requireInteraction: true,
                };
                registration.showNotification(
                  "📦 Novo Pedido Recebido!",
                  options,
                );
              });
            } else if (
              "Notification" in window &&
              Notification.permission === "granted"
            ) {
              new Notification("📦 Novo Pedido Recebido!", {
                body: `Cliente: ${newOrderApp.customer.name} - Valor: R$ ${newOrderApp.total.toFixed(2)}. Clique para ver os itens.`,
                icon: "/favicon.ico",
              });
            }

            // Add to recent alerts
            setRecentAlerts((prev) =>
              [
                {
                  id: Date.now().toString(),
                  title: "Novo Pedido",
                  message: `Cliente: ${newOrderApp.customer.name} - Valor: R$ ${newOrderApp.total.toFixed(2)}`,
                  time: new Date().toISOString(),
                  orderId: newOrderApp.id,
                },
                ...prev,
              ].slice(0, 50),
            ); // Keep last 50
          }

          setOrders((prev) => {
            if (!prev.find((o) => o.id === newOrderApp.id)) {
              return [newOrderApp, ...prev];
            }
            return prev;
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentTenant?.id, session?.type]);

  // Realtime subscription for products
  const lastGlowTimeRef = React.useRef<number>(0);

  useEffect(() => {
    if (!currentTenant) return;

    const channel = supabase
      .channel(`public:products:tenant_id=eq.${currentTenant.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "products",
          filter: `tenant_id=eq.${currentTenant.id}`,
        },
        (payload) => {
          const updatedProductDb = payload.new;
          const updatedProductApp = mapDbProductToApp(updatedProductDb);

          setProducts((prev) => {
            const idx = prev.findIndex((p) => p.id === updatedProductApp.id);
            if (idx > -1) {
              const newProducts = [...prev];
              const now = Date.now();
              // Throttling the visual glow to once every 2 seconds
              if (now - lastGlowTimeRef.current > 2000) {
                newProducts[idx] = {
                  ...updatedProductApp,
                  _justUpdated: true,
                } as any;
                lastGlowTimeRef.current = now;
              } else {
                newProducts[idx] = updatedProductApp;
              }
              return newProducts;
            }
            return prev;
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentTenant?.id]);

  useEffect(() => {
    if (!currentTenant) return;

    // Supabase Realtime Listener
    const channel = supabase
      .channel(`public:promotions:tenant_id=eq.${currentTenant.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "promotions",
          filter: `tenant_id=eq.${currentTenant.id}`,
        },
        async () => {
          // Re-fetch all promotions for simplicity
          const promos = await getPromotionsByTenant(currentTenant.id, currentTenant.networkId);
          if (Array.isArray(promos)) {
            setPromotions(promos);
          }
          const coups = await getCouponsByTenant(currentTenant.id, currentTenant.networkId);
          if (Array.isArray(coups)) {
            setCoupons(coups);
          }
        },
      )
      .subscribe();

    // High-frequency polling fallback (10 seconds)
    const interval = setInterval(async () => {
      try {
        const promos = await getPromotionsByTenant(currentTenant.id, currentTenant.networkId);
        if (Array.isArray(promos)) {
          setPromotions((prev) =>
            JSON.stringify(prev) !== JSON.stringify(promos) ? promos : prev,
          );
        }

        const coups = await getCouponsByTenant(currentTenant.id, currentTenant.networkId);
        if (Array.isArray(coups)) {
          setCoupons((prev) =>
            JSON.stringify(prev) !== JSON.stringify(coups) ? coups : prev,
          );
        }
      } catch (e) {
        console.error("Error polling promotions/coupons run:", e);
      }
    }, 10000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [currentTenant?.id]);

  // Clear the _justUpdated flag after a short delay
  useEffect(() => {
    const hasUpdated = products.some((p) => (p as any)._justUpdated);
    if (hasUpdated) {
      const timer = setTimeout(() => {
        setProducts((prev) =>
          prev.map((p) => {
            if ((p as any)._justUpdated) {
              const { _justUpdated, ...rest } = p as any;
              return rest as Product;
            }
            return p;
          }),
        );
      }, 2000); // 2 seconds flash
      return () => clearTimeout(timer);
    }
  }, [products]);

  // Cart validation against products
  useEffect(() => {
    if (cart.length === 0 || products.length === 0) return;

    let cartChanged = false;
    const newCart = cart
      .map((item) => {
        const product = products.find((p) => p.id === item.id);
        if (product && product.stock < item.quantity) {
          cartChanged = true;
          if (product.stock <= 0) {
            alert(
              `Ops! O item "${product.name}" acabou de ser vendido no balcão físico e não está mais disponível.`,
            );
            return { ...item, quantity: 0, _remove: true };
          } else {
            alert(
              `Atenção: O estoque do item "${product.name}" foi atualizado no balcão físico e ajustamos sua quantidade para garantir sua entrega.`,
            );
            return { ...item, quantity: product.stock };
          }
        }
        return item;
      })
      .filter((item) => !(item as any)._remove);

    if (cartChanged) {
      setCart(newCart);
    }
  }, [products]);

  useEffect(() => {
    if (selectedProduct) {
      let initialImage = fixImageUrl(selectedProduct.image) || null;

      const isGeneric =
        selectedProduct.drugType?.trim().toLowerCase() === "genérico" ||
        selectedProduct.drugType?.trim().toLowerCase() === "generico";
      if (!initialImage && isGeneric) {
        const mfgKey = selectedProduct.manufacturer
          ? Object.keys(currentTenant?.manufacturerLogos || {}).find(
              (k) =>
                k.trim().toLowerCase() ===
                selectedProduct.manufacturer?.trim().toLowerCase(),
            )
          : null;
        if (mfgKey && currentTenant?.manufacturerLogos?.[mfgKey]) {
          initialImage = fixImageUrl(currentTenant.manufacturerLogos[mfgKey]);
        } else {
          initialImage = GENERIC_PLACEHOLDER;
        }
      }
      setPreviewImage(initialImage);
    } else {
      setPreviewImage(null);
    }
  }, [selectedProduct, currentTenant]);

  const [activePromoIds, setActivePromoIds] = useState("");

  useEffect(() => {
    const getActiveIds = () => {
      const now = new Date();
      return promotions
        .filter((p) => isPromotionActive(p, now))
        .map((p) => p.id)
        .sort()
        .join(",");
    };

    setActivePromoIds(getActiveIds());
    const interval = setInterval(() => {
      const currentIds = getActiveIds();
      setActivePromoIds((prev) => (prev !== currentIds ? currentIds : prev));
    }, 1000);

    return () => clearInterval(interval);
  }, [promotions]);

  const variableCombosForSelected = useMemo(() => {
    if (!selectedProduct) return [];
    return getVariableCombosForProduct(
      selectedProduct,
      promotions,
      products,
      matrizProducts,
      currentTenant?.id,
    );
  }, [selectedProduct, promotions, products, matrizProducts, currentTenant?.id]);

  const activePromotionForSelected = useMemo(() => {
    if (!selectedProduct || promotions.length === 0) return null;
    const idSet = new Set(activePromoIds.split(",").filter(Boolean));

    return promotions.find((p) => {
      if (!idSet.has(p.id)) return false;
      if (p.type === "VARIABLE_COMBO" || (p.type as string) === "COMBO_VARIABLE") return false;
      return checkProductMatchesRule(p, selectedProduct, matrizProducts, currentTenant?.id);
    });
  }, [selectedProduct, promotions, activePromoIds, matrizProducts, currentTenant?.id]);

  const volumePromoForSelected = useMemo(() => {
    if (!selectedProduct) return null;
    return getProductVolumePromotionInfo(selectedProduct, promotions);
  }, [selectedProduct, promotions]);

  // moved isMedicine logic to root level of component or file
  const normalize = (s: string) =>
    (s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const checkIsMedicine = (p: Product) => {
    const nCat = normalize(p.category);

    // Explicitly exclude perfumery, hygiene, cosmetics, etc.
    if (
      nCat.includes("perfumaria") ||
      nCat.includes("higiene") ||
      nCat.includes("cosmetico") ||
      nCat.includes("beleza") ||
      nCat.includes("absorvente") ||
      nCat.includes("fralda") ||
      nCat.includes("infantil") ||
      nCat.includes("ortopedia") ||
      nCat.includes("conveniencia") ||
      nCat.includes("desodorante") ||
      nCat.includes("cabelo") ||
      nCat.includes("pele") ||
      nCat.includes("bucal") ||
      nCat.includes("banho") ||
      nCat.includes("dermo")
    ) {
      return false;
    }

    if (
      nCat.includes("medicamento") ||
      nCat.includes("remedio") ||
      nCat.includes("farma")
    )
      return true;

    if (p.activePrinciple) return true;
    if (p.requires_prescription) return true;
    if (p.drugType) return true;

    return false;
  };

  const productSuggestions = useMemo(() => {
    if (!selectedProduct || !currentTenant || products.length === 0)
      return {
        samePrinciple: [],
        otherSuggestions: [],
        selectedInfo: { dosage: "", presentationType: "" },
      };

    const parseDosageAndPresentation = (
      productName: string,
      presentationField?: string,
    ) => {
      const name = normalize(productName);
      const pres = normalize(presentationField || "");

      const dosageRegex =
        /\b(\d+(?:[.,]\d+)?\s*(?:mg|g|mcg|ml|ui|u\.i\.|meq|%)(?:\/\d*(?:ml|g|mg))?)\b/i;

      let dosage = "";
      const nameDosageMatch = name.match(dosageRegex);
      if (nameDosageMatch) {
        dosage = nameDosageMatch[1].replace(/\s+/g, "");
      } else {
        const presDosageMatch = pres.match(dosageRegex);
        if (presDosageMatch) {
          dosage = presDosageMatch[1].replace(/\s+/g, "");
        }
      }

      let presentationType = "";
      const presTypes = [
        {
          type: "comprimido",
          keywords: [
            "comprimido",
            "comprimidos",
            "comp",
            "cpr",
            "drg",
            "dragea",
            "drageas",
            "capsula",
            "capsulas",
            "cap",
            "caps",
            "cps",
          ],
        },
        { type: "gotas", keywords: ["gotas", "gota", "gts"] },
        {
          type: "xarope",
          keywords: [
            "xarope",
            "xaropes",
            "xpe",
            "solucao oral",
            "suspensao oral",
          ],
        },
        {
          type: "pomada",
          keywords: [
            "pomada",
            "pomadas",
            "pom",
            "creme",
            "cremes",
            "gel",
            "geis",
          ],
        },
        {
          type: "injetavel",
          keywords: [
            "injetavel",
            "injetaveis",
            "inj",
            "ampola",
            "ampolas",
            "amp",
          ],
        },
        {
          type: "supositorio",
          keywords: ["supositorio", "supositorios", "sup"],
        },
        { type: "po", keywords: ["po", "envelope", "envelopes", "env"] },
        { type: "spray", keywords: ["spray", "sprays", "aerosol", "aerosois"] },
        {
          type: "colirio",
          keywords: ["colirio", "colirios", "solucao oftalmica"],
        },
      ];

      for (const pt of presTypes) {
        if (
          pt.keywords.some(
            (k) =>
              name.match(new RegExp(`\\b${k}\\b`)) ||
              pres.match(new RegExp(`\\b${k}\\b`)),
          )
        ) {
          presentationType = pt.type;
          break;
        }
      }

      return { dosage, presentationType };
    };

    const selectedInfo = parseDosageAndPresentation(
      selectedProduct.name,
      selectedProduct.presentation,
    );

    const otherProducts = products.filter(
      (p) => p.id !== selectedProduct.id && p.stock > 0,
    );

    const salesCounts: Record<string, number> = {};
    orders.forEach((order) => {
      order.items.forEach((item) => {
        salesCounts[item.id] = (salesCounts[item.id] || 0) + item.quantity;
      });
    });

    const isSelectedMedicine = checkIsMedicine(selectedProduct);
    const validPrinciple =
      selectedProduct.activePrinciple &&
      !["isento", "n/a", "nenhum", "nao se aplica"].includes(
        normalize(selectedProduct.activePrinciple),
      );

    let samePrinciple: any[] = [];
    let samePrincipleTitle = "Opções com a mesma fórmula";
    let samePrincipleSubtitle = "Mesma fórmula e apresentação";

    // Trava de Categoria (Hard Constraint)
    const categoryRestrictedProducts = otherProducts.filter(
      (p) => p.category === selectedProduct.category,
    );

    if (isSelectedMedicine && validPrinciple) {
      samePrinciple = categoryRestrictedProducts
        .filter((p) => {
          if (!p.activePrinciple) return false;
          return (
            normalize(p.activePrinciple) ===
            normalize(selectedProduct.activePrinciple)
          );
        })
        .map((p) => {
          const pInfo = parseDosageAndPresentation(p.name, p.presentation);
          let matchScore = 0;
          if (selectedInfo.dosage && pInfo.dosage === selectedInfo.dosage)
            matchScore += 2;
          if (
            selectedInfo.presentationType &&
            pInfo.presentationType === selectedInfo.presentationType
          )
            matchScore += 1;
          return { ...p, suggestionBadge: "Mesma Fórmula", matchScore };
        })
        .sort((a, b) => {
          if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
          return a.price - b.price;
        });

      if (selectedInfo.dosage || selectedInfo.presentationType) {
        samePrincipleTitle =
          `Opções equivalentes em ${selectedInfo.dosage || ""} ${selectedInfo.presentationType ? selectedInfo.presentationType.charAt(0).toUpperCase() + selectedInfo.presentationType.slice(1) : ""}`.trim();
      }
    } else {
      // Nova Lógica para Perfumaria, Dermo, Fraldas e Higiene (Priorizando Tipo Comercial)
      const nCatStr = normalize(selectedProduct.category);
      let customVariantWord = "opções";
      if (
        nCatStr.includes("desodorante") ||
        nCatStr.includes("sabonete") ||
        nCatStr.includes("perfume")
      ) {
        customVariantWord = "fragrâncias";
      } else if (nCatStr.includes("fralda")) {
        customVariantWord = "tamanhos";
      } else if (
        nCatStr.includes("cabelo") ||
        nCatStr.includes("shampoo") ||
        nCatStr.includes("tintura")
      ) {
        customVariantWord = "variações/cores";
      }

      if (selectedProduct.manufacturer) {
        // Se as palavras-chave já incluem a marca, evita "fragrâncias de Rexona de Rexona"
        samePrincipleTitle = `Mais ${customVariantWord} de ${selectedProduct.manufacturer}`;
      } else {
        samePrincipleTitle = `Outras ${customVariantWord} deste produto`;
      }

      samePrincipleSubtitle = "Variações da mesma linha ou fabricante";

      const hasGroupingSlug =
        selectedProduct.groupingSlug &&
        selectedProduct.groupingSlug.trim() !== "";

      const getBaseTokens = (name: string) => {
        let n = normalize(name);
        n = n.replace(
          /\b(kit|l\d+p\d+|leve\s*\d+\s*pague|pack|promocional|combo)\b/g,
          "",
        );
        n = n.replace(
          /\b(\d+(?:[.,]\d+)?\s*(?:g|mg|ml|l|kg|un|unidades?))\b/g,
          "",
        );
        // Remove tamanhos de fralda
        n = n.replace(/\b(rn|p|m|g|gg|xg|xxg)\b/g, "");
        return n.split(" ").filter((w) => w.length > 2); // Palavras com mais de 2 letras
      };

      const getCommercialType = (name: string) => {
        const n = normalize(name);
        if (
          n.includes("kit") ||
          n.match(/l\d+p\d+/) ||
          n.match(/leve\s*\d+\s*pague/)
        )
          return "kit";
        return "unit";
      };

      const extractSizeOrVariant = (name: string, category: string) => {
        const n = name.toUpperCase();
        // Evitar conflito com "COM", "OU", etc.
        if (normalize(category).includes("fralda")) {
          const match = n.match(/\b(RN|P|M|G|GG|XG|XXG)\b/);
          if (match) return `Tam. ${match[1]}`;
        }
        const sizeMatch = n.match(
          /\b(\d+(?:[.,]\d+)?\s*(?:G|MG|ML|L|KG|UN|UNIDADES?))\b/,
        );
        if (sizeMatch) return sizeMatch[1];
        return "Variação";
      };

      const selectedTokens = getBaseTokens(selectedProduct.name);
      const selectedCT = getCommercialType(selectedProduct.name);
      const selectedPrice = selectedProduct.price;

      const possibleSuggestions = categoryRestrictedProducts
        .map((p) => {
          let score = 0;
          const isSameBrand =
            p.manufacturer &&
            selectedProduct.manufacturer &&
            p.manufacturer === selectedProduct.manufacturer;
          const isSamePrice = Math.abs(p.price - selectedPrice) < 0.01;
          const isSimilarPrice =
            p.price >= selectedPrice * 0.95 && p.price <= selectedPrice * 1.05;

          // Priority 0: Exact Grouping Slug match
          if (
            hasGroupingSlug &&
            p.groupingSlug === selectedProduct.groupingSlug
          ) {
            score += 1000;
          }

          // Priority 1: Similar Base Name (Size Grid / Line Variation)
          const pTokens = getBaseTokens(p.name);
          let tokenMatches = 0;
          selectedTokens.forEach((t) => {
            if (pTokens.includes(t)) tokenMatches++;
          });

          const requiredMatches = Math.min(2, selectedTokens.length);
          const isSameLine =
            tokenMatches >= requiredMatches && tokenMatches > 0;

          if (isSameLine) {
            score += tokenMatches * 10;
            score += 100; // Base presence bonus
          }

          // Priority 2: Cross-Selling Same Brand (Already same category because of Category filter)
          const isCrossSell = isSameBrand && !isSameLine;

          if (!isSameLine && !isCrossSell) {
            return null; // Don't suggest
          }

          if (isSameBrand) score += 10;

          // Formato Comercial
          const pCT = getCommercialType(p.name);
          if (pCT === selectedCT) {
            score += 50;
          }

          // Filtro de Assertividade (Preço idêntico = Mesma oferta de valor)
          if (isSamePrice) {
            score += 200; // Prioridade absurda
          } else if (isSimilarPrice) {
            score += 50;
          }

          // Se for cross-sell, precisa ser parecido no preço para não poluir
          if (!isSameLine && !isSimilarPrice) {
            return null;
          }

          let badge = p.variantAttribute;
          if (!badge) {
            if (isSameLine) badge = extractSizeOrVariant(p.name, p.category);
            else if (isCrossSell) badge = "Combinar";
            else badge = pCT === "kit" ? "Opção em Kit" : "Unidade Genérica";
          }

          return { ...p, suggestionBadge: badge, matchScore: score };
        })
        .filter(Boolean);

      samePrinciple = (possibleSuggestions as any[]).sort((a, b) => {
        if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
        return a.price - b.price;
      });
    }

    const fbtCounts: Record<string, number> = {};
    orders.forEach((order) => {
      if (order.items.some((item) => item.id === selectedProduct.id)) {
        order.items.forEach((item) => {
          if (item.id !== selectedProduct.id) {
            fbtCounts[item.id] = (fbtCounts[item.id] || 0) + 1;
          }
        });
      }
    });

    const isPediatric = (name: string, cat: string) => {
      const n = normalize(name + " " + cat);
      return (
        n.includes("infantil") ||
        n.includes("bebe") ||
        n.includes("pediatrico") ||
        n.includes("fralda")
      );
    };

    const selectedIsPediatric = isPediatric(
      selectedProduct.name,
      selectedProduct.category,
    );

    const TAG_AFFINITY = [
      {
        keywords: [
          "dipirona",
          "paracetamol",
          "dor",
          "febre",
          "analgesico",
          "ibuprofeno",
        ],
        affinities: [
          "vitamina c",
          "termometro",
          "antigripal",
          "gripe",
          "resfriado",
        ],
      },
      {
        keywords: [
          "antiacido",
          "laxante",
          "digestao",
          "estomago",
          "figado",
          "epocler",
          "eno",
          "digestivo",
        ],
        affinities: ["probiotico", "cha", "soro", "reidratante", "flora"],
      },
      {
        keywords: [
          "pasta",
          "dente",
          "creme dental",
          "higiene oral",
          "bucal",
          "colgate",
          "sorriso",
        ],
        affinities: [
          "fio dental",
          "enxaguante",
          "escova",
          "antisseptico bucal",
        ],
      },
      {
        keywords: [
          "absorvente",
          "intimo",
          "colica",
          "feminino",
          "mulher",
          "sempre livre",
          "intimus",
        ],
        affinities: [
          "sabonete intimo",
          "analgesico",
          "hidratante",
          "buscopan",
          "ponstan",
        ],
      },
      {
        keywords: [
          "barbear",
          "barba",
          "prestobarba",
          "gillette",
          "masculino",
          "homem",
        ],
        affinities: ["pos-barba", "desodorante", "shampoo", "men"],
      },
      {
        keywords: [
          "curativo",
          "gaze",
          "primeiros socorros",
          "band-aid",
          "atadura",
        ],
        affinities: [
          "antisseptico",
          "esparadrapo",
          "alcool",
          "merthiolate",
          "nebacetin",
        ],
      },
      {
        keywords: [
          "protetor solar",
          "dermocosmetico",
          "solar",
          "sundown",
          "nivea sun",
        ],
        affinities: [
          "hidratante facial",
          "agua micelar",
          "lip balm",
          "pos sol",
          "facial",
        ],
      },
    ];

    const prodNameCat = normalize(
      selectedProduct.name + " " + selectedProduct.category,
    );
    let activeAffinities: string[] = [];
    for (const mapping of TAG_AFFINITY) {
      if (mapping.keywords.some((k) => prodNameCat.includes(normalize(k)))) {
        activeAffinities.push(...mapping.affinities);
      }
    }

    let availableForSuggestion = otherProducts.filter(
      (p) => !samePrinciple.find((s) => s.id === p.id),
    );

    const isSelectedControlled = isControlledProduct(selectedProduct);

    if (!selectedIsPediatric) {
      availableForSuggestion = availableForSuggestion.filter(
        (p) => !isPediatric(p.name, p.category),
      );
    }

    if (isSelectedControlled) {
      availableForSuggestion = availableForSuggestion.filter(
        (p) => !isControlledProduct(p),
      );
    }

    const scoredProducts = availableForSuggestion.map((p) => {
      let score = 0;

      if (fbtCounts[p.id]) {
        score += fbtCounts[p.id] * 500; // Prioridade máxima para itens realmente comprados juntos
      }

      const pNameCat = normalize(p.name + " " + p.category);
      if (activeAffinities.some((aff) => pNameCat.includes(normalize(aff)))) {
        score += 100;
      }

      const affinityCategories =
        THERAPEUTIC_AFFINITY[selectedProduct.category] ||
        THERAPEUTIC_AFFINITY["Geral"] ||
        [];

      if (isSelectedControlled) {
        if (
          pNameCat.includes("higiene") ||
          pNameCat.includes("beleza") ||
          pNameCat.includes("perfumaria") ||
          pNameCat.includes("vitamina") ||
          pNameCat.includes("cuidados")
        ) {
          score += 50;
        }
      } else {
        if (p.category === selectedProduct.category) {
          score += 15;
        } else if (affinityCategories.includes(p.category)) {
          score += 25;
        }
      }

      const hasDiscount =
        p.promotionType === "DISCOUNT" &&
        p.originalPrice &&
        p.originalPrice > p.price;
      
      // Diminuímos o peso genérico de destaque/desconto para evitar que os mesmos produtos sempre vençam
      if (p.isFeatured) score += 40;
      if (hasDiscount) score += 30;

      score += (salesCounts[p.id] || 0) * 0.1;
      score += p.stock * 0.001;

      // Adiciona um fator pseudo-aleatório baseado no produto selecionado e no produto candidato.
      // Isso garante que a lista de sugestões (quando usa fallback) seja diferente para cada produto,
      // quebrando a repetição exata dos mesmos 10 produtos em destaque.
      const hashStr = String(selectedProduct.id) + String(p.id);
      let hash = 0;
      for (let i = 0; i < hashStr.length; i++) {
        hash = (hash << 5) - hash + hashStr.charCodeAt(i);
        hash |= 0;
      }
      const jitter = (Math.abs(hash) % 100) / 100; // 0.00 a 0.99
      score += jitter * 45; // Até 45 pontos de variabilidade

      return { product: p, score };
    });

    const sameCatProducts = scoredProducts
      .filter((sp) => sp.product.category === selectedProduct.category)
      .sort((a, b) => b.score - a.score);
    const diffCatProducts = scoredProducts
      .filter((sp) => sp.product.category !== selectedProduct.category)
      .sort((a, b) => b.score - a.score);

    const sameCatSuggestions = sameCatProducts.slice(0, 4);
    const diffCatSuggestions = diffCatProducts.slice(
      0,
      10 - sameCatSuggestions.length,
    );

    let mixedSuggestions = [...sameCatSuggestions, ...diffCatSuggestions].sort(
      (a, b) => {
        const hashStrA = String(selectedProduct.id) + String(a.product.id);
        const hashStrB = String(selectedProduct.id) + String(b.product.id);
        return hashStrA.localeCompare(hashStrB);
      },
    );

    let validSuggestions = mixedSuggestions.map((sp) => {
      let badge = "Aproveite";
      const hasDiscount =
        sp.product.promotionType === "DISCOUNT" &&
        sp.product.originalPrice &&
        sp.product.originalPrice > sp.product.price;

      if (sp.product.isFeatured) badge = "Oferta do Dia";
      else if (hasDiscount) badge = "Melhor Preço";
      else if (fbtCounts[sp.product.id]) badge = "Comprados Juntos";
      else if (sp.score >= 100) badge = "Recomendado";
      else if (salesCounts[sp.product.id] > 0) badge = "Mais Vendidos";

      return { ...sp.product, suggestionBadge: badge };
    });

    if (isSelectedControlled) {
      const topGeneral = availableForSuggestion
        .filter((p) => !validSuggestions.find((v) => v.id === p.id))
        .map((p) => ({
          product: p,
          sales: salesCounts[p.id] || 0,
          stock: p.stock,
        }))
        .sort((a, b) => {
          const hashStrA = String(selectedProduct.id) + String(a.product.id);
          const hashStrB = String(selectedProduct.id) + String(b.product.id);
          return b.sales - a.sales || b.stock - a.stock || hashStrA.localeCompare(hashStrB);
        })
        .slice(0, 10)
        .map((sp) => ({ ...sp.product, suggestionBadge: "Mais Vendidos" }));

      const selectedTop = topGeneral
        .sort((a, b) => {
          const hashStrA = String(selectedProduct.id) + String(a.id);
          const hashStrB = String(selectedProduct.id) + String(b.id);
          return hashStrA.localeCompare(hashStrB);
        })
        .slice(0, 2);
      validSuggestions = [...selectedTop, ...validSuggestions];
    }

    if (validSuggestions.length < 10) {
      const fallbackProducts = availableForSuggestion
        .filter((p) => !validSuggestions.find((v) => v.id === p.id))
        .filter((p) => {
          const nCat = normalize(p.category);
          return (
            nCat.includes("higiene") ||
            nCat.includes("beleza") ||
            nCat.includes("perfumaria")
          );
        })
        .map((p) => ({
          product: p,
          sales: salesCounts[p.id] || 0,
          stock: p.stock,
        }))
        .sort((a, b) => {
          const hashStrA = String(selectedProduct.id) + String(a.product.id);
          const hashStrB = String(selectedProduct.id) + String(b.product.id);
          return b.sales - a.sales || b.stock - a.stock || hashStrA.localeCompare(hashStrB);
        })
        .map((sp) => ({ ...sp.product, suggestionBadge: "Mais Vendidos" }));

      validSuggestions.push(...fallbackProducts);
    }

    const dedupeById = (list: any[]) => {
      const map = new Map<string, any>();
      for (const item of list) {
        if (item && item.id && !map.has(item.id)) {
          map.set(item.id, item);
        }
      }
      return Array.from(map.values());
    };

    return {
      samePrinciple: dedupeById(samePrinciple).slice(0, 5),
      samePrincipleTitle,
      samePrincipleSubtitle,
      otherSuggestions: dedupeById(validSuggestions).slice(0, 10),
      selectedInfo,
    };
  }, [selectedProduct, products, currentTenant, orders]);

  const licenseDays = useMemo(() => {
    if (!currentTenant?.licenseExpiration) return Infinity;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const exp = new Date(currentTenant.licenseExpiration);
    exp.setHours(0, 0, 0, 0);
    const diffTime = exp.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }, [currentTenant]);

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      try {
        // Verificação de versão e limpeza de cache ativa para evitar travamentos de cache nos clientes
        try {
          const clientVersion = "3.0.5";
          const res = await fetch("/api/v1/version");
          if (res.ok) {
            const data = await res.json();
            if (data && data.version && data.version !== clientVersion) {
              console.log("[FarmaFlow Auto-Update]: Nova versão detectada, limpando caches...");
              if ("caches" in window) {
                const keys = await caches.keys();
                await Promise.all(keys.map(key => caches.delete(key)));
              }
              if ("serviceWorker" in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                for (const registration of registrations) {
                  await registration.unregister();
                }
              }
              // Força o reload completo sem usar cache
              window.location.reload();
              return;
            }
          }
        } catch (versionError) {
          console.warn("Falha ao verificar versão:", versionError);
        }

        const hostname = window.location.hostname;
        const isMainDomain =
          hostname === "farmaflow.online" ||
          hostname === "www.farmaflow.online" ||
          hostname === "nexoia.online" ||
          hostname === "farmaflow.nexoia.online" ||
          hostname === "localhost" ||
          hostname.includes("run.app");
        const path = window.location.pathname;
        const hasLojaSubpath =
          path.startsWith("/loja/") || path.includes("/loja");

        let targetTenant = null;

        // 1º: Tenta resolver o tenant pelo hostname dinamicamente via backend
        if (!isMainDomain || hostname.includes("run.app")) {
          // Permite resolver no run.app por flexibilidade local
          targetTenant = await getTenantByHostname(hostname);
        }

        // 2º: Se falhou e identificamos um subdomínio válido no hostname
        const parts = hostname.split(".");
        let extractedSubdomain = "";
        if (parts.length >= 3) {
          const firstPart = parts[0];
          if (
            firstPart !== "www" &&
            firstPart !== "app" &&
            firstPart !== "admin" &&
            firstPart !== "api" &&
            firstPart !== "portal" &&
            firstPart !== "farmaflow" &&
            firstPart !== "nexoia"
          ) {
            extractedSubdomain = firstPart;
          } else if (parts.length > 3) {
            const secondPart = parts[1];
            if (
              secondPart !== "www" &&
              secondPart !== "app" &&
              secondPart !== "admin" &&
              secondPart !== "api" &&
              secondPart !== "portal" &&
              secondPart !== "farmaflow" &&
              secondPart !== "nexoia"
            ) {
              extractedSubdomain = secondPart;
            }
          }
        }

        if (!targetTenant && extractedSubdomain) {
          const tenants = await getTenants();
          targetTenant =
            tenants.find((t) => {
              const cleanSlug = (t.slug || t.id || "")
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9\s-]/g, "")
                .trim()
                .replace(/\s+/g, "-");
              const cleanSubdomain = extractedSubdomain
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9\s-]/g, "")
                .trim()
                .replace(/\s+/g, "-");
              return (
                t.id === extractedSubdomain ||
                t.slug === extractedSubdomain ||
                
                cleanSlug === cleanSubdomain
              );
            }) || null;
        }

        // 3º: Como fallback, tenta obter pelo parâmetro de URL "?p" ou "?tenant"
        const params = new URLSearchParams(window.location.search);
        const pParam = params.get("p") || params.get("tenant");

        if (!targetTenant && pParam) {
          const tenants = await getTenants();
          targetTenant =
            tenants.find((t) => {
              const cleanSlug = t.slug
                ? t.slug
                    .toLowerCase()
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, "")
                    .replace(/[^a-z0-9\s-]/g, "")
                    .trim()
                    .replace(/\s+/g, "-")
                : "";
              return (
                t.id === pParam || t.slug === pParam || cleanSlug === pParam
              );
            }) || null;
        }

        if (targetTenant) {
          const isLicenseExpired =
            targetTenant.licenseExpiration &&
            new Date(targetTenant.licenseExpiration).getTime() <
              new Date().setHours(0, 0, 0, 0);

          if (targetTenant.isBlocked || isLicenseExpired) {
            if (session.type === "GUEST") {
              setIsLoading(false);
              return;
            }
          }

          const cleanSlug = targetTenant.slug
            ? targetTenant.slug
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9\s-]/g, "")
                .trim()
                .replace(/\s+/g, "-")
            : targetTenant.id;
          sessionStorage.setItem("farmaflow_current_slug", cleanSlug);
          setCurrentTenant(targetTenant);

          const pathParam = window.location.pathname.replace(/^\//, "");
          const isAdminRoute =
            path === "/admin" ||
            path.startsWith("/admin/") ||
            pathParam === "admin" ||
            pathParam.startsWith("admin/");
          const isLoginRoute =
            path === "/login" ||
            path.startsWith("/login/") ||
            pathParam === "login" ||
            pathParam.startsWith("login/");

          if (isAdminRoute || isLoginRoute) {
            if (isLoginRoute || session.type === "GUEST") {
              setView(ViewMode.LOGIN);
              window.history.replaceState({ view: ViewMode.LOGIN, adminTab }, "");
            } else if (session.type === "SUPER_ADMIN") {
              setView(ViewMode.ADMIN_SUPER);
              window.history.replaceState({ view: ViewMode.ADMIN_SUPER, adminTab }, "");
            } else if (session.type === "PHARMACY_ADMIN") {
              const [prods, ords, promos, coups] = await Promise.all([
                getProductsByTenant(targetTenant.id, setProducts),
                getOrdersByTenant(targetTenant.id),
                getPromotionsByTenant(targetTenant.id, targetTenant.networkId),
                getCouponsByTenant(targetTenant.id, targetTenant.networkId),
              ]);
              setProducts(prods);
              setOrders(ords);
              setPromotions(promos);
              setCoupons(coups);
              setView(ViewMode.ADMIN_PHARMACY);
              window.history.replaceState({ view: ViewMode.ADMIN_PHARMACY, adminTab }, "");
            }
            setIsLoading(false);
            return;
          }

          setView(ViewMode.CATALOG);

          const [prods, promos, coups] = await Promise.all([
            getProductsByTenant(targetTenant.id, setProducts),
            getPromotionsByTenant(targetTenant.id, targetTenant.networkId),
            getCouponsByTenant(targetTenant.id, targetTenant.networkId),
          ]);
          setProducts(prods);
          setPromotions(promos);
          setCoupons(coups);
          setIsLoading(false);
          return;
        }

        if (isMainDomain && !hasLojaSubpath) {
          // É o PORTAL GLOBAL do SaaS. Limpar qualquer resquício de sub-loja em cache para isolar os contextos
          sessionStorage.removeItem("farmaflow_current_slug");
          setCurrentTenant(null);

          if (session.type !== "GUEST") {
            if (session.type === "SUPER_ADMIN") {
              setView(ViewMode.ADMIN_SUPER);
              window.history.replaceState(
                { view: ViewMode.ADMIN_SUPER, adminTab },
                "",
              );
            } else if (session.type === "PHARMACY_ADMIN") {
              // Carregar dados da loja gerenciada pelo proprietário autenticado
              const ownerTenantId = session.tenantId;
              if (ownerTenantId) {
                const tenants = await getTenants();
                const tenant = tenants.find((t) => t.id === ownerTenantId);
                if (tenant) {
                  setCurrentTenant(tenant);
                  const [prods, ords, promos, coups] = await Promise.all([
                    getProductsByTenant(tenant.id, setProducts),
                    getOrdersByTenant(tenant.id),
                    getPromotionsByTenant(tenant.id, tenant.networkId),
                    getCouponsByTenant(tenant.id, tenant.networkId),
                  ]);
                  setProducts(prods);
                  setOrders(ords);
                  setPromotions(promos);
                  setCoupons(coups);
                }
              }
              setView(ViewMode.ADMIN_PHARMACY);
              window.history.replaceState(
                { view: ViewMode.ADMIN_PHARMACY, adminTab },
                "",
              );
            }
          } else {
            setView(ViewMode.LOGIN);
            window.history.replaceState({ view: ViewMode.LOGIN, adminTab }, "");
          }
          setIsLoading(false);
          return; // Força a saída imediata do init()
        }

        // Se não existir na URL e não for hostname da loja, verificar se existe um slug ativo salvo no 'sessionStorage'
        const sessionSlug = sessionStorage.getItem("farmaflow_current_slug");
        if (sessionSlug) {
          const tenants = await getTenants();
          const tenant = tenants.find((t) => {
            const cleanSlug = t.slug
              ? t.slug
                  .toLowerCase()
                  .normalize("NFD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .replace(/[^a-z0-9\s-]/g, "")
                  .trim()
                  .replace(/\s+/g, "-")
              : "";
            return (
              t.id === sessionSlug ||
              t.slug === sessionSlug ||
              cleanSlug === sessionSlug
            );
          });
          if (tenant) {
            const currentPathParam = window.location.pathname.replace(/^\//, "");
            const isAdminRoute =
              path === "/admin" ||
              path.startsWith("/admin/") ||
              currentPathParam === "admin" ||
              currentPathParam.startsWith("admin/");
            const isLoginRoute =
              path === "/login" ||
              path.startsWith("/login/") ||
              currentPathParam === "login" ||
              currentPathParam.startsWith("login/");

            if (isAdminRoute || isLoginRoute) {
              setCurrentTenant(tenant);
              if (isLoginRoute || session.type === "GUEST") {
                setView(ViewMode.LOGIN);
                window.history.replaceState({ view: ViewMode.LOGIN, adminTab }, "");
              } else if (session.type === "SUPER_ADMIN") {
                setView(ViewMode.ADMIN_SUPER);
                window.history.replaceState({ view: ViewMode.ADMIN_SUPER, adminTab }, "");
              } else if (session.type === "PHARMACY_ADMIN") {
                const [prods, ords, promos, coups] = await Promise.all([
                  getProductsByTenant(tenant.id, setProducts),
                  getOrdersByTenant(tenant.id),
                  getPromotionsByTenant(tenant.id, tenant.networkId),
                  getCouponsByTenant(tenant.id, tenant.networkId),
                ]);
                setProducts(prods);
                setOrders(ords);
                setPromotions(promos);
                setCoupons(coups);
                setView(ViewMode.ADMIN_PHARMACY);
                window.history.replaceState({ view: ViewMode.ADMIN_PHARMACY, adminTab }, "");
              }
              setIsLoading(false);
              return;
            }

            setCurrentTenant(tenant);
            setView(ViewMode.CATALOG);

            const targetSlug = tenant.slug
              ? tenant.slug
                  .toLowerCase()
                  .normalize("NFD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .replace(/[^a-z0-9\s-]/g, "")
                  .trim()
                  .replace(/\s+/g, "-")
              : tenant.id;
            // Preservação de integridade: se não estiver no /loja/slug/ na barra de tarefas, força para elegância do PWA preservando query params
            const currentSearch = window.location.search || "";
            if (
              window.location.pathname !== `/loja/${targetSlug}/` &&
              window.location.pathname !== `/loja/${targetSlug}`
            ) {
              window.history.replaceState(
                { view: ViewMode.CATALOG, adminTab: "dashboard" },
                "",
                `/loja/${targetSlug}/${currentSearch}`,
              );
            }

            const [prods, promos, coups] = await Promise.all([
              getProductsByTenant(tenant.id, setProducts),
              getPromotionsByTenant(tenant.id, tenant.networkId),
              getCouponsByTenant(tenant.id, tenant.networkId),
            ]);
            setProducts(prods);
            setPromotions(promos);
            setCoupons(coups);
            setIsLoading(false);
            return; // Força a saída do init() aqui, evitando q o restante interfira.
          }
        }

        const pathParam = window.location.pathname.replace(/^\//, "");

        let tenantIdentifier = "";
        const hostParts = hostname.split(".");

        if (
          hostParts.length >= 3 &&
          hostParts[0] !== "www" &&
          hostParts[0] !== "app" &&
          hostParts[0] !== "admin" &&
          hostParts[0] !== "api" &&
          hostParts[0] !== "portal" &&
          hostParts[0] !== "farmaflow" &&
          hostParts[0] !== "nexoia" &&
          !hostname.includes("run.app")
        ) {
          tenantIdentifier = hostParts[0];
        }

        if (!tenantIdentifier) {
          tenantIdentifier = pathParam.startsWith("loja/")
            ? pathParam.split("/")[1]
            : pathParam;
        }

        // Se a url for a raiz absoluta e já temos um tenant salvo em cache (PWA), carrega ele
        if (!tenantIdentifier && currentTenant) {
          tenantIdentifier = currentTenant.id;
        }

        const isAdminPath =
          pathParam === "admin" ||
          pathParam.startsWith("admin/") ||
          path === "/admin" ||
          path.startsWith("/admin/");
        const isLoginPath =
          pathParam === "login" ||
          pathParam.startsWith("login/") ||
          path === "/login" ||
          path.startsWith("/login/");

        if (isAdminPath || isLoginPath) {
          const tParam = params.get("tenant") || params.get("p");
          let adminTenant = currentTenant;
          if (!adminTenant && (tParam || session.type === "PHARMACY_ADMIN")) {
            const tenants = await getTenants();
            const searchId = tParam || (session.type === "PHARMACY_ADMIN" ? session.tenantId : null);
            if (searchId) {
              adminTenant = tenants.find((t) => {
                const cleanSlug = t.slug
                  ? t.slug
                      .toLowerCase()
                      .normalize("NFD")
                      .replace(/[\u0300-\u036f]/g, "")
                      .replace(/[^a-z0-9\s-]/g, "")
                      .trim()
                      .replace(/\s+/g, "-")
                  : "";
                return (
                  t.id === searchId ||
                  t.slug === searchId ||
                  cleanSlug === searchId
                );
              }) || null;
              if (adminTenant) {
                setCurrentTenant(adminTenant);
              }
            }
          }

          if (isLoginPath || session.type === "GUEST") {
            setView(ViewMode.LOGIN);
            window.history.replaceState({ view: ViewMode.LOGIN, adminTab }, "");
          } else if (session.type === "SUPER_ADMIN") {
            setView(ViewMode.ADMIN_SUPER);
            window.history.replaceState({ view: ViewMode.ADMIN_SUPER, adminTab }, "");
          } else if (session.type === "PHARMACY_ADMIN") {
            const targetId = adminTenant?.id || session.tenantId;
            if (targetId) {
              const [prods, ords, promos, coups] = await Promise.all([
                getProductsByTenant(targetId, setProducts),
                getOrdersByTenant(targetId),
                getPromotionsByTenant(targetId, adminTenant?.networkId),
                getCouponsByTenant(targetId, adminTenant?.networkId),
              ]);
              setProducts(prods);
              setOrders(ords);
              setPromotions(promos);
              setCoupons(coups);
            }
            setView(ViewMode.ADMIN_PHARMACY);
            window.history.replaceState({ view: ViewMode.ADMIN_PHARMACY, adminTab }, "");
          }
          setIsLoading(false);
          return;
        } else if (tenantIdentifier && tenantIdentifier !== "") {
          const tenants = await getTenants();
          const tenant = tenants.find((t) => {
            const cleanSlug = t.slug
              ? t.slug
                  .toLowerCase()
                  .normalize("NFD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .replace(/[^a-z0-9\s-]/g, "")
                  .trim()
                  .replace(/\s+/g, "-")
              : "";
            return (
              t.id === tenantIdentifier ||
              t.slug === tenantIdentifier ||
              cleanSlug === tenantIdentifier ||
              t.custom_domain === hostname
            );
          });

          if (tenant) {
            setCurrentTenant(tenant);

            const isLicenseExpired =
              tenant.licenseExpiration &&
              new Date(tenant.licenseExpiration).getTime() <
                new Date().setHours(0, 0, 0, 0);

            if (tenant.isBlocked || isLicenseExpired) {
              if (session.type === "GUEST") {
                setIsLoading(false);
                return;
              }
            }

            const [prods, promos, coups] = await Promise.all([
              getProductsByTenant(tenant.id, setProducts),
              getPromotionsByTenant(tenant.id, tenant.networkId),
              getCouponsByTenant(tenant.id, tenant.networkId),
            ]);
            setProducts(prods);
            setPromotions(promos);
            setCoupons(coups);

            if (
              session.type === "PHARMACY_ADMIN" &&
              session.tenantId === tenant.id
            ) {
              const ords = await getOrdersByTenant(tenant.id);
              setOrders(ords);
            }

            setView(ViewMode.CATALOG);
            const currentFullUrl = window.location.pathname + (window.location.search || "");
            window.history.replaceState(
              { view: ViewMode.CATALOG, adminTab },
              "",
              currentFullUrl,
            );
          } else {
            console.warn(
              "Tenant não encontrado para o identificador:",
              tenantIdentifier,
            );
            if (session.type !== "GUEST") {
              setView(
                session.type === "SUPER_ADMIN"
                  ? ViewMode.ADMIN_SUPER
                  : ViewMode.ADMIN_PHARMACY,
              );
            } else {
              setView(ViewMode.LOGIN);
            }
          }
        } else if (session.type !== "GUEST") {
          if (session.type === "SUPER_ADMIN") {
            setView(ViewMode.ADMIN_SUPER);
            window.history.replaceState(
              { view: ViewMode.ADMIN_SUPER, adminTab },
              "",
            );
          } else if (session.type === "PHARMACY_ADMIN" && currentTenant) {
            const [prods, ords, promos, coups] = await Promise.all([
              getProductsByTenant(currentTenant.id, setProducts),
              getOrdersByTenant(currentTenant.id),
              getPromotionsByTenant(currentTenant.id, currentTenant.networkId),
              getCouponsByTenant(currentTenant.id, currentTenant.networkId),
            ]);
            setProducts(prods);
            setOrders(ords);
            setPromotions(promos);
            setCoupons(coups);
            setView(ViewMode.ADMIN_PHARMACY);
            window.history.replaceState(
              { view: ViewMode.ADMIN_PHARMACY, adminTab },
              "",
            );
          }
        } else {
          setView(ViewMode.LOGIN);
          window.history.replaceState({ view: ViewMode.LOGIN, adminTab }, "");
        }
      } catch (error) {
        console.error("Erro na inicialização:", error);
      } finally {
        setIsLoading(false);
      }
    };
    init();

    // Register Service Worker for Push Notifications
    if ("serviceWorker" in navigator) {
      const path = window.location.pathname;
      const lojaMatch = path.match(/^\/loja\/([^/]+)/);
      const urlTenantSlug = lojaMatch ? lojaMatch[1] : null;
      const swScope = urlTenantSlug ? `/loja/${urlTenantSlug}/` : "/";

      navigator.serviceWorker
        .register("/sw.js", { scope: swScope })
        .then((registration) => {
          console.log(
            "Service Worker registrado com sucesso no escopo:",
            registration.scope,
          );
        })
        .catch((error) => {
          console.error("Erro ao registrar Service Worker:", error);
        });
    }
  }, []);

  useEffect(() => {
    const primary = currentTenant?.primaryColor || "#059669";
    const secondary = currentTenant?.secondaryColor || primary;
    const accent = currentTenant?.accentColor || "#f59e0b";

    document.documentElement.style.setProperty("--brand-primary", primary);
    document.documentElement.style.setProperty(
      "--brand-primary-light",
      `${primary}1a`,
    );
    document.documentElement.style.setProperty("--brand-secondary", secondary);
    document.documentElement.style.setProperty("--brand-accent", accent);

    // Calculate contrast color
    const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16),
          }
        : null;
    };

    const rgb = hexToRgb(primary);
    if (rgb) {
      // YIQ equation from http://24ways.org/2010/calculating-color-contrast
      const yiq = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
      const contrastColor = yiq >= 128 ? "#000000" : "#ffffff";
      document.documentElement.style.setProperty(
        "--brand-contrast",
        contrastColor,
      );
    } else {
      document.documentElement.style.setProperty("--brand-contrast", "#ffffff");
    }
  }, [currentTenant]);

  const handleUpdateProducts = async (newProducts: Product[]) => {
    if (!currentTenant) return;
    try {
      setProducts((prev) => {
        const updated = [...prev];
        newProducts.forEach((newItem) => {
          const idx = updated.findIndex((p) => p.id === newItem.id);
          if (idx > -1) updated[idx] = newItem;
          else updated.push(newItem);
        });
        return updated;
      });

      await saveProductsByTenant(currentTenant.id, newProducts);
    } catch (error: any) {
      console.error("Erro ao salvar produtos:", error);
      const reverted = await getProductsByTenant(currentTenant.id);
      setProducts(reverted);
      throw error;
    }
  };

  const handleProductsStateUpdate = (newProducts: Product[]) => {
    setProducts((prev) => {
      const updated = [...prev];
      newProducts.forEach((newItem) => {
        const idx = updated.findIndex((p) => p.id === newItem.id);
        if (idx > -1) updated[idx] = newItem;
        else updated.push(newItem);
      });
      // CORREÇÃO CRÍTICA: Limpa o cache localforage do tenant para garantir sincronia após importação
      if (currentTenant) {
        clearProductsCache(currentTenant.id).catch(console.error);
      }
      return updated;
    });
  };

  const handleProductDelete = async (productId: string) => {
    if (!currentTenant) {
      alert("Erro crítico: Empresa não identificada. Recarregue a página.");
      return;
    }
    if (!window.confirm("Tem certeza que deseja excluir este produto?")) return;
    try {
      await deleteProduct(productId);
      setProducts((prev) => prev.filter((p) => p.id !== productId));
      // CORREÇÃO CRÍTICA: Limpa o cache localforage do tenant após exclusão
      await clearProductsCache(currentTenant.id).catch(console.error);
    } catch (error: any) {
      console.error("Erro completo:", error);
      alert(
        "Falha ao excluir produto: " + (error.message || "Tente novamente"),
      );
    }
  };

  const handleBulkProductDelete = async (productIds: string[]) => {
    if (!currentTenant) {
      alert("Erro crítico: Empresa não identificada. Recarregue a página.");
      return;
    }
    try {
      await deleteProducts(productIds);
      setProducts((prev) => prev.filter((p) => !productIds.includes(p.id)));
      // CORREÇÃO CRÍTICA: Limpa o cache localforage do tenant após exclusão em massa
      await clearProductsCache(currentTenant.id).catch(console.error);
    } catch (error: any) {
      alert("Erro na exclusão em massa: " + error.message);
      throw error;
    }
  };

  const handleDeleteTenant = async (tenantId: string) => {
    try {
      setIsLoading(true);
      await deleteTenant(tenantId);
      if (currentTenant?.id === tenantId) {
        handleViewChange(ViewMode.LOGIN);
      }
    } catch (error: any) {
      alert("Erro ao excluir empresa: " + error.message);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateConfig = async (updates: Partial<PharmacyConfig>) => {
    if (!currentTenant) {
      alert("Erro: Empresa não identificada.");
      return;
    }
    try {
      const newConfig = { ...currentTenant, ...updates };
      await saveTenant(newConfig);
      const allTenants = await getTenants();
      const freshConfig = allTenants.find((t) => t.id === newConfig.id);
      if (freshConfig) {
        setCurrentTenant(freshConfig);
      } else {
        setCurrentTenant(newConfig);
      }
    } catch (error: any) {
      console.error("Erro ao atualizar configuração:", error);
      throw error;
    }
  };

  const handleLogin = async (auth: AuthSession, tenant?: PharmacyConfig) => {
    const isSuspended =
      tenant &&
      (tenant.isBlocked === true || (tenant as any).isblocked === true);
    const isLicenseExpired =
      tenant &&
      tenant.licenseExpiration &&
      new Date(tenant.licenseExpiration).getTime() <
        new Date().setHours(0, 0, 0, 0);

    if (auth.type === "PHARMACY_ADMIN" && (isSuspended || isLicenseExpired)) {
      alert(
        isLicenseExpired
          ? "Sua licença expirou. Entre em contato com o suporte."
          : "Esta conta está suspensa. Entre em contato com o suporte do FarmaFlow.",
      );
      return;
    }

    if (auth.type === "SUPER_ADMIN") {
      const superAuth: AuthSession = {
        ...auth,
        isMatrixUser: true
      };
      setSession(superAuth);
      localStorage.setItem("ff_session", JSON.stringify(superAuth));
      setView(ViewMode.ADMIN_SUPER);
      window.history.pushState({ view: ViewMode.ADMIN_SUPER, adminTab }, "");
    } else if (auth.type === "PHARMACY_ADMIN" && tenant) {
      const isMaster = Boolean(tenant.isNetworkMaster);
      const roleStr = (auth.role || "").toLowerCase().trim();
      const isRestrictedRole = ["operador", "balconista", "atendente", "farmaceutico", "caixa", "vendedor", "entregador", "gerente"].includes(roleStr);
      const isMatrizRole = roleStr === "matriz" || roleStr === "admin_matriz" || roleStr === "network_admin" || roleStr === "master" || roleStr === "super_admin";
      const isMasterUser = !isRestrictedRole && (isMatrizRole || (isMaster && (roleStr === "owner" || roleStr === "admin" || !roleStr)) || Boolean(auth.isMatrixUser));
      const masterTenantId = isMasterUser ? (isMaster ? tenant.id : (tenant.networkId || auth.masterTenantId)) : undefined;

      const enrichedAuth: AuthSession = {
        ...auth,
        isMatrixUser: isMasterUser,
        masterTenantId: masterTenantId,
        originalTenantId: tenant.id
      };
      setSession(enrichedAuth);
      localStorage.setItem("ff_session", JSON.stringify(enrichedAuth));

      setCurrentTenant(tenant);
      localStorage.setItem("ff_tenant", JSON.stringify(tenant));
      setIsLoading(true);
      try {
        const [prods, ords, promos, coups] = await Promise.all([
          getProductsByTenant(tenant.id, setProducts),
          getOrdersByTenant(tenant.id),
          getPromotionsByTenant(tenant.id, tenant.networkId),
          getCouponsByTenant(tenant.id, tenant.networkId),
        ]);
        setProducts(prods);
        setOrders(ords);
        setPromotions(promos);
        setCoupons(coups);
        setView(ViewMode.ADMIN_PHARMACY);
        window.history.pushState(
          { view: ViewMode.ADMIN_PHARMACY, adminTab },
          "",
        );
      } catch (error) {
        console.error("Erro ao carregar dados do tenant:", error);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const abortControllerRef = React.useRef<AbortController | null>(null);

  const handleAccessTenant = async (tenant: PharmacyConfig) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setProducts([]);
    setOrders([]);
    setPromotions([]);
    setCoupons([]);

    setCurrentTenant(tenant);
    setIsSwitchingTenant(true);
    setView(ViewMode.ADMIN_PHARMACY); // Set view immediately so skeleton renders
    window.history.pushState({ view: ViewMode.ADMIN_PHARMACY, adminTab }, "");

    try {
      const [prods, ords, promos, coups] = await Promise.all([
        getProductsByTenant(
          tenant.id,
          (newProds) => {
            if (!abortController.signal.aborted) setProducts(newProds);
          },
          false,
          abortController.signal,
        ),
        getOrdersByTenant(tenant.id),
        getPromotionsByTenant(tenant.id, tenant.networkId),
        getCouponsByTenant(tenant.id, tenant.networkId),
      ]);

      if (abortController.signal.aborted) return;

      setProducts(prods);
      setOrders(ords);
      setPromotions(promos);
      setCoupons(coups);
    } catch (error: any) {
      if (error.message === "AbortError" || error.name === "AbortError") {
        console.log("Requisição cancelada (mudou de empresa).");
        return;
      }
      console.error("Erro ao acessar tenant:", error);
      setProducts([]);
      setOrders([]);
      setPromotions([]);
      setCoupons([]);
    } finally {
      if (!abortController.signal.aborted) {
        setIsSwitchingTenant(false);
      }
    }
  };

  const addToCart = (
    product: Product,
    isMainProduct: boolean = false,
    showGlobalToast: boolean = true,
    quantityToAdd: number = 1,
  ) => {
    if (product.stock <= 0) return alert("Produto esgotado!");
    const qty = Math.max(1, quantityToAdd);
    setCart((prev) => {
      const existing = prev.find((i) => i.id === product.id);
      if (existing) {
        const targetQty = existing.quantity + qty;
        if (targetQty > product.stock) {
          alert("Quantidade máxima em estoque atingida.");
          return prev.map((i) =>
            i.id === product.id ? { ...i, quantity: product.stock } : i,
          );
        }
        return prev.map((i) =>
          i.id === product.id ? { ...i, quantity: targetQty } : i,
        );
      }
      const initialQty = Math.min(qty, product.stock);
      return [...prev, { ...product, quantity: initialQty }];
    });

    if (isMainProduct) {
      setShowAddedFeedback(true);
      setTimeout(() => setShowAddedFeedback(false), 2000);
    } else if (showGlobalToast) {
      setGlobalToast(
        qty > 1
          ? `${qty} unidades adicionadas ao carrinho!`
          : "Produto adicionado ao carrinho!"
      );
      setTimeout(() => setGlobalToast(null), 2000);
    }
  };

  const updateCartQuantity = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.id === id) {
            const newQty = item.quantity + delta;
            if (newQty > item.stock) return item;
            return { ...item, quantity: Math.max(0, newQty) };
          }
          return item;
        })
        .filter((item) => item.quantity > 0),
    );
  };

  const finalizeOrder = async (
    customer: CustomerInfo,
    proposedTotal: number,
    appliedCoupon?: CouponRule,
    couponDiscount: number = 0,
    calculatedDeliveryFee: number = 0,
    deliveryMode: "delivery" | "pickup" = "delivery",
    uploadedPrescriptionUrl?: string | null,
  ) => {
    if (!currentTenant) return;
    try {
      const newId = Math.random().toString(36).substr(2, 9).toUpperCase();
      let validatedTotal = 0;
      const cleanItems = cart.map((item) => {
        const { image, ...rest } = item;
        const itemTotal = calculateItemTotal(item, promotions, matrizProducts, currentTenant?.id, cart);
        validatedTotal += itemTotal;
        const promoDetails = calculateItemPromotionDetails(item, promotions, matrizProducts, currentTenant?.id, cart);
        return {
          ...rest,
          appliedPromotionId: promoDetails.promotionId,
          promotionDiscount: promoDetails.discount,
        };
      });

      // Rigid checkout validation
      let finalCouponDiscount = couponDiscount;
      if (
        appliedCoupon?.couponScope === "GLOBAL" &&
        appliedCoupon?.minPurchaseValue
      ) {
        const minPurchase = Number(appliedCoupon?.minPurchaseValue || 0);
        if (validatedTotal < minPurchase) {
          finalCouponDiscount = 0;
        }
      }

      // Calculate delivery fee
      let deliveryFee = calculatedDeliveryFee;
      if (currentTenant.deliverySettings?.enabled && customer.address) {
        const minFree = currentTenant.deliverySettings.minOrderForFreeDelivery || 0;
        if (minFree > 0 && validatedTotal >= minFree) {
          deliveryFee = 0;
        }
      }

      const newOrder: Order = {
        id: newId,
        tenantId: currentTenant.id,
        items: cleanItems as CartItem[],
        customer,
        total: Math.max(0, validatedTotal - finalCouponDiscount + deliveryFee),
        date: new Date().toISOString(),
        status: "pending",
        appliedCoupon:
          finalCouponDiscount > 0 ? appliedCoupon?.code : undefined,
        couponDiscount: finalCouponDiscount,
        deliveryMode,
        receiptFile: uploadedPrescriptionUrl || undefined,
      };

      await saveOrderByTenant(currentTenant.id, newOrder);
      setOrders((prev) => [newOrder, ...prev]);

      if (uploadedPrescriptionUrl) {
        fetch(`/api/v1/store/${currentTenant.id}/prescriptions/link`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileUrl: uploadedPrescriptionUrl,
            orderId: newId,
          })
        }).catch(err => console.error("Could not link prescription to order:", err));
      }

      const pharmacyNumber = `55${currentTenant.whatsapp.replace(/\D/g, "")}`;

      let msg = `*🆕 PEDIDO #${newId}*\n`;
      msg += `🏪 *${currentTenant.name}*\n`;
      msg += `📅 ${new Date().toLocaleString("pt-BR")}\n\n`;
      if (uploadedPrescriptionUrl) {
        msg += `⚠️ *ATENÇÃO: CONTÉM RECEITA MÉDICA*\n`;
        msg += `Verifique a receita no painel administrativo.\n\n`;
      }
      msg += `────────────────\n`;
      msg += `*👤 DADOS DO CLIENTE*\n`;
      msg += `*Nome:* ${customer.name}\n`;
      msg += `*Tel:* ${customer.phone}\n\n`;

      if (deliveryMode === 'pickup') {
        msg += `*📍 RETIRADA NA LOJA*\n`;
        msg += `O cliente irá retirar o pedido no balcão.\n`;
        if (currentTenant.fullAddress) {
          msg += `*Endereço de Retirada:* ${currentTenant.fullAddress}\n`;
        }
        msg += `\n────────────────\n`;
      } else if (customer.address) {
        msg += `*📍 ENTREGA*\n`;
        msg += `${customer.address}, ${customer.addressNumber}\n`;
        if (customer.complement) msg += `*Comp:* ${customer.complement}\n`;
        msg += `${customer.neighborhood} - ${customer.city}\n`;
        if (customer.locationUrl)
          msg += `\n🗺️ *Ver no Mapa:*\n${customer.locationUrl}\n`;
        msg += `\n────────────────\n`;
      }

      msg += `*🛒 PRODUTOS*\n\n`;

      cart.forEach((item) => {
        const itemTotal = calculateItemTotal(item, promotions, matrizProducts, currentTenant?.id, cart).toFixed(2);
        msg += `*${item.quantity}x ${item.name}*\n`;
        if (item.internalCode) msg += `   🏷️ Ref: ${item.internalCode}\n`;
        msg += `   💲 R$ ${itemTotal}\n\n`;
      });

      msg += `────────────────\n`;
      if (appliedCoupon) {
        msg += `*🏷️ CUPOM APLICADO: ${appliedCoupon.code}*\n`;
      }
      if (currentTenant.deliverySettings?.enabled && customer.address) {
        let feeDisplay = "Grátis";
        if (deliveryFee === -1) {
          feeDisplay = "A combinar";
        } else if (deliveryFee > 0) {
          feeDisplay = `R$ ${deliveryFee.toFixed(2)}`;
        }
        msg += `*🚚 Taxa de Entrega:* ${feeDisplay}\n`;
      }
      msg += `*💰 TOTAL: R$ ${newOrder.total.toFixed(2)}*\n`;
      msg += `💳 *Pagamento:* ${customer.paymentMethod}\n`;
      if (customer.changeFor) msg += `💵 *Troco para:* ${customer.changeFor}\n`;

      window.open(
        `https://wa.me/${pharmacyNumber}?text=${encodeURIComponent(msg)}`,
        "_blank",
      );
      setCart([]);
      setView(ViewMode.CATALOG);
      window.history.pushState({ view: ViewMode.CATALOG, adminTab }, "");
    } catch (error: any) {
      console.error("Erro ao finalizar pedido:", error);
      alert(`Erro ao finalizar pedido.`);
    }
  };

  const handleUpdateOrderStatus = async (
    orderId: string,
    newStatus: OrderStatus,
  ) => {
    if (!currentTenant) return;
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const oldStatus = order.status;
    if (oldStatus === newStatus) return;

    try {
      const updatedOrder = { ...order, status: newStatus };

      if (newStatus === "cancelled" && oldStatus !== "cancelled") {
        const stockChanges: Product[] = [];
        const nextProducts = [...products];

        for (const item of order.items) {
          const pIndex = nextProducts.findIndex((p) => p.id === item.id);
          if (pIndex !== -1) {
            const updatedProd = {
              ...nextProducts[pIndex],
              stock: Number(nextProducts[pIndex].stock) + item.quantity,
            };
            nextProducts[pIndex] = updatedProd;
            stockChanges.push(updatedProd);
          }
        }

        if (stockChanges.length > 0) {
          setProducts(nextProducts);
          // Atualiza o estoque de imediato (substitui local + supabase)
          await saveProductsByTenant(currentTenant.id, stockChanges);
        }

        // Atualiza o pedido depois que o estoque foi atualizado com sucesso
        await saveOrdersByTenant(currentTenant.id, [updatedOrder]);
      } else {
        await saveOrdersByTenant(currentTenant.id, [updatedOrder]);
      }

      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? updatedOrder : o)),
      );

      // --- AUTOMAÇÃO WHATSAPP API MOVIDA PARA AdminOrderManager ---
    } catch (error: any) {
      console.error(error);
      alert("Erro ao remover/atualizar status do pedido: " + error.message);
    }
  };

  const handleUpdateOrder = async (
    orderId: string,
    updatedData: Partial<Order>,
  ) => {
    if (!currentTenant) return;
    const oldOrder = orders.find((o) => o.id === orderId);
    if (!oldOrder) return;
    const updatedOrder = { ...oldOrder, ...updatedData };

    try {
      await saveOrdersByTenant(currentTenant.id, [updatedOrder]);
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? updatedOrder : o)),
      );

      // Se o status estiver sendo atualizado manualmente via handleUpdateOrder
      // A notificação de whatsapp agora é feita direto no AdminOrderManager.
    } catch (error: any) {
      alert("Erro ao atualizar pedido.");
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    if (!currentTenant) return;
    try {
      await deleteOrder(orderId);
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
    } catch (error: any) {
      alert(`Erro ao excluir.`);
    }
  };

  const handleCleanupOldOrders = async () => {
    if (!currentTenant) return;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const toDelete = orders.filter((o) => new Date(o.date) < thirtyDaysAgo);
    if (toDelete.length === 0) return alert("Sem pedidos antigos.");
    if (!confirm(`Excluir ${toDelete.length} pedidos?`)) return;
    try {
      for (const order of toDelete) await deleteOrder(order.id);
      setOrders((prev) =>
        prev.filter((o) => new Date(o.date) >= thirtyDaysAgo),
      );
    } catch (e: any) {
      alert("Erro na limpeza.");
    }
  };

  if (isLoading) {
    if (view === ViewMode.CATALOG) {
      // Render a skeleton matching the Storefront layout
      return (
        <div className="min-h-screen bg-[#fcfdfe]">
          {/* Navbar Skeleton */}
          <div className="sticky top-0 z-40 bg-white/80 backdrop-blur-3xl border-b border-gray-100/50 shadow-sm">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
              <div className="w-32 h-8 bg-gray-100 rounded-xl animate-pulse"></div>
              <div className="w-20 h-10 bg-gray-100 rounded-2xl animate-pulse"></div>
            </div>
          </div>
          {/* Hero Skeleton */}
          <div className="pt-10 pb-8 px-4 max-w-7xl mx-auto">
            <div className="w-1/2 h-8 bg-gray-100 rounded-lg animate-pulse mb-4"></div>
            <div className="w-1/4 h-5 bg-gray-50 rounded-md animate-pulse"></div>
            {/* Search Bar Skeleton */}
            <div className="mt-8 w-full h-14 bg-gray-100 rounded-3xl animate-pulse max-w-3xl"></div>
          </div>
          {/* Category/Products Skeleton */}
          <div className="max-w-7xl mx-auto px-4 py-8">
            <div className="flex gap-4 overflow-x-hidden mb-10">
              <div className="w-24 h-10 bg-gray-100 rounded-full animate-pulse"></div>
              <div className="w-24 h-10 bg-gray-100 rounded-full animate-pulse"></div>
              <div className="w-24 h-10 bg-gray-100 rounded-full animate-pulse"></div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
                <div
                  key={i}
                  className="bg-white border border-gray-100 rounded-3xl p-4 h-64 flex flex-col animate-pulse"
                >
                  <div className="w-full h-32 bg-gray-50 rounded-2xl mb-4"></div>
                  <div className="w-3/4 h-4 bg-gray-100 rounded mb-2"></div>
                  <div className="w-1/2 h-4 bg-gray-100 rounded mt-auto"></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 size={48} className="animate-spin text-brand" />
      </div>
    );
  }

  const isCurrentTenantBlocked =
    currentTenant &&
    (currentTenant.isBlocked === true ||
      (currentTenant as any).isblocked === true);
  const isLicenseExpiredActive =
    currentTenant &&
    currentTenant.licenseExpiration &&
    new Date(currentTenant.licenseExpiration).getTime() <
      new Date().setHours(0, 0, 0, 0);

  if (
    (isCurrentTenantBlocked || isLicenseExpiredActive) &&
    session.type !== "SUPER_ADMIN"
  ) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-md w-full bg-white p-12 rounded-[3.5rem] shadow-2xl text-center space-y-8 animate-in zoom-in-95">
          <div className="w-24 h-24 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto animate-pulse">
            <ShieldAlert size={48} />
          </div>
          <div className="space-y-3">
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">
              {isLicenseExpiredActive ? "Licença Expirada" : "Loja Suspensa"}
            </h1>
            <p className="text-gray-500 font-medium leading-relaxed">
              {isLicenseExpiredActive
                ? "O período de uso deste sistema terminou. Renove sua assinatura para continue operando."
                : "Esta drogaria está temporariamente indisponível no catálogo FarmaFlow."}
            </p>
          </div>
          <button
            onClick={() => handleViewChange(ViewMode.LOGIN)}
            className="w-full py-5 bg-gray-900 text-white rounded-[2rem] font-black text-lg active:scale-95 transition-all shadow-xl shadow-gray-200"
          >
            Voltar ao Início
          </button>
        </div>
      </div>
    );
  }

  const isFullAccess =
    session.role === "admin" ||
    session.role === "owner" ||
    session.role === "gerente" ||
    session.type === "SUPER_ADMIN" ||
    !session.role;
  const isDeliverer = session.role === "entregador";

  return (
    <div className="min-h-screen bg-[#fcfdfe]">
      <Toaster position="top-right" richColors />
      {view !== ViewMode.LOGIN && view !== ViewMode.CATALOG && (
        <Navbar
          currentView={view}
          onViewChange={handleViewChange}
          cartCount={cart.reduce((a, c) => a + c.quantity, 0)}
          config={
            currentTenant ||
            ({
              name: "FarmaFlow",
              whatsapp: "",
              primaryColor: "#059669",
              id: "",
            } as PharmacyConfig)
          }
          session={session}
          onToggleSidebar={
            view === ViewMode.ADMIN_PHARMACY || view === ViewMode.ADMIN_SUPER
              ? () => setIsSidebarOpen(true)
              : undefined
          }
          networkTenants={networkTenants}
          onSelectTenant={handleSelectTenant}
          isMatrixUser={isMatrixAdmin}
        />
      )}

      {isSidebarOpen && (
        <div className="fixed inset-0 z-[100] md:hidden">
          <div
            className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
            onClick={() => setIsSidebarOpen(false)}
          ></div>
          <aside className="absolute top-0 left-0 w-80 h-[100dvh] bg-white shadow-2xl flex flex-col p-6 animate-in slide-in-from-left">
            <div className="flex items-center justify-between mb-4">
              <span className="font-black text-gray-900">Gestão FarmaFlow</span>
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="p-2 bg-gray-50 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            {view === ViewMode.ADMIN_PHARMACY && isMatrixAdmin && networkTenants.length > 1 && (
              <div className="mb-4 pb-4 border-b border-gray-100">
                <label className="text-[10px] font-black uppercase tracking-wider text-gray-400 block mb-1.5 px-1">
                  Unidade Selecionada
                </label>
                <TenantSelector
                  tenants={networkTenants}
                  currentTenant={currentTenant}
                  onSelectTenant={(t) => {
                    handleSelectTenant(t);
                    setIsSidebarOpen(false);
                  }}
                  isMatrixUser={isMatrixAdmin}
                  userRole={session?.role}
                  networkName={networkTenants.find(t => t.isNetworkMaster)?.name || "Rede de Farmácias"}
                  className="w-full"
                />
              </div>
            )}

            <nav className="flex-1 overflow-y-auto pr-1 space-y-1 pb-6">
              {view === ViewMode.ADMIN_PHARMACY ? (
                <>
                  {isFullAccess && (
                    <button
                      onClick={() => {
                        setAdminTab("dashboard");
                        setIsSidebarOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-[15px] mb-2 ${adminTab === "dashboard" ? "bg-brand text-brand-contrast" : "text-gray-500 hover:bg-gray-50"}`}
                    >
                      <ShoppingCart size={20} />
                      Dashboard
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setAdminTab("orders");
                      setIsSidebarOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-[15px] mb-2 ${adminTab === "orders" ? "bg-brand text-brand-contrast" : "text-gray-500 hover:bg-gray-50"}`}
                  >
                    <ShoppingCart size={20} />
                    Pedidos
                  </button>
                  <button
                    onClick={() => {
                      setAdminTab("prescriptions");
                      setIsSidebarOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-[15px] mb-2 ${adminTab === "prescriptions" ? "bg-brand text-brand-contrast" : "text-gray-500 hover:bg-gray-50"}`}
                  >
                    <FileText size={20} />
                    Validação de Receitas
                  </button>
                  {!isDeliverer && (
                    <button
                      onClick={() => {
                        setAdminTab("products");
                        setIsSidebarOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-[15px] mb-2 ${adminTab === "products" ? "bg-brand text-brand-contrast" : "text-gray-500 hover:bg-gray-50"}`}
                    >
                      <Package size={20} />
                      Produtos
                    </button>
                  )}
                  {isFullAccess && (
                    <>
                      <button
                        onClick={() => {
                          setAdminTab("promotions");
                          setIsSidebarOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-[15px] mb-2 ${adminTab === "promotions" ? "bg-brand text-brand-contrast" : "text-gray-500 hover:bg-gray-50"}`}
                      >
                        <Tag size={20} />
                        Promoções
                      </button>
                      <button
                        onClick={() => {
                          setAdminTab("coupons");
                          setIsSidebarOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-[15px] mb-2 ${adminTab === "coupons" ? "bg-brand text-brand-contrast" : "text-gray-500 hover:bg-gray-50"}`}
                      >
                        <Tag size={20} />
                        Cupons
                      </button>
                      <button
                        onClick={() => {
                          setAdminTab("price-tags");
                          setIsSidebarOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-[15px] mb-2 ${adminTab === "price-tags" ? "bg-brand text-brand-contrast" : "text-gray-500 hover:bg-gray-50"}`}
                      >
                        <Printer size={20} />
                        Etiquetas & Cartazes
                      </button>
                      <button
                        onClick={() => {
                          setAdminTab("history");
                          setIsSidebarOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-[15px] mb-2 ${adminTab === "history" ? "bg-brand text-brand-contrast" : "text-gray-500 hover:bg-gray-50"}`}
                      >
                        <History size={20} />
                        Histórico 24h
                      </button>
                      <button
                        onClick={() => {
                          setAdminTab("team");
                          setIsSidebarOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-[15px] mb-2 ${adminTab === "team" ? "bg-brand text-brand-contrast" : "text-gray-500 hover:bg-gray-50"}`}
                      >
                        <Users size={20} />
                        Equipe
                      </button>
                                            <button
                        onClick={() => {
                          setAdminTab("inboxes");
                          setIsSidebarOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-[15px] mb-2 ${adminTab === "inboxes" ? "bg-brand text-brand-contrast" : "text-gray-500 hover:bg-gray-50"}`}
                      >
                        <Inbox size={20} />
                        Departamentos
                        {!currentTenant?.isChatEnabled && <Lock size={14} className="ml-auto opacity-50" />}
                      </button>
                      <button
                        onClick={() => {
                          setAdminTab("analytics");
                          setIsSidebarOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-[15px] mb-2 ${adminTab === "analytics" ? "bg-brand text-brand-contrast" : "text-gray-500 hover:bg-gray-50"}`}
                      >
                        <TrendingUp size={20} />
                        Monitoramento
                      </button>
                      <button
                        onClick={() => {
                          setAdminTab("settings");
                          setIsSidebarOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-[15px] mb-2 ${adminTab === "settings" ? "bg-brand text-brand-contrast" : "text-gray-500 hover:bg-gray-50"}`}
                      >
                        <Settings size={20} />
                        Configurações
                      </button>
                    </>
                  )}
                  {!isDeliverer && (
                    <>
                      <button
                        onClick={() => {
                          setAdminTab("desktop");
                          setIsSidebarOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-[15px] mb-2 ${adminTab === "desktop" ? "bg-brand text-brand-contrast" : "text-gray-500 hover:bg-gray-50"}`}
                        style={
                          adminTab === "desktop"
                            ? { backgroundColor: currentTenant.primaryColor }
                            : {}
                        }
                      >
                        <Laptop size={20} />
                        Aplicativo PC
                      </button>
                                            <button
                        onClick={() => {
                          setAdminTab("chat");
                          setIsSidebarOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-[15px] mb-2 ${adminTab === "chat" ? "bg-brand text-brand-contrast" : "text-gray-500 hover:bg-gray-50"}`}
                      >
                        <MessageSquare size={20} />
                        Central de Chat
                        {!currentTenant?.isChatEnabled && <Lock size={14} className="ml-auto opacity-50" />}
                      </button>
                      <button
                        onClick={() => {
                          setAdminTab("manual");
                          setIsSidebarOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-[15px] mb-2 ${adminTab === "manual" ? "bg-brand text-brand-contrast" : "text-gray-500 hover:bg-gray-50"}`}
                      >
                        <BookOpen size={20} />
                        Manual
                      </button>
                    </>
                  )}
                  <div className="my-4 border-t border-gray-100"></div>
                  <button
                    onClick={() => {
                      handleViewChange(ViewMode.CATALOG);
                      setIsSidebarOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-[15px] text-gray-500 hover:bg-gray-50"
                  >
                    <Store size={20} /> Ver Loja Online
                  </button>
                  {session.type === "SUPER_ADMIN" && (
                    <button
                      onClick={() => {
                        handleViewChange(ViewMode.ADMIN_SUPER);
                        setIsSidebarOpen(false);
                      }}
                      className="w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-[15px] text-gray-500 hover:bg-gray-50 mt-2"
                    >
                      <ArrowLeft size={20} /> Voltar ao Portal
                    </button>
                  )}
                </>
              ) : (
                <div className="text-center font-black text-gray-400 uppercase text-[10px] tracking-widest">
                  Master Admin
                </div>
              )}
            </nav>
            <button
              onClick={() => handleViewChange(ViewMode.LOGIN)}
              className="w-full flex items-center gap-3 px-6 py-4 rounded-2xl text-red-500 font-bold text-[15px] hover:bg-red-50 mt-auto"
            >
              <Ban size={18} /> Sair
            </button>
          </aside>
        </div>
      )}

      <main
        className={`w-full ${view === ViewMode.CATALOG ? "max-w-full px-0 py-0" : view === ViewMode.ADMIN_PHARMACY ? "max-w-[1920px] px-4 sm:px-6 lg:px-8 py-10" : "max-w-7xl px-4 sm:px-6 lg:px-8 py-10"} mx-auto ${view === ViewMode.ADMIN_PHARMACY ? "flex flex-col md:flex-row gap-4 md:gap-8 overflow-x-hidden relative transition-all duration-300 ease-in-out" : ""}`}
      >
        <Suspense fallback={<LoadingFallback />}>
          {view === ViewMode.LOGIN && <Login onLogin={handleLogin} />}
          {view === ViewMode.ADMIN_SUPER && (
            <SuperAdminManager
              session={session}
              onAccessTenant={handleAccessTenant}
              onDeleteTenant={handleDeleteTenant}
            />
          )}
          {view === ViewMode.CATALOG && currentTenant && (
            <Storefront
              tenant={currentTenant}
              products={products}
              promotions={promotions}
              coupons={coupons}
              cartCount={cart.reduce((a, c) => a + c.quantity, 0)}
              cartItems={cart}
              onAddToCart={addToCart}
              onProductClick={handleProductClick}
              onOpenCart={() => handleViewChange(ViewMode.CART)}
              onBack={
                session.type !== "GUEST"
                  ? () =>
                      handleViewChange(
                        session.type === "SUPER_ADMIN"
                          ? ViewMode.ADMIN_SUPER
                          : ViewMode.ADMIN_PHARMACY,
                      )
                  : undefined
              }
              onSearch={handleSearch}
            />
          )}
          {view === ViewMode.ADMIN_PHARMACY && currentTenant && (
            <>
              {/* DESKTOP SIDEBAR WITH COLLAPSIBLE TOGGLE & TOOLTIPS */}
              <aside 
                className={`hidden md:flex flex-col bg-white rounded-[1.5rem] border border-gray-100 p-3 h-fit sticky top-8 transition-all duration-300 ease-in-out shrink-0 select-none shadow-xs ${
                  isSidebarCollapsed ? "w-20" : "w-72 lg:w-80"
                }`}
              >
                {/* Header with Brand / Unit and Collapse Toggle Button */}
                <div className={`flex items-center pb-3 mb-2 border-b border-gray-100 ${isSidebarCollapsed ? "justify-center" : "justify-between px-2"}`}>
                  {!isSidebarCollapsed ? (
                    <div className="flex items-center gap-2 overflow-hidden">
                      <div 
                        className="w-7 h-7 rounded-xl flex items-center justify-center text-white font-black text-xs shrink-0 shadow-xs"
                        style={{ backgroundColor: currentTenant.primaryColor || "#059669" }}
                      >
                        {currentTenant.name ? currentTenant.name.charAt(0).toUpperCase() : "F"}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-xs font-black text-gray-900 truncate leading-tight">
                          {currentTenant.name || "Painel FarmaFlow"}
                        </h4>
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block truncate">
                          Gestão & Chat
                        </span>
                      </div>
                    </div>
                  ) : null}

                  <button
                    onClick={() => {
                      setIsSidebarCollapsed(prev => {
                        const next = !prev;
                        localStorage.setItem("ff_sidebar_collapsed", String(next));
                        return next;
                      });
                    }}
                    title={isSidebarCollapsed ? "Expandir Menu Lateral" : "Recolher Menu Lateral"}
                    className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 active:scale-95 transition-all flex items-center justify-center shrink-0"
                    aria-label={isSidebarCollapsed ? "Expandir Menu" : "Recolher Menu"}
                  >
                    {isSidebarCollapsed ? (
                      <PanelLeftOpen size={18} className="text-gray-600 animate-in fade-in" />
                    ) : (
                      <PanelLeftClose size={18} className="text-gray-400 hover:text-gray-700" />
                    )}
                  </button>
                </div>

                {/* Tenant Selector (quando expandido) */}
                {isMatrixAdmin && networkTenants.length > 1 && !isSidebarCollapsed && (
                  <div className="mb-3 pb-3 border-b border-gray-100 animate-in fade-in duration-200">
                    <label className="text-[10px] font-black uppercase tracking-wider text-gray-400 block mb-1.5 px-2">
                      Unidade Ativa
                    </label>
                    <TenantSelector
                      tenants={networkTenants}
                      currentTenant={currentTenant}
                      onSelectTenant={handleSelectTenant}
                      isMatrixUser={isMatrixAdmin}
                      userRole={session?.role}
                      networkName={networkTenants.find(t => t.isNetworkMaster)?.name || "Rede de Farmácias"}
                      className="w-full"
                    />
                  </div>
                )}

                {/* Seletor Compacto quando o menu lateral estiver recolhido */}
                {isMatrixAdmin && networkTenants.length > 1 && isSidebarCollapsed && (
                  <div className="mb-3 pb-3 border-b border-gray-100 flex justify-center">
                    <button
                      onClick={() => {
                        setIsSidebarCollapsed(false);
                        localStorage.setItem("ff_sidebar_collapsed", "false");
                      }}
                      title={`Unidade Atual: ${currentTenant.name || "Drogaria"} (${networkTenants.length} unidades na rede - Clique para alternar)`}
                      className="w-10 h-10 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 flex items-center justify-center transition-all cursor-pointer relative group shadow-2xs active:scale-95"
                    >
                      <Store size={18} />
                      <span className="absolute -top-1 -right-1 w-4 h-4 bg-purple-600 text-white text-[9px] font-black rounded-full flex items-center justify-center shadow-xs">
                        {networkTenants.length}
                      </span>
                    </button>
                  </div>
                )}

                {/* NAVIGATION ITEMS */}
                <div className="space-y-1.5">
                  {isFullAccess && (
                    <button
                      onClick={() => setAdminTab("dashboard")}
                      title={isSidebarCollapsed ? "Dashboard" : undefined}
                      className={`group relative w-full flex items-center rounded-2xl font-bold text-[14px] transition-all ${
                        isSidebarCollapsed 
                          ? "justify-center p-3.5" 
                          : "gap-3 px-4 py-3.5"
                      } ${adminTab === "dashboard" ? "bg-brand text-brand-contrast shadow-sm" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`}
                      style={
                        adminTab === "dashboard"
                          ? { backgroundColor: currentTenant.primaryColor }
                          : {}
                      }
                    >
                      <ShoppingCart size={19} className="shrink-0" />
                      {!isSidebarCollapsed && <span className="truncate">Dashboard</span>}
                      {isSidebarCollapsed && (
                        <div className="fixed left-24 z-50 pointer-events-none hidden group-hover:flex items-center px-3 py-1.5 bg-gray-900 text-white text-xs font-bold rounded-xl shadow-lg whitespace-nowrap animate-in fade-in zoom-in-95 duration-150">
                          Dashboard
                        </div>
                      )}
                    </button>
                  )}

                  <button
                    onClick={() => setAdminTab("orders")}
                    title={isSidebarCollapsed ? "Pedidos" : undefined}
                    className={`group relative w-full flex items-center rounded-2xl font-bold text-[14px] transition-all ${
                      isSidebarCollapsed 
                        ? "justify-center p-3.5" 
                        : "gap-3 px-4 py-3.5"
                    } ${adminTab === "orders" ? "bg-brand text-brand-contrast shadow-sm" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`}
                    style={
                      adminTab === "orders"
                        ? { backgroundColor: currentTenant.primaryColor }
                        : {}
                    }
                  >
                    <ShoppingCart size={19} className="shrink-0" />
                    {!isSidebarCollapsed && <span className="truncate">Pedidos</span>}
                    {isSidebarCollapsed && (
                      <div className="fixed left-24 z-50 pointer-events-none hidden group-hover:flex items-center px-3 py-1.5 bg-gray-900 text-white text-xs font-bold rounded-xl shadow-lg whitespace-nowrap animate-in fade-in zoom-in-95 duration-150">
                        Pedidos
                      </div>
                    )}
                  </button>

                  <button
                    onClick={() => setAdminTab("prescriptions")}
                    title={isSidebarCollapsed ? "Validação de Receitas" : undefined}
                    className={`group relative w-full flex items-center rounded-2xl font-bold text-[14px] transition-all ${
                      isSidebarCollapsed 
                        ? "justify-center p-3.5" 
                        : "gap-3 px-4 py-3.5"
                    } ${adminTab === "prescriptions" ? "bg-brand text-brand-contrast shadow-sm" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`}
                    style={
                      adminTab === "prescriptions"
                        ? { backgroundColor: currentTenant.primaryColor }
                        : {}
                    }
                  >
                    <FileText size={19} className="shrink-0" />
                    {!isSidebarCollapsed && <span className="truncate">Validação de Receitas</span>}
                    {isSidebarCollapsed && (
                      <div className="fixed left-24 z-50 pointer-events-none hidden group-hover:flex items-center px-3 py-1.5 bg-gray-900 text-white text-xs font-bold rounded-xl shadow-lg whitespace-nowrap animate-in fade-in zoom-in-95 duration-150">
                        Validação de Receitas
                      </div>
                    )}
                  </button>

                  {!isDeliverer && (
                    <button
                      onClick={() => setAdminTab("products")}
                      title={isSidebarCollapsed ? "Produtos" : undefined}
                      className={`group relative w-full flex items-center rounded-2xl font-bold text-[14px] transition-all ${
                        isSidebarCollapsed 
                          ? "justify-center p-3.5" 
                          : "gap-3 px-4 py-3.5"
                      } ${adminTab === "products" ? "bg-brand text-brand-contrast shadow-sm" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`}
                      style={
                        adminTab === "products"
                          ? { backgroundColor: currentTenant.primaryColor }
                          : {}
                      }
                    >
                      <Package size={19} className="shrink-0" />
                      {!isSidebarCollapsed && <span className="truncate">Produtos</span>}
                      {isSidebarCollapsed && (
                        <div className="fixed left-24 z-50 pointer-events-none hidden group-hover:flex items-center px-3 py-1.5 bg-gray-900 text-white text-xs font-bold rounded-xl shadow-lg whitespace-nowrap animate-in fade-in zoom-in-95 duration-150">
                          Produtos
                        </div>
                      )}
                    </button>
                  )}

                  {isFullAccess && (
                    <>
                      <button
                        onClick={() => setAdminTab("promotions")}
                        title={isSidebarCollapsed ? "Promoções" : undefined}
                        className={`group relative w-full flex items-center rounded-2xl font-bold text-[14px] transition-all ${
                          isSidebarCollapsed 
                            ? "justify-center p-3.5" 
                            : "gap-3 px-4 py-3.5"
                        } ${adminTab === "promotions" ? "bg-brand text-brand-contrast shadow-sm" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`}
                        style={
                          adminTab === "promotions"
                            ? { backgroundColor: currentTenant.primaryColor }
                            : {}
                        }
                      >
                        <Tag size={19} className="shrink-0" />
                        {!isSidebarCollapsed && <span className="truncate">Promoções</span>}
                        {isSidebarCollapsed && (
                          <div className="fixed left-24 z-50 pointer-events-none hidden group-hover:flex items-center px-3 py-1.5 bg-gray-900 text-white text-xs font-bold rounded-xl shadow-lg whitespace-nowrap animate-in fade-in zoom-in-95 duration-150">
                            Promoções
                          </div>
                        )}
                      </button>

                      <button
                        onClick={() => setAdminTab("coupons")}
                        title={isSidebarCollapsed ? "Cupons" : undefined}
                        className={`group relative w-full flex items-center rounded-2xl font-bold text-[14px] transition-all ${
                          isSidebarCollapsed 
                            ? "justify-center p-3.5" 
                            : "gap-3 px-4 py-3.5"
                        } ${adminTab === "coupons" ? "bg-brand text-brand-contrast shadow-sm" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`}
                        style={
                          adminTab === "coupons"
                            ? { backgroundColor: currentTenant.primaryColor }
                            : {}
                        }
                      >
                        <Tag size={19} className="shrink-0" />
                        {!isSidebarCollapsed && <span className="truncate">Cupons</span>}
                        {isSidebarCollapsed && (
                          <div className="fixed left-24 z-50 pointer-events-none hidden group-hover:flex items-center px-3 py-1.5 bg-gray-900 text-white text-xs font-bold rounded-xl shadow-lg whitespace-nowrap animate-in fade-in zoom-in-95 duration-150">
                            Cupons
                          </div>
                        )}
                      </button>

                      <button
                        onClick={() => setAdminTab("price-tags")}
                        title={isSidebarCollapsed ? "Etiquetas & Cartazes" : undefined}
                        className={`group relative w-full flex items-center rounded-2xl font-bold text-[14px] transition-all ${
                          isSidebarCollapsed 
                            ? "justify-center p-3.5" 
                            : "gap-3 px-4 py-3.5"
                        } ${adminTab === "price-tags" ? "bg-brand text-brand-contrast shadow-sm" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`}
                        style={
                          adminTab === "price-tags"
                            ? { backgroundColor: currentTenant.primaryColor }
                            : {}
                        }
                      >
                        <Printer size={19} className="shrink-0" />
                        {!isSidebarCollapsed && <span className="truncate">Etiquetas & Cartazes</span>}
                        {isSidebarCollapsed && (
                          <div className="fixed left-24 z-50 pointer-events-none hidden group-hover:flex items-center px-3 py-1.5 bg-gray-900 text-white text-xs font-bold rounded-xl shadow-lg whitespace-nowrap animate-in fade-in zoom-in-95 duration-150">
                            Etiquetas & Cartazes
                          </div>
                        )}
                      </button>

                      <button
                        onClick={() => setAdminTab("history")}
                        title={isSidebarCollapsed ? "Histórico 24h" : undefined}
                        className={`group relative w-full flex items-center rounded-2xl font-bold text-[14px] transition-all ${
                          isSidebarCollapsed 
                            ? "justify-center p-3.5" 
                            : "gap-3 px-4 py-3.5"
                        } ${adminTab === "history" ? "bg-brand text-brand-contrast shadow-sm" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`}
                        style={
                          adminTab === "history"
                            ? { backgroundColor: currentTenant.primaryColor }
                            : {}
                        }
                      >
                        <History size={19} className="shrink-0" />
                        {!isSidebarCollapsed && <span className="truncate">Histórico 24h</span>}
                        {isSidebarCollapsed && (
                          <div className="fixed left-24 z-50 pointer-events-none hidden group-hover:flex items-center px-3 py-1.5 bg-gray-900 text-white text-xs font-bold rounded-xl shadow-lg whitespace-nowrap animate-in fade-in zoom-in-95 duration-150">
                            Histórico 24h
                          </div>
                        )}
                      </button>

                      <button
                        onClick={() => setAdminTab("team")}
                        title={isSidebarCollapsed ? "Equipe" : undefined}
                        className={`group relative w-full flex items-center rounded-2xl font-bold text-[14px] transition-all ${
                          isSidebarCollapsed 
                            ? "justify-center p-3.5" 
                            : "gap-3 px-4 py-3.5"
                        } ${adminTab === "team" ? "bg-brand text-brand-contrast shadow-sm" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`}
                        style={
                          adminTab === "team"
                            ? { backgroundColor: currentTenant.primaryColor }
                            : {}
                        }
                      >
                        <Users size={19} className="shrink-0" />
                        {!isSidebarCollapsed && <span className="truncate">Equipe</span>}
                        {isSidebarCollapsed && (
                          <div className="fixed left-24 z-50 pointer-events-none hidden group-hover:flex items-center px-3 py-1.5 bg-gray-900 text-white text-xs font-bold rounded-xl shadow-lg whitespace-nowrap animate-in fade-in zoom-in-95 duration-150">
                            Equipe
                          </div>
                        )}
                      </button>

                      <button
                        onClick={() => setAdminTab("inboxes")}
                        title={isSidebarCollapsed ? "Departamentos" : undefined}
                        className={`group relative w-full flex items-center rounded-2xl font-bold text-[14px] transition-all ${
                          isSidebarCollapsed 
                            ? "justify-center p-3.5" 
                            : "gap-3 px-4 py-3.5"
                        } ${adminTab === "inboxes" ? "bg-brand text-brand-contrast shadow-sm" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`}
                        style={adminTab === "inboxes" ? { backgroundColor: currentTenant.primaryColor } : {}}
                      >
                        <Inbox size={19} className="shrink-0" />
                        {!isSidebarCollapsed && (
                          <>
                            <span className="truncate">Departamentos</span>
                            {!currentTenant?.isChatEnabled && <Lock size={14} className="ml-auto opacity-50 shrink-0" />}
                          </>
                        )}
                        {isSidebarCollapsed && (
                          <div className="fixed left-24 z-50 pointer-events-none hidden group-hover:flex items-center px-3 py-1.5 bg-gray-900 text-white text-xs font-bold rounded-xl shadow-lg whitespace-nowrap animate-in fade-in zoom-in-95 duration-150">
                            Departamentos {!currentTenant?.isChatEnabled && "(Bloqueado)"}
                          </div>
                        )}
                      </button>

                      <button
                        onClick={() => setAdminTab("analytics")}
                        title={isSidebarCollapsed ? "Monitoramento" : undefined}
                        className={`group relative w-full flex items-center rounded-2xl font-bold text-[14px] transition-all ${
                          isSidebarCollapsed 
                            ? "justify-center p-3.5" 
                            : "gap-3 px-4 py-3.5"
                        } ${adminTab === "analytics" ? "bg-brand text-brand-contrast shadow-sm" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`}
                        style={
                          adminTab === "analytics"
                            ? { backgroundColor: currentTenant.primaryColor }
                            : {}
                        }
                      >
                        <TrendingUp size={19} className="shrink-0" />
                        {!isSidebarCollapsed && <span className="truncate">Monitoramento</span>}
                        {isSidebarCollapsed && (
                          <div className="fixed left-24 z-50 pointer-events-none hidden group-hover:flex items-center px-3 py-1.5 bg-gray-900 text-white text-xs font-bold rounded-xl shadow-lg whitespace-nowrap animate-in fade-in zoom-in-95 duration-150">
                            Monitoramento
                          </div>
                        )}
                      </button>

                      <button
                        onClick={() => setAdminTab("settings")}
                        title={isSidebarCollapsed ? "Configurações" : undefined}
                        className={`group relative w-full flex items-center rounded-2xl font-bold text-[14px] transition-all ${
                          isSidebarCollapsed 
                            ? "justify-center p-3.5" 
                            : "gap-3 px-4 py-3.5"
                        } ${adminTab === "settings" ? "bg-brand text-brand-contrast shadow-sm" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`}
                        style={
                          adminTab === "settings"
                            ? { backgroundColor: currentTenant.primaryColor }
                            : {}
                        }
                      >
                        <Settings size={19} className="shrink-0" />
                        {!isSidebarCollapsed && <span className="truncate">Configurações</span>}
                        {isSidebarCollapsed && (
                          <div className="fixed left-24 z-50 pointer-events-none hidden group-hover:flex items-center px-3 py-1.5 bg-gray-900 text-white text-xs font-bold rounded-xl shadow-lg whitespace-nowrap animate-in fade-in zoom-in-95 duration-150">
                            Configurações
                          </div>
                        )}
                      </button>
                    </>
                  )}

                  {!isDeliverer && (
                    <>
                      <button
                        onClick={() => setAdminTab("desktop")}
                        title={isSidebarCollapsed ? "Aplicativo PC" : undefined}
                        className={`group relative w-full flex items-center rounded-2xl font-bold text-[14px] transition-all ${
                          isSidebarCollapsed 
                            ? "justify-center p-3.5" 
                            : "gap-3 px-4 py-3.5"
                        } ${adminTab === "desktop" ? "bg-brand text-brand-contrast shadow-sm" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`}
                        style={
                          adminTab === "desktop"
                            ? { backgroundColor: currentTenant.primaryColor }
                            : {}
                        }
                      >
                        <Laptop size={19} className="shrink-0" />
                        {!isSidebarCollapsed && <span className="truncate">Aplicativo PC</span>}
                        {isSidebarCollapsed && (
                          <div className="fixed left-24 z-50 pointer-events-none hidden group-hover:flex items-center px-3 py-1.5 bg-gray-900 text-white text-xs font-bold rounded-xl shadow-lg whitespace-nowrap animate-in fade-in zoom-in-95 duration-150">
                            Aplicativo PC
                          </div>
                        )}
                      </button>

                      <button
                        onClick={() => setAdminTab("chat")}
                        title={isSidebarCollapsed ? "Central de Chat" : undefined}
                        className={`group relative w-full flex items-center rounded-2xl font-bold text-[14px] transition-all ${
                          isSidebarCollapsed 
                            ? "justify-center p-3.5" 
                            : "gap-3 px-4 py-3.5"
                        } ${adminTab === "chat" ? "bg-brand text-brand-contrast shadow-sm" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`}
                        style={
                          adminTab === "chat"
                            ? { backgroundColor: currentTenant.primaryColor }
                            : {}
                        }
                      >
                        <MessageSquare size={19} className="shrink-0" />
                        {!isSidebarCollapsed && (
                          <>
                            <span className="truncate">Central de Chat</span>
                            {!currentTenant?.isChatEnabled && <Lock size={14} className="ml-auto opacity-50 shrink-0" />}
                          </>
                        )}
                        {isSidebarCollapsed && (
                          <div className="fixed left-24 z-50 pointer-events-none hidden group-hover:flex items-center px-3 py-1.5 bg-gray-900 text-white text-xs font-bold rounded-xl shadow-lg whitespace-nowrap animate-in fade-in zoom-in-95 duration-150">
                            Central de Chat {!currentTenant?.isChatEnabled && "(Bloqueado)"}
                          </div>
                        )}
                      </button>

                      <button
                        onClick={() => setAdminTab("manual")}
                        title={isSidebarCollapsed ? "Manual de Uso" : undefined}
                        className={`group relative w-full flex items-center rounded-2xl font-bold text-[14px] transition-all ${
                          isSidebarCollapsed 
                            ? "justify-center p-3.5" 
                            : "gap-3 px-4 py-3.5"
                        } ${adminTab === "manual" ? "bg-brand text-brand-contrast shadow-sm" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`}
                        style={
                          adminTab === "manual"
                            ? { backgroundColor: currentTenant.primaryColor }
                            : {}
                        }
                      >
                        <BookOpen size={19} className="shrink-0" />
                        {!isSidebarCollapsed && <span className="truncate">Manual</span>}
                        {isSidebarCollapsed && (
                          <div className="fixed left-24 z-50 pointer-events-none hidden group-hover:flex items-center px-3 py-1.5 bg-gray-900 text-white text-xs font-bold rounded-xl shadow-lg whitespace-nowrap animate-in fade-in zoom-in-95 duration-150">
                            Manual
                          </div>
                        )}
                      </button>
                    </>
                  )}

                  <div className="my-2 border-t border-gray-100"></div>

                  <button
                    onClick={() => handleViewChange(ViewMode.CATALOG)}
                    title={isSidebarCollapsed ? "Ver Loja Online" : undefined}
                    className={`group relative w-full flex items-center rounded-2xl font-bold text-[14px] text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-all ${
                      isSidebarCollapsed ? "justify-center p-3.5" : "gap-3 px-4 py-3.5"
                    }`}
                  >
                    <Store size={19} className="shrink-0" />
                    {!isSidebarCollapsed && <span className="truncate">Ver Loja</span>}
                    {isSidebarCollapsed && (
                      <div className="fixed left-24 z-50 pointer-events-none hidden group-hover:flex items-center px-3 py-1.5 bg-gray-900 text-white text-xs font-bold rounded-xl shadow-lg whitespace-nowrap animate-in fade-in zoom-in-95 duration-150">
                        Ver Loja Online
                      </div>
                    )}
                  </button>

                  {session.type === "SUPER_ADMIN" && (
                    <button
                      onClick={() => handleViewChange(ViewMode.ADMIN_SUPER)}
                      title={isSidebarCollapsed ? "Voltar ao Portal" : undefined}
                      className={`group relative w-full flex items-center rounded-2xl font-bold text-[13px] text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-all ${
                        isSidebarCollapsed ? "justify-center p-3.5" : "gap-3 px-4 py-3"
                      }`}
                    >
                      <ArrowLeft size={18} className="shrink-0" />
                      {!isSidebarCollapsed && <span className="truncate">Voltar Portal</span>}
                      {isSidebarCollapsed && (
                        <div className="fixed left-24 z-50 pointer-events-none hidden group-hover:flex items-center px-3 py-1.5 bg-gray-900 text-white text-xs font-bold rounded-xl shadow-lg whitespace-nowrap animate-in fade-in zoom-in-95 duration-150">
                          Voltar ao Portal
                        </div>
                      )}
                    </button>
                  )}
                </div>
              </aside>

              {/* MAIN CONTENT AREA (Dynamically expands when sidebar is collapsed) */}
              <div className="flex-1 min-w-0 transition-all duration-300 ease-in-out">
                {/* Floating expand button for convenient quick access if desired */}
                {isSidebarCollapsed && (
                  <div className="hidden md:flex items-center mb-3">
                    <button
                      onClick={() => {
                        setIsSidebarCollapsed(false);
                        localStorage.setItem("ff_sidebar_collapsed", "false");
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-600 hover:text-gray-900 rounded-xl border border-gray-200 text-xs font-bold shadow-2xs transition-all active:scale-95"
                    >
                      <PanelLeftOpen size={14} className="text-emerald-600" />
                      <span>Expandir Menu Lateral</span>
                    </button>
                  </div>
                )}
                {licenseDays >= 0 && licenseDays <= 2 && (
                  <div className="mb-8 p-6 bg-amber-50 border-2 border-amber-200 rounded-[2.5rem] flex items-center justify-between animate-in slide-in-from-top-4">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center">
                        <Calendar size={24} />
                      </div>
                      <div>
                        <h3 className="font-black text-gray-900">
                          Aviso de Licença
                        </h3>
                        <p className="text-sm font-bold text-amber-700">
                          {licenseDays === 2 && "Sua licença expira em 2 dias."}
                          {licenseDays === 1 &&
                            "Falta 1 dia para expirar sua licença."}
                          {licenseDays === 0 && "Hoje expira sua licença!"}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                {adminTab === "dashboard" && (
                  <AdminDashboard
                    orders={uniqueOrders}
                    tenantId={currentTenant.id}
                    tenant={currentTenant}
                    onNavigateToStore={() => handleViewChange(ViewMode.CATALOG)}
                    onNavigateToProducts={() => setAdminTab("products")}
                    onNavigateToOrders={() => setAdminTab("orders")}
                    recentAlerts={recentAlerts}
                    coupons={coupons}
                    promotions={promotions}
                  />
                )}
                {adminTab === "orders" && (
                  <AdminOrderManager
                    orders={uniqueOrders}
                    products={products}
                    onUpdateOrderStatus={handleUpdateOrderStatus}
                    onDeleteOrder={handleDeleteOrder}
                    onCleanupOldOrders={handleCleanupOldOrders}
                    onUpdateOrderCustomer={handleUpdateOrder}
                    tenant={currentTenant}
                    onProductsStateUpdate={handleProductsStateUpdate}
                    promotions={promotions}
                    coupons={coupons}
                    matrizProducts={matrizProducts}
                    isDelivererMode={isDeliverer}
                  />
                )}
                {adminTab === "prescriptions" && (
                  <React.Suspense
                    fallback={
                      <div className="p-8 text-center text-gray-400">
                        Carregando Validador de Receitas...
                      </div>
                    }
                  >
                    <AdminPrescriptions tenantId={currentTenant.id} session={session} />
                  </React.Suspense>
                )}
                {adminTab === "products" && (
                  <AdminProductManager
                    products={products}
                    tenant={currentTenant}
                    isLoading={isSwitchingTenant}
                    onProductsUpdate={handleUpdateProducts}
                    onProductsStateUpdate={handleProductsStateUpdate}
                    onProductDelete={handleProductDelete}
                    onBulkDelete={handleBulkProductDelete}
                    onTenantUpdate={handleUpdateConfig}
                    onNavigateToPriceTags={() => setAdminTab("price-tags")}
                  />
                )}
                {adminTab === "promotions" && (
                  <React.Suspense
                    fallback={
                      <div className="p-8 text-center text-gray-400">
                        Carregando Gestor de Promoções...
                      </div>
                    }
                  >
                    <AdminPromotionManager
                      tenant={currentTenant!}
                      products={products}
                      promotions={promotions}
                      onPromotionsUpdate={setPromotions}
                    />
                  </React.Suspense>
                )}
                {adminTab === "coupons" && (
                  <React.Suspense
                    fallback={
                      <div className="p-8 text-center text-gray-400">
                        Carregando Gestor de Cupons...
                      </div>
                    }
                  >
                    <AdminCouponManager
                      tenant={currentTenant!}
                      products={products}
                      coupons={coupons}
                      onCouponsUpdate={setCoupons}
                    />
                  </React.Suspense>
                )}
                {adminTab === "price-tags" && (
                  <React.Suspense
                    fallback={
                      <div className="p-8 text-center text-gray-400">
                        Carregando Gerador de Etiquetas & Cartazeamento...
                      </div>
                    }
                  >
                    <AdminPriceTags
                      products={products}
                      tenant={currentTenant!}
                      promotions={promotions}
                    />
                  </React.Suspense>
                )}
                {adminTab === "history" && (
                  <AdminImportHistory tenant={currentTenant} />
                )}
                {adminTab === "team" && (
                  <TeamManagement tenantId={currentTenant.id} session={session} />
                )}
                {adminTab === "inboxes" && (
                  currentTenant?.isChatEnabled ? (
                    <React.Suspense fallback={<div className="flex h-full items-center justify-center p-8"><Loader2 className="w-8 h-8 text-emerald-600 animate-spin" /></div>}>
                      <InboxManagement tenantId={currentTenant.id} />
                    </React.Suspense>
                  ) : (
                    <UpsellCard
                      title="Departamentos e Filas de Atendimento"
                      description="Organize o fluxo de mensagens do WhatsApp dividindo o atendimento em setores (ex: Delivery, Farmacêutico, Dúvidas). Atribua conversas automaticamente para as equipes corretas."
                      icon={Inbox}
                      features={[
                        { title: "Filas de Espera", description: "Visualize quantos clientes estão aguardando atendimento em cada setor.", icon: Users, iconColor: "text-blue-400" },
                        { title: "Transferências Inteligentes", description: "Transfira conversas entre departamentos com um clique.", icon: MessageSquareShare, iconColor: "text-emerald-400" }
                      ]}
                    />
                  )
                )}
                {adminTab === "analytics" && (
                  <AdminAnalytics tenant={currentTenant} />
                )}
                {adminTab === "settings" && (
                  <AdminSettings
                    config={currentTenant}
                    onConfigUpdate={handleUpdateConfig}
                    networkTenants={networkTenants}
                    onSelectTenant={handleSelectTenant}
                    session={session}
                    isMatrixUser={isMatrixAdmin}
                  />
                )}
                {adminTab === "desktop" && (
                  <React.Suspense
                    fallback={
                      <div className="p-8 text-center text-gray-400">
                        Carregando Instalador de Aplicativo...
                      </div>
                    }
                  >
                    <AdminDesktopApp tenant={currentTenant!} />
                  </React.Suspense>
                )}
                {adminTab === "chat" && (
                  currentTenant?.isChatEnabled ? (
                    <ChatCentral currentUser={session?.user} userRole={session?.role} tenantId={currentTenant?.id} />
                  ) : (
                    <UpsellCard
                      title="Central de Chat Multi-Atendentes"
                      description="Centralize todo o atendimento do WhatsApp da sua farmácia em uma única tela. Vários operadores podem atender simultaneamente usando o mesmo número."
                      icon={MessageSquare}
                      features={[
                        { title: "Múltiplos Atendentes", description: "Toda sua equipe atendendo junto no mesmo número de WhatsApp.", icon: Users, iconColor: "text-emerald-400" },
                        { title: "Agilidade Total", description: "Envie links de produtos, controle pedidos e histórico na mesma tela.", icon: Zap, iconColor: "text-yellow-400" }
                      ]}
                    />
                  )
                )}

                {adminTab === "manual" && <AdminManual />}
              </div>
            </>
          )}
          {view === ViewMode.CART && (
            <Cart
              items={cart}
              tenant={currentTenant || undefined}
              promotions={promotions}
              coupons={coupons}
              matrizProducts={matrizProducts}
              updateQuantity={updateCartQuantity}
              onRemove={(id) => setCart(cart.filter((i) => i.id !== id))}
              onComplete={finalizeOrder}
              onBackToStore={() => handleViewChange(ViewMode.CATALOG)}
            />
          )}
        </Suspense>
        {view === ViewMode.CATALOG && <PWAInstallPrompt />}
      </main>

      {zoomImage && (
        <div
          className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center p-4 animate-in fade-in cursor-zoom-out"
          onClick={() => setZoomImage(null)}
        >
          <button
            onClick={() => setZoomImage(null)}
            className="absolute top-4 right-4 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all z-[210]"
          >
            <X size={24} />
          </button>
          <img
            src={zoomImage}
            className="max-w-full max-h-full object-contain animate-in zoom-in-50 duration-300"
            alt="Zoom"
            referrerPolicy="no-referrer"
          />
        </div>
      )}

      {selectedProduct && (
        <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center md:p-4 bg-gray-900/60 backdrop-blur-md animate-in fade-in">
          <div
            className={`bg-white w-full h-full md:h-auto md:max-h-[95vh] md:rounded-[2.5rem] max-w-5xl shadow-2xl flex flex-col relative overflow-hidden transition-all duration-500 animate-in slide-in-from-bottom-4`}
          >
            <button
              onClick={() => setSelectedProduct(null)}
              className="absolute top-4 right-4 z-20 bg-gray-100/80 backdrop-blur-md text-gray-600 p-2 rounded-full shadow-sm hover:bg-red-100 hover:text-red-600 transition-all border border-gray-200"
            >
              <X size={24} />
            </button>

            <div
              ref={productModalScrollRef}
              id="product-detail-scroll-container"
              className="overflow-y-auto flex-1 p-0 md:p-8 scrollbar-thin"
            >
              <div className="flex flex-col md:flex-row gap-0 md:gap-10">
                <div
                  className={`w-full md:w-[40%] bg-gray-50 flex flex-col items-center justify-center p-6 md:p-8 md:rounded-3xl gap-4 border-b md:border border-gray-100 relative min-h-[300px] md:min-h-[400px]`}
                >
                  <div
                    className="relative w-full h-[250px] md:h-[350px] flex items-center justify-center group cursor-zoom-in"
                    onClick={() => previewImage && setZoomImage(previewImage)}
                  >
                    {previewImage ? (
                      <picture>
                        <source srcSet={previewImage} type="image/webp" />
                        <img
                          src={previewImage.replace(
                            "&output=webp",
                            "&output=jpeg",
                          )}
                          className="max-w-full max-h-full object-contain rounded-xl shadow-sm transition-transform duration-500 group-hover:scale-105"
                          alt={selectedProduct.name}
                          referrerPolicy="no-referrer"
                          loading="lazy"
                          decoding="async"
                        />
                      </picture>
                    ) : (
                      <Package size={100} className="text-gray-300" />
                    )}
                    {previewImage && (
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/10 rounded-xl">
                        <div className="bg-white/90 backdrop-blur text-gray-900 p-3 rounded-full shadow-lg">
                          <Maximize2 size={24} />
                        </div>
                      </div>
                    )}
                  </div>
                  {(selectedProduct.image_url_2 ||
                    selectedProduct.image_url_3) && (
                    <div className="flex gap-2 overflow-x-auto w-full pb-2 no-scrollbar snap-x justify-center">
                      {[
                        selectedProduct.image,
                        selectedProduct.image_url_2,
                        selectedProduct.image_url_3,
                      ]
                        .filter(
                          (img, idx, self) => img && self.indexOf(img) === idx,
                        )
                        .map((img, idx) => (
                          <button
                            key={idx}
                            onClick={() =>
                              setPreviewImage(fixImageUrl(img!) || null)
                            }
                            className={`relative w-14 h-14 shrink-0 rounded-lg overflow-hidden border-2 transition-all snap-start ${previewImage === fixImageUrl(img!) ? "border-brand ring-2 ring-brand/20" : "border-gray-200 hover:border-brand/50"}`}
                          >
                            <picture>
                              <source
                                srcSet={fixImageUrl(img!)!}
                                type="image/webp"
                              />
                              <img
                                src={fixImageUrl(img!)!.replace(
                                  "&output=webp",
                                  "&output=jpeg",
                                )}
                                className="w-full h-full object-cover"
                                alt={`View ${idx}`}
                                referrerPolicy="no-referrer"
                                loading="lazy"
                                decoding="async"
                              />
                            </picture>
                          </button>
                        ))}
                    </div>
                  )}
                </div>

                <div className={`w-full md:w-[60%] flex flex-col p-6 md:p-0`}>
                  <div className="mb-2">
                    <div className="flex flex-wrap gap-2 mb-3">
                      <span className="bg-gray-100 text-gray-500 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">
                        {selectedProduct.category}
                      </span>
                      {selectedProduct.manufacturer &&
                        selectedProduct.manufacturer !== "Outros" && (
                          <span className="bg-emerald-50 text-emerald-600 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1">
                            <Factory size={10} /> {selectedProduct.manufacturer}
                          </span>
                        )}
                    </div>
                    <h2 className="text-2xl md:text-3xl font-black mb-1 text-gray-900 leading-tight">
                      {selectedProduct.name}
                    </h2>
                    {selectedProduct.presentation && (
                      <p className="text-sm font-black text-emerald-600 uppercase tracking-wide mb-1">
                        {selectedProduct.presentation}
                      </p>
                    )}
                    {selectedProduct.internalCode && (
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-6">
                        Ref: {selectedProduct.internalCode}
                      </p>
                    )}
                  </div>

                  {variableCombosForSelected.map((comboReq) => (
                    <div
                      key={comboReq.promo.id}
                      className="mb-6 animate-in slide-in-from-top duration-500 bg-gradient-to-br from-orange-50 via-amber-50 to-orange-50 border-2 border-orange-200/80 rounded-3xl p-5 md:p-6 shadow-sm relative overflow-hidden"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <span className="bg-orange-600 text-white text-[10px] font-black uppercase px-2.5 py-1 rounded-full tracking-wider flex items-center gap-1 shadow-sm shadow-orange-200">
                            <Sparkles size={12} /> Combo Especial
                          </span>
                          <h4 className="text-base md:text-lg font-black text-gray-900 tracking-tight">
                            {comboReq.promo.name}
                          </h4>
                        </div>
                        <span className="bg-emerald-100 text-emerald-800 text-[11px] font-black px-2.5 py-0.5 rounded-full">
                          Economize R$ {comboReq.discountAmount.toFixed(2)} ({comboReq.discountPercentage}% OFF)
                        </span>
                      </div>

                      <div className="flex items-baseline gap-3 mb-4">
                        <span className="text-2xl md:text-3xl font-black text-orange-600">
                          R$ {comboReq.comboPrice.toFixed(2)}
                        </span>
                        <span className="text-xs md:text-sm font-bold text-gray-400 line-through">
                          R$ {comboReq.regularTotal.toFixed(2)}
                        </span>
                        <span className="text-xs font-semibold text-gray-500">
                          pelos {comboReq.requiredProducts.reduce((acc, r) => acc + r.requiredQty, 0)} itens juntos
                        </span>
                      </div>

                      <p className="text-xs font-black text-gray-600 uppercase tracking-wider mb-2">
                        Itens necessários para ativar esta oferta:
                      </p>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                        {comboReq.requiredProducts.map((req) => (
                          <div
                            key={req.productId}
                            className={`p-2.5 rounded-2xl border flex items-center gap-3 transition-all ${
                              req.isCurrentSelected
                                ? "bg-white border-orange-300 shadow-sm ring-1 ring-orange-200"
                                : "bg-white/80 border-gray-200"
                            }`}
                          >
                            <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0 overflow-hidden">
                              {req.product?.image ? (
                                <img
                                  src={req.product.image}
                                  alt={req.productName}
                                  className="w-full h-full object-contain p-0.5"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <Package size={18} className="text-gray-400" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1">
                                <span className="bg-orange-100 text-orange-800 text-[10px] font-black px-1.5 py-0.2 rounded shrink-0">
                                  {req.requiredQty}x
                                </span>
                                <p className="text-xs font-bold text-gray-900 truncate" title={req.productName}>
                                  {req.productName}
                                </p>
                              </div>
                              <p className="text-[11px] text-gray-500 font-medium truncate">
                                {req.productPresentation || (req.unitPrice ? `R$ ${req.unitPrice.toFixed(2)} un` : "")}
                              </p>
                            </div>
                            {req.isCurrentSelected && (
                              <span className="bg-orange-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0">
                                Este item
                              </span>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="bg-amber-100/70 border border-amber-300/60 rounded-2xl p-3 text-amber-900 text-xs font-semibold flex items-start gap-2 mb-4">
                        <AlertCircle size={16} className="text-amber-700 shrink-0 mt-0.5" />
                        <span className="leading-snug">
                          <strong>Regra do Combo:</strong> O valor promocional de <strong>R$ {comboReq.comboPrice.toFixed(2)}</strong> será aplicado automaticamente no carrinho quando você adicionar todos os produtos listados acima.
                        </span>
                      </div>

                      <button
                        onClick={() => {
                          comboReq.requiredProducts.forEach((req) => {
                            const prod =
                              req.product ||
                              products.find((p) => p.id === req.productId) ||
                              matrizProducts.find((p) => p.id === req.productId);
                            if (prod && prod.stock > 0) {
                              for (let i = 0; i < req.requiredQty; i++) {
                                addToCart(prod as Product, false, false);
                              }
                            }
                          });
                          setGlobalToast(`Itens do combo (${comboReq.promo.name}) adicionados ao carrinho!`);
                          setTimeout(() => setGlobalToast(null), 2500);
                        }}
                        className="w-full py-3 px-4 bg-orange-600 hover:bg-orange-700 active:scale-[0.99] text-white rounded-2xl font-black text-xs md:text-sm flex items-center justify-center gap-2 shadow-md shadow-orange-300/40 transition-all cursor-pointer"
                      >
                        <ShoppingCart size={16} /> Adicionar Combo Completo ao Carrinho (R$ {comboReq.comboPrice.toFixed(2)})
                      </button>
                    </div>
                  ))}

                  {volumePromoForSelected ? (
                    <div className="mb-6 animate-in slide-in-from-left duration-500">
                      <div className="bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 p-5 rounded-3xl md:rounded-[2rem] text-white shadow-xl shadow-red-200 border border-red-500">
                        <div className="flex items-center gap-4">
                          <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center shrink-0 border border-white/20">
                            <Layers size={30} className="text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-[10px] font-black uppercase tracking-widest bg-white/20 px-2 py-0.5 rounded-full inline-block mb-1">
                              PROMOÇÃO CONDICIONAL DE VOLUME
                            </span>
                            <h4 className="text-lg font-black leading-none mb-1 uppercase tracking-tight">
                              {volumePromoForSelected.badgeText}
                            </h4>
                            <p className="text-xs font-medium text-red-50 leading-snug">
                              {volumePromoForSelected.modalDetailText}
                            </p>
                          </div>
                        </div>

                        {selectedProduct.stock >= volumePromoForSelected.minQty && (
                          <button
                            onClick={() => {
                              addToCart(selectedProduct, true, false, volumePromoForSelected.minQty);
                            }}
                            className="mt-4 w-full bg-white text-red-700 hover:bg-red-50 active:scale-[0.98] transition-all font-black text-xs md:text-sm py-3 px-4 rounded-2xl flex items-center justify-center gap-2 shadow-lg cursor-pointer"
                          >
                            <ShoppingBag size={18} />
                            {volumePromoForSelected.quickAddLabel}
                          </button>
                        )}
                      </div>
                    </div>
                  ) : activePromotionForSelected ? (
                    <div className="mb-6 animate-in slide-in-from-left duration-500">
                      <div className="bg-red-600 p-5 rounded-3xl md:rounded-[2rem] text-white shadow-xl shadow-red-200 flex items-center gap-5 border border-red-500 animate-pulse">
                        <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center shrink-0 border border-white/20">
                          <Percent size={30} className="text-white" />
                        </div>
                        <div className="flex-1">
                          <h4 className="text-lg font-black leading-none mb-1 uppercase tracking-tight">
                            {activePromotionForSelected.name}
                          </h4>
                          <p className="text-[11px] font-bold text-red-100 uppercase tracking-wider">
                            {activePromotionForSelected.type === "LIGHTNING_OFFER"
                              ? activePromotionForSelected.lightningDiscountPercentage
                                ? `Aproveite ${activePromotionForSelected.lightningDiscountPercentage}% de desconto por tempo limitado!`
                                : `Aproveite a oferta relâmpago por tempo limitado!`
                              : `Desconto promocional ativo por tempo limitado!`}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {isControlledProduct(selectedProduct) && (
                    <div className="mb-6 bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-2xl flex items-start gap-3">
                      <AlertTriangle
                        className="text-amber-500 shrink-0 mt-0.5"
                        size={24}
                      />
                      <div>
                        <h4 className="text-sm font-black text-amber-900 uppercase tracking-tight mb-1">
                          Atenção: Retenção de Receita
                        </h4>
                        <p className="text-xs font-medium text-amber-800 leading-relaxed">
                          Este medicamento exige retenção de receita médica e só
                          pode ser entregue mediante apresentação do documento
                          original.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="mb-8 flex flex-col md:flex-row items-stretch md:items-center justify-between bg-white border border-gray-100 p-5 rounded-3xl shadow-sm relative gap-4">
                    <div className="flex justify-between md:block">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                          Preço unitário avulso
                        </p>
                        {isControlledProduct(selectedProduct) && (
                          <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest flex items-center gap-1">
                            <AlertTriangle size={10} /> Receita
                          </span>
                        )}
                      </div>

                      {(() => {
                        let unitPrice = selectedProduct.price;
                        let hasDirectDiscount = false;
                        let directOriginalPrice = selectedProduct.originalPrice ?? selectedProduct.price;

                        if (selectedProduct.promotionalPrice && selectedProduct.promotionalPrice > 0 && selectedProduct.promotionalPrice < selectedProduct.price) {
                          unitPrice = selectedProduct.promotionalPrice;
                          directOriginalPrice = selectedProduct.price;
                          hasDirectDiscount = true;
                        } else if (selectedProduct.originalPrice && selectedProduct.originalPrice > selectedProduct.price) {
                          unitPrice = selectedProduct.price;
                          directOriginalPrice = selectedProduct.originalPrice;
                          hasDirectDiscount = true;
                        }

                        if (
                          !volumePromoForSelected &&
                          activePromotionForSelected &&
                          activePromotionForSelected.type === "LIGHTNING_OFFER" &&
                          activePromotionForSelected.lightningDiscountPercentage &&
                          activePromotionForSelected.lightningDiscountPercentage > 0
                        ) {
                          const discounted = Number(
                            (selectedProduct.price * (1 - activePromotionForSelected.lightningDiscountPercentage / 100)).toFixed(2)
                          );
                          if (discounted < unitPrice) {
                            directOriginalPrice = selectedProduct.price;
                            unitPrice = discounted;
                            hasDirectDiscount = true;
                          }
                        }

                        return (
                          <div className="flex flex-col">
                            {hasDirectDiscount && directOriginalPrice > unitPrice && (
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-gray-400 line-through">
                                  De: R$ {directOriginalPrice.toFixed(2)}
                                </span>
                                <span className="bg-red-50 text-red-600 text-[10px] font-black px-2 py-0.5 rounded-full font-mono">
                                  Economize R$ {(directOriginalPrice - unitPrice).toFixed(2)}
                                </span>
                              </div>
                            )}

                            <span className={`text-3xl font-black ${hasDirectDiscount ? "text-red-600" : "text-gray-900"}`}>
                              {hasDirectDiscount ? "Por: " : ""}R$ {unitPrice.toFixed(2)}
                            </span>

                            {volumePromoForSelected && (
                              <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-1.5 w-fit">
                                <p className="text-xs text-amber-900 font-extrabold leading-tight">
                                  💡 {volumePromoForSelected.auxText}
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    {selectedProduct.stock > 0 ? (
                      <button
                        onClick={() => {
                          addToCart(selectedProduct, true);
                        }}
                        className="bg-brand text-brand-contrast h-14 px-8 rounded-2xl font-black text-sm flex items-center justify-center gap-3 transition-all hover:scale-[1.05] active:scale-95 shadow-xl shadow-brand/20 w-full md:w-auto"
                        style={{ backgroundColor: currentTenant?.primaryColor }}
                      >
                        <ShoppingBag size={20} /> Adicionar
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          window.open(
                            `https://wa.me/55${currentTenant?.whatsapp}?text=Gostaria de saber quando chegará o produto: ${selectedProduct.name}`,
                          );
                        }}
                        className="bg-gray-900 text-white h-14 px-6 rounded-2xl font-black text-[10px] uppercase flex items-center justify-center gap-2 transition-all hover:bg-gray-800 shadow-xl w-full md:w-auto"
                      >
                        <AlertCircle size={18} /> Avise-me quando chegar
                      </button>
                    )}

                    {showAddedFeedback && (
                      <div className="absolute inset-0 bg-emerald-600 rounded-3xl flex items-center justify-center text-white font-black animate-in fade-in zoom-in-90 duration-300 z-10">
                        <CheckCircle2 className="mr-2" size={24} /> Adicionado!
                      </div>
                    )}
                  </div>

                  <div className="space-y-4 pb-8 md:pb-0">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {selectedProduct.activePrinciple && (
                        <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 flex items-center gap-3">
                          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-blue-500 shadow-sm">
                            <FlaskConical size={20} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest">
                              Princípio Ativo
                            </p>
                            <p className="text-xs font-black text-blue-800 truncate">
                              {selectedProduct.activePrinciple}
                            </p>
                          </div>
                        </div>
                      )}

                      {selectedProduct.manufacturer && (
                        <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 flex items-center gap-3">
                          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-emerald-500 shadow-sm">
                            <Factory size={20} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">
                              Laboratório
                            </p>
                            <p className="text-xs font-black text-emerald-800 truncate">
                              {selectedProduct.manufacturer}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="space-y-3 bg-gray-50/80 p-5 rounded-3xl border border-gray-100">
                      {selectedProduct.description && (
                        <div>
                          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 flex items-center gap-1">
                            <Info size={12} /> Descrição Comercial
                          </p>
                          <div className="text-gray-700 text-xs md:text-sm leading-relaxed font-medium">
                            {selectedProduct.description}
                          </div>
                        </div>
                      )}

                      {selectedProduct.indications && (
                        <div className="pt-2 border-t border-gray-100">
                          <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1 flex items-center gap-1">
                            <Info size={12} /> Indicações
                          </p>
                          <div className="text-gray-700 text-xs md:text-sm leading-relaxed font-medium">
                            {selectedProduct.indications}
                          </div>
                        </div>
                      )}

                      {selectedProduct.usage && (
                        <div className="pt-2 border-t border-gray-100">
                          <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-1 flex items-center gap-1">
                            <Info size={12} /> Modo de Uso
                          </p>
                          <div className="text-gray-700 text-xs md:text-sm leading-relaxed font-medium">
                            {selectedProduct.usage}
                          </div>
                        </div>
                      )}

                      {selectedProduct.sideEffects && (
                        <div className="pt-2 border-t border-gray-100">
                          <p className="text-[10px] font-black text-red-400 uppercase tracking-widest mb-1 flex items-center gap-1">
                            <Info size={12} /> Efeitos Colaterais
                          </p>
                          <div className="text-gray-700 text-xs md:text-sm leading-relaxed font-medium">
                            {selectedProduct.sideEffects}
                          </div>
                        </div>
                      )}

                      {selectedProduct.contraindications && (
                        <div className="pt-2 border-t border-gray-100">
                          <p className="text-[10px] font-black text-red-600 uppercase tracking-widest mb-1 flex items-center gap-1">
                            <Info size={12} /> Contraindicações
                          </p>
                          <div className="text-gray-700 text-xs md:text-sm leading-relaxed font-medium">
                            {selectedProduct.contraindications}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {productSuggestions.samePrinciple &&
                productSuggestions.samePrinciple.length > 0 && (
                  <div className="mt-10 pt-8 border-t-2 border-dashed border-gray-100 p-6 md:p-0">
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center animate-pulse ${checkIsMedicine(selectedProduct) ? "bg-blue-100 text-blue-600" : "bg-purple-100 text-purple-600"}`}
                        >
                          {checkIsMedicine(selectedProduct) ? (
                            <FlaskConical size={20} />
                          ) : (
                            <Layers size={20} />
                          )}
                        </div>
                        <div>
                          <h3 className="text-xl font-black text-gray-900 tracking-tight">
                            {productSuggestions.samePrincipleTitle}
                          </h3>
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                            {productSuggestions.samePrincipleSubtitle}
                          </p>
                        </div>
                      </div>
                      <span className="hidden md:flex items-center gap-1 text-[10px] font-black text-gray-300 uppercase tracking-widest">
                        Arraste para o lado <ChevronRight size={14} />
                      </span>
                    </div>

                    <div className="flex gap-4 overflow-x-auto pb-6 custom-scrollbar -mx-2 px-2 snap-x">
                      {productSuggestions.samePrinciple.map((p: any) => (
                        <SuggestionCard
                          key={p.id}
                          p={p}
                          currentTenant={currentTenant}
                          setSelectedProduct={handleProductClick}
                          setPreviewImage={setPreviewImage}
                          handleAddToCart={addToCart}
                          promotions={promotions}
                          activePromoIds={activePromoIds}
                        />
                      ))}
                    </div>
                  </div>
                )}

              {productSuggestions.otherSuggestions &&
                productSuggestions.otherSuggestions.length > 0 && (
                  <div className="mt-10 pt-8 border-t-2 border-dashed border-gray-100 p-6 md:p-0">
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center animate-pulse">
                          <Sparkles size={20} />
                        </div>
                        <div>
                          <h3 className="text-xl font-black text-gray-900 tracking-tight">
                            O que outros clientes levaram
                          </h3>
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                            Aproveite para completar sua cesta
                          </p>
                        </div>
                      </div>
                      <span className="hidden md:flex items-center gap-1 text-[10px] font-black text-gray-300 uppercase tracking-widest">
                        Arraste para o lado <ChevronRight size={14} />
                      </span>
                    </div>

                    <div className="flex gap-4 overflow-x-auto pb-6 custom-scrollbar -mx-2 px-2 snap-x">
                      {productSuggestions.otherSuggestions.map((p: any) => (
                        <SuggestionCard
                          key={p.id}
                          p={p}
                          currentTenant={currentTenant}
                          setSelectedProduct={handleProductClick}
                          setPreviewImage={setPreviewImage}
                          handleAddToCart={addToCart}
                          promotions={promotions}
                          activePromoIds={activePromoIds}
                        />
                      ))}
                    </div>
                  </div>
                )}
            </div>
          </div>
        </div>
      )}

      {globalToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-emerald-600 text-white px-6 py-3 rounded-full font-black shadow-2xl flex items-center gap-2 animate-in slide-in-from-bottom-5 fade-in duration-300 z-[9999]">
          <CheckCircle2 size={20} />
          {globalToast}
        </div>
      )}

      <OrderAlert
        unacknowledgedOrders={unacknowledgedOrders}
        onAcknowledge={() => {
          setUnacknowledgedOrders([]);
          if (view !== ViewMode.ADMIN_PHARMACY) {
            handleViewChange(ViewMode.ADMIN_PHARMACY);
          }
          setAdminTab("orders");
        }}
        primaryColor={currentTenant?.primaryColor}
        notificationSound={currentTenant?.notificationSound}
        notificationVolume={currentTenant?.notificationVolume}
      />
    </div>
  );
};

export default App;
