import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  CartItem,
  CustomerInfo,
  calculateItemTotal,
  calculateItemPromotionDetails,
  PharmacyConfig,
  isControlledProduct,
  PromotionRule,
  CouponRule,
  isPromotionActive,
  checkProductMatchesRule,
} from "../types";
import {
  Trash2,
  Plus,
  Minus,
  Send,
  MapPin,
  Loader2,
  ArrowLeft,
  Search as SearchIcon,
  Package,
  AlertTriangle,
  Tag,
  CheckCircle,
  Truck,
  Baby,
  ShieldAlert,
  Sparkles,
  PlusCircle,
  ArrowRight,
} from "lucide-react";
import { toast } from "react-hot-toast";

const GENERIC_PLACEHOLDER = "https://i.imgur.com/fLz8F3X.png";

const fixImageUrl = (url?: string, width: number = 200): string | null => {
  if (!url || url === "IGNORE" || url === "PENDENTE_CURADORIA") return null;
  if (url.startsWith("data:")) return url;
  if (url.includes("cdn-cosmos.bluesoft.com.br")) return url;

  // Se for uma URL de imagem relativa ou local, não passamos pelo proxy wsrv.nl para evitar falhas/timeouts
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return url;
  }

  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&output=webp&q=80&w=${width}&we&default=${encodeURIComponent(GENERIC_PLACEHOLDER)}`;
};


const CROSS_SELL_RULES = [
  // 1. Gripes e Resfriados <-> Vitaminas e Imunidade
  {
    triggerKeywords: ["antigripal", "resfriado", "gripe", "tosse", "xarope", "descongestionante"],
    suggestedCategory: "Vitaminas e Imunidade",
    searchQuery: "vitamina",
    message: "Reforce sua imunidade: Aproveite e leve também nossa linha de Vitaminas!",
    cta: "Ver Vitaminas",
    icon: "PlusCircle",
    exclusionKeywords: ["vitamina", "imunidade", "ascorbico", "zinco"]
  },
  {
    triggerKeywords: ["vitamina", "imunidade", "ascorbico", "zinco", "suplemento", "imuno"],
    suggestedCategory: "Gripes e Resfriados",
    searchQuery: "gripe",
    message: "Prevenção é tudo: Que tal reforçar seu kit com antigripais e xaropes?",
    cta: "Ver Antigripais",
    icon: "ShieldAlert",
    exclusionKeywords: ["antigripal", "gripe", "resfriado", "xarope", "descongestionante"]
  },
  
  // 2. Linha Infantil / Bebês <-> Higiene e Acessórios
  {
    triggerKeywords: ["fralda", "infantil", "bebê", "bebe", "mamãe", "chupeta", "mamadeira", "pampers", "huggies", "babysec"],
    suggestedCategory: "Higiene Infantil",
    searchQuery: "assadura",
    message: "Vai levar itens para o bebê? Não esqueça a pomada para assadura e os lencinhos!",
    cta: "Ver Higiene Infantil",
    icon: "Baby",
    exclusionKeywords: ["assadura", "lenço", "pomada", "toalhinha"]
  },
  {
    triggerKeywords: ["assadura", "lenço umedecido", "lenco umedecido", "pomada infantil", "toalhinha", "babymed", "hipoglos", "dexpantenol", "bepantol", "nstatina"],
    suggestedCategory: "Fraldas",
    searchQuery: "fralda",
    message: "Estoque garantido: Aproveite para levar mais fraldas para o bebê!",
    cta: "Ver Fraldas",
    icon: "Baby",
    exclusionKeywords: ["fralda", "pampers", "huggies", "babysec"]
  },

  // 3. Dores e Inflamações <-> Protetores Gástricos
  {
    triggerKeywords: ["anti-inflamatório", "antiinflamatorio", "dor", "analgésico", "analgesico", "ibuprofeno", "dipirona", "paracetamol"],
    suggestedCategory: "Estômago e Digestão",
    searchQuery: "estomago",
    message: "Evite irritações: O uso de anti-inflamatórios pode irritar o estômago. Que tal um protetor gástrico?",
    cta: "Ver Digestivos",
    icon: "ShieldAlert",
    exclusionKeywords: ["estômago", "estomago", "digestão", "azia", "omeprazol", "pantoprazol", "gastrico", "gástrico"]
  },
  {
    triggerKeywords: ["estômago", "estomago", "digestão", "azia", "omeprazol", "pantoprazol", "gastrico", "gástrico"],
    suggestedCategory: "Analgésicos e Anti-inflamatórios",
    searchQuery: "dor",
    message: "Farmacinha completa: Aproveite para abastecer seu kit com analgésicos e anti-inflamatórios.",
    cta: "Ver Analgésicos",
    icon: "ShieldAlert",
    exclusionKeywords: ["anti-inflamatório", "antiinflamatorio", "dor", "analgésico", "analgesico", "ibuprofeno", "dipirona", "paracetamol"]
  },

  // 4. Cuidados com a Pele / Dermocosméticos <-> Protetor Solar / Hidratantes
  {
    triggerKeywords: ["sabonete facial", "limpeza de pele", "acne", "esfoliante", "skincare", "dermocosmetico"],
    suggestedCategory: "Protetor Solar",
    searchQuery: "protetor solar",
    message: "Não esqueça o básico: Complete seu skincare com um bom Protetor Solar!",
    cta: "Ver Protetores Solares",
    icon: "Sparkles",
    exclusionKeywords: ["protetor solar", "fps", "sun", "bloqueador"]
  },
  {
    triggerKeywords: ["protetor solar", "fps", "sun", "bloqueador", "hidratante corporal", "loção"],
    suggestedCategory: "Dermocosméticos",
    searchQuery: "facial",
    message: "Cuidado completo: Adicione sabonetes faciais e dermocosméticos à sua rotina.",
    cta: "Ver Dermocosméticos",
    icon: "Sparkles",
    exclusionKeywords: ["sabonete facial", "limpeza", "acne", "esfoliante", "skincare", "dermocosmetico"]
  },

  // 5. Saúde Bucal <-> Enxaguantes / Fio Dental / Clareadores
  {
    triggerKeywords: ["creme dental", "pasta de dente", "escova dental", "escova de dente"],
    suggestedCategory: "Enxaguantes e Fio Dental",
    searchQuery: "fio dental",
    message: "Higiene bucal completa: Que tal adicionar fio dental ou um enxaguante bucal?",
    cta: "Ver Saúde Bucal",
    icon: "PlusCircle",
    exclusionKeywords: ["fio dental", "enxaguante", "listerine", "cepacol", "antisséptico"]
  },
  {
    triggerKeywords: ["fio dental", "enxaguante", "listerine", "cepacol", "antisséptico bucal"],
    suggestedCategory: "Cremes e Escovas",
    searchQuery: "creme dental",
    message: "Troque sua escova: Aproveite e renove suas escovas e cremes dentais!",
    cta: "Ver Escovas",
    icon: "PlusCircle",
    exclusionKeywords: ["creme dental", "pasta", "escova"]
  },

  // 6. Aparelhos de Medição e Saúde <-> Suplementos / Vitaminas / Descartáveis
  {
    triggerKeywords: ["glicosímetro", "glicosimetro", "medidor de pressão", "aparelho de pressao", "tira reagente", "lanceta"],
    suggestedCategory: "Descartáveis e Suplementos",
    searchQuery: "suplemento",
    message: "Monitoramento em dia: Leve também suas vitaminas e materiais descartáveis.",
    cta: "Ver Suplementos",
    icon: "ShieldAlert",
    exclusionKeywords: ["vitamina", "suplemento", "algodão", "álcool", "seringa"]
  },
  
  // 7. Cabelos / Shampoos <-> Tratamentos capilares / Condicionadores
  {
    triggerKeywords: ["shampoo", "xampu", "lavagem"],
    suggestedCategory: "Tratamentos Capilares",
    searchQuery: "condicionador",
    message: "Cabelos perfeitos: Leve o condicionador ou uma máscara de tratamento capilar!",
    cta: "Ver Tratamentos",
    icon: "Sparkles",
    exclusionKeywords: ["condicionador", "máscara", "mascara", "creme de pentear", "tratamento"]
  },
  {
    triggerKeywords: ["condicionador", "máscara capilar", "mascara capilar", "creme de pentear", "reparador"],
    suggestedCategory: "Shampoos",
    searchQuery: "shampoo",
    message: "Faltou o Shampoo? Complete sua linha de cuidados para o cabelo.",
    cta: "Ver Shampoos",
    icon: "Sparkles",
    exclusionKeywords: ["shampoo", "xampu"]
  }
];

function getCrossSellRecommendation(cartItems: any[]) {
  if (!cartItems || cartItems.length === 0) return null;
  
  const normalize = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  const cartTexts = cartItems.map(item => normalize(
    (item.name || "") + " " +
    (item.category || "") + " " +
    (item.description || "") + " " +
    (item.indication || "") + " " +
    (item.substance || "") + " " +
    (item.internalCode || "")
  ));
  
  for (const rule of CROSS_SELL_RULES) {
    const isTriggered = rule.triggerKeywords.some(kw => cartTexts.some(text => text.includes(normalize(kw))));
    
    if (isTriggered) {
      const hasSuggested = rule.exclusionKeywords.some(kw => cartTexts.some(text => text.includes(normalize(kw))));
      if (!hasSuggested) {
         return rule;
      }
    }
  }
  
  // Smart fallback recommendation if items exist but no rule matched
  return {
    suggestedCategory: "Farmacinha e Ofertas",
    searchQuery: "oferta",
    message: "Aproveite a sua compra: Que tal conferir nossas ofertas e itens essenciais para sua farmacinha?",
    cta: "Ver Ofertas",
    icon: "Sparkles",
    exclusionKeywords: []
  };
}

interface CartProps {
  items: CartItem[];
  tenant?: PharmacyConfig;
  promotions?: PromotionRule[];
  coupons?: CouponRule[];
  matrizProducts?: any[];
  updateQuantity: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
  onComplete: (
    customer: CustomerInfo,
    total: number,
    appliedCoupon?: CouponRule,
    couponDiscount?: number,
    calculatedDeliveryFee?: number,
    deliveryMode?: "delivery" | "pickup",
  ) => Promise<void> | void;
  onBackToStore: () => void;
}

export const Cart: React.FC<CartProps> = ({
  items,
  tenant,
  promotions = [],
  coupons = [],
  matrizProducts = [],
  updateQuantity,
  onRemove,
  onComplete,
  onBackToStore,
}) => {
  const [gateways, setGateways] = useState<any[]>([]);

  useEffect(() => {
    window.scrollTo(0, 0);

    // Dynamically inject Mercado Pago SDK script in the document head
    const existingScript = document.querySelector(
      'script[src="https://sdk.mercadopago.com/js/v2"]',
    );
    if (!existingScript) {
      const script = document.createElement("script");
      script.src = "https://sdk.mercadopago.com/js/v2";
      script.async = true;
      document.head.appendChild(script);
    }
  }, []);

  useEffect(() => {
    if (!tenant?.id) return;
    const fetchGatewaysConfig = async () => {
      try {
        const response = await fetch(`/api/v1/store/${tenant.id}/init`);
        if (response.ok) {
          const json = await response.json();
          if (json.paymentGateways) {
            setGateways(json.paymentGateways);
          }
        }
      } catch (err) {
        console.error("Erro ao carregar gateways da loja:", err);
      }
    };
    fetchGatewaysConfig();
  }, [tenant?.id]);

  const [customer, setCustomer] = useState<CustomerInfo>({
    name: "",
    phone: "",
    address: "",
    addressNumber: "",
    neighborhood: "",
    city: "",
    cep: "",
    paymentMethod: "Pix",
  });

  const [realCustomerData, setRealCustomerData] =
    useState<Partial<CustomerInfo> | null>(null);
  const [editedFields, setEditedFields] = useState<Record<string, boolean>>({});
  const [isFetchingCrm, setIsFetchingCrm] = useState(false);
  const [dataRecovered, setDataRecovered] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFetchingCep, setIsFetchingCep] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  
  // Delivery Fee States
  const [deliveryFee, setDeliveryFee] = useState<number>(0);
  const [isCalculatingFee, setIsCalculatingFee] = useState(false);
  const [deliveryError, setDeliveryError] = useState("");
  const [prescriptionConfirmed, setPrescriptionConfirmed] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [activeProductCoupon, setActiveProductCoupon] =
    useState<CouponRule | null>(null);

  const activeGlobalCoupon = useMemo(() => {
    return (
      coupons.find((c) => {
        if (c?.couponScope !== "GLOBAL" || !c?.isActive) return false;
        const now = new Date();
        if (c?.startDate && now < new Date(c.startDate)) return false;
        if (c?.endDate) {
          let end = c.endDate.includes("T")
            ? new Date(c.endDate)
            : new Date(`${c.endDate}T23:59:59`);
          if (now > end) return false;
        }
        return true;
      }) || null
    );
  }, [coupons]);

  const [couponError, setCouponError] = useState("");
  const [cepError, setCepError] = useState("");
  const [cepUnknown, setCepUnknown] = useState(false);
  const [deliveryMode, setDeliveryMode] = useState<"delivery" | "pickup">("delivery");
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const hasControlledItems = items.some((item) => isControlledProduct(item));

  const formatPhone = (value: string) => {
    const numbers = value.replace(/\D/g, "").slice(0, 11);
    if (numbers.length <= 10) {
      return numbers
        .replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3")
        .replace(/(\d{2})(\d{4})/, "($1) $2");
    }
    return numbers.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  };

  const [tick, setTick] = useState(0);
  const previousSubtotalRef = useRef<number | null>(null);
  const hasRestoredCoupon = useRef(false);

  useEffect(() => {
    if (hasRestoredCoupon.current || !coupons || coupons.length === 0) return;
    hasRestoredCoupon.current = true;

    const savedCode = localStorage.getItem("farmaflow_coupon_code");
    if (savedCode) {
      const code = savedCode.trim().toUpperCase();
      const coupon = coupons.find((c) => c.code === code);

      if (coupon && coupon.isActive) {
        const now = new Date();
        const start = coupon.startDate ? new Date(coupon.startDate) : null;
        let end = null;
        if (coupon.endDate) {
          if (coupon.endDate.includes("T")) {
            end = new Date(coupon.endDate);
          } else {
            const [year, month, day] = coupon.endDate.split("-");
            end = new Date(
              Number(year),
              Number(month) - 1,
              Number(day),
              23,
              59,
              59,
              999,
            );
          }
        }

        if (start && now < start) return;
        if (end && now > end) {
          localStorage.removeItem("farmaflow_coupon_code");
          return;
        }

        if (coupon?.couponScope !== "GLOBAL") {
          setActiveProductCoupon(coupon);
        }
        setCouponCode(savedCode);
      } else {
        localStorage.removeItem("farmaflow_coupon_code");
      }
    }
  }, [coupons]);

  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const maskText = (text: string) => {
    if (!text) return "";
    if (text.length <= 3) return text.substring(0, 1) + "***";
    if (text.length <= 5) return text.substring(0, 2) + "***";
    const parts = text.split(" ");
    if (parts.length > 1) {
      return parts[0].substring(0, 3) + "*** " + parts[parts.length - 1];
    }
    return text.substring(0, 3) + "***";
  };

  useEffect(() => {
    const cleanPhone = customer.phone.replace(/\D/g, "");

    if (cleanPhone.length === 11 && tenant?.id && !dataRecovered) {
      const fetchCRMData = async () => {
        setIsFetchingCrm(true);
        console.log("[CRM Lookup] Buscando para:", cleanPhone);
        try {
          const res = await fetch(
            `/api/checkout/address-lookup?tenant_id=${tenant.id}&whatsapp=${cleanPhone}`,
          );
          const data = await res.json();
          console.log("[CRM Lookup] Resultado:", data);

          if (res.ok) {
            if (data && data.found && data.data && data.data.customer_name) {
              const rData = {
                name: data.data.customer_name,
                cep: data.data.cep || "",
                address: data.data.street || "",
                neighborhood: data.data.neighborhood || "",
                city: data.data.city || "",
                addressNumber: data.data.number || "",
                complement: data.data.complement || "",
              };

              setRealCustomerData(rData);
              setEditedFields({});

              setCustomer((prev) => ({
                ...prev,
                name: maskText(rData.name),
                cep: maskText(rData.cep),
                address: maskText(rData.address),
                addressNumber: maskText(rData.addressNumber),
                neighborhood: maskText(rData.neighborhood),
                city: maskText(rData.city),
                complement: maskText(rData.complement),
              }));

              setDataRecovered(true);
              toast.success("Dados de entrega recuperados automaticamente!", {
                id: "crm-success",
              });
            }
          }
        } catch (e) {
          console.error("Erro ao buscar histórico", e);
        } finally {
          setIsFetchingCrm(false);
        }
      };

      fetchCRMData();
    }

    // Reset if they change phone format drastically
    if (cleanPhone.length < 10 && dataRecovered) {
      setDataRecovered(false);
    }
  }, [customer.phone, tenant?.id, dataRecovered]);

  const getDisplayValue = (field: keyof CustomerInfo) => {
    return customer[field] as string;
  };

  const handleFieldChange = (field: keyof CustomerInfo, value: string) => {
    setCustomer((prev) => ({ ...prev, [field]: value }));
    setEditedFields((prev) => ({ ...prev, [field]: true }));
    if (value) {
      setErrors((prev) => ({ ...prev, [field]: false }));
    }
  };

  const getFinalSubmitValue = (field: keyof CustomerInfo) => {
    if (realCustomerData && realCustomerData[field] && !editedFields[field]) {
      return realCustomerData[field] as string;
    }
    return customer[field] as string;
  };

  const subtotal = items.reduce(
    (acc, curr) => acc + calculateItemTotal(curr, promotions, matrizProducts, tenant?.id),
    0,
  );

  useEffect(() => {
    if (
      previousSubtotalRef.current !== null &&
      previousSubtotalRef.current !== subtotal &&
      items.length > 0
    ) {
      if (subtotal > previousSubtotalRef.current) {
        toast.error(
          "Atenção: A oferta relâmpago expirou e o preço dos itens foi atualizado",
          {
            duration: 5000,
          },
        );
      }
    }
    previousSubtotalRef.current = subtotal;
  }, [subtotal, items.length]);

  const calculateCouponDiscount = () => {
    let productDiscountAmount = 0;
    let globalDiscountAmount = 0;

    // 1. Calcula produto se existir cupom de produto válido
    if (activeProductCoupon && activeProductCoupon?.isActive) {
      let applicableTotal = items.reduce((acc, item) => {
        let isApplicable = checkProductMatchesRule(activeProductCoupon, item, matrizProducts, tenant?.id);

        if (isApplicable) {
          return acc + calculateItemTotal(item, promotions, matrizProducts, tenant?.id);
        }
        return acc;
      }, 0);

      if (applicableTotal > 0) {
        if (activeProductCoupon?.discountType === "PERCENTAGE") {
          productDiscountAmount =
            applicableTotal * ((activeProductCoupon?.discountValue || 0) / 100);
        } else {
          productDiscountAmount = Math.min(
            activeProductCoupon?.discountValue || 0,
            applicableTotal,
          );
        }
      }
    }

    // 2. Calcula global se atingiu o valor mínimo e o cupom for válido e ativo
    if (
      activeGlobalCoupon &&
      activeGlobalCoupon?.isActive &&
      subtotal >= Number(activeGlobalCoupon?.minPurchaseValue || 0)
    ) {
      if (activeGlobalCoupon?.discountType === "PERCENTAGE") {
        globalDiscountAmount =
          subtotal * ((activeGlobalCoupon?.discountValue || 0) / 100);
      } else {
        globalDiscountAmount = Math.min(
          activeGlobalCoupon?.discountValue || 0,
          subtotal,
        );
      }
    }

    return productDiscountAmount + globalDiscountAmount;
  };

  const discount = calculateCouponDiscount();
  
  useEffect(() => {
    if (!tenant?.deliverySettings?.enabled || deliveryMode === "pickup") {
      setDeliveryFee(0);
      setDeliveryError("");
      return;
    }

    const minFree = tenant?.deliverySettings?.minOrderForFreeDelivery || 0;
    if (minFree > 0 && subtotal >= minFree) {
      setDeliveryFee(0);
      setDeliveryError("");
      return;
    }

    if (!tenant?.deliverySettings?.type || tenant?.deliverySettings?.type === "fixed") {
      setDeliveryFee(tenant?.deliverySettings?.fee || 0);
      setDeliveryError("");
      return;
    }

    if (tenant?.deliverySettings?.type === "dynamic") {
      const cleanAddress = getFinalSubmitValue("address");
      const cleanNeighborhood = getFinalSubmitValue("neighborhood");
      const cleanCity = getFinalSubmitValue("city");
      const cleanNumber = getFinalSubmitValue("addressNumber");
      const cleanCep = getFinalSubmitValue("cep");

      const isAddressIncomplete = !cleanAddress || !cleanNeighborhood || !cleanCity;
      if (isAddressIncomplete) {
        setDeliveryFee(0);
        setDeliveryError(""); // Don't show error until they type
        return;
      }

      const fullAddress = `${cleanAddress}, ${cleanNumber || "S/N"} - ${cleanNeighborhood}, ${cleanCity} ${cleanCep ? `- CEP: ${cleanCep}` : ""}`;
      
      const fetchDynamicFee = async () => {
        setIsCalculatingFee(true);
        setDeliveryError("");
        try {
          const res = await fetch("/api/checkout/delivery-fee", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              tenantId: tenant.id,
              customerAddress: fullAddress,
              orderTotal: subtotal
            }),
          });
          
          const data = await res.json();
          if (data.success || data.fallback) {
             setDeliveryFee(data.fee);
          } else {
             setDeliveryFee(0);
             setDeliveryError(data.message || "Fora da área de entrega");
          }
        } catch (err) {
           console.error("Erro calcular frete:", err);
           setDeliveryError("Erro na comunicação para cálculo do frete");
           setDeliveryFee(0);
        } finally {
           setIsCalculatingFee(false);
        }
      };

      const debounceTimeout = setTimeout(fetchDynamicFee, 1000);
      return () => clearTimeout(debounceTimeout);
    }
  }, [
    tenant?.deliverySettings,
    tenant?.id,
    subtotal,
    customer.address,
    customer.addressNumber,
    customer.neighborhood,
    customer.city,
    customer.cep,
    realCustomerData,
    editedFields,
  ]);

  const total = Math.max(0, subtotal - discount + (deliveryFee === -1 ? 0 : deliveryFee));

  const isAddressIncomplete = !getFinalSubmitValue("address") || !getFinalSubmitValue("neighborhood") || !getFinalSubmitValue("city");
  const isDeliveryPending = Boolean(
    deliveryMode === "delivery" &&
    tenant?.deliverySettings?.enabled &&
    tenant?.deliverySettings?.type === "dynamic" &&
    isAddressIncomplete &&
    !(tenant?.deliverySettings?.minOrderForFreeDelivery > 0 && subtotal >= tenant.deliverySettings.minOrderForFreeDelivery)
  );

  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);

  const handleApplyCoupon = async () => {
    setCouponError("");
    if (!couponCode.trim()) {
      setActiveProductCoupon(null);
      localStorage.removeItem("farmaflow_coupon_code");
      return;
    }

    const code = couponCode.trim().toUpperCase();

    if (!tenant?.id) {
      setCouponError("Erro de contexto da loja. Tente atualizar a página.");
      return;
    }

    setIsApplyingCoupon(true);

    try {
      const response = await fetch("/api/coupons/validate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tenant_id: tenant.id,
          code: code,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setCouponError(data.message || "Cupom inválido ou não encontrado.");
        setActiveProductCoupon(null);
        localStorage.removeItem("farmaflow_coupon_code");
        return;
      }

      const couponScope = data.coupon.couponScope;
      const minPurchase = data.coupon.minPurchaseValue;

      if (couponScope !== "GLOBAL") {
        setActiveProductCoupon(data.coupon);
      }
      localStorage.setItem("farmaflow_coupon_code", data.coupon.code);
    } catch (e) {
      console.error("Erro ao validar cupom HTTP", e);
      setCouponError("Falha na conexão. Tente novamente.");
    } finally {
      setIsApplyingCoupon(false);
    }
  };

  const handleRemoveCoupon = () => {
    setActiveProductCoupon(null);
    setCouponCode("");
    setCouponError("");
    localStorage.removeItem("farmaflow_coupon_code");
  };

  const handleFetchCep = async () => {
    const cleanCep = customer.cep?.replace(/\D/g, "");
    if (!cleanCep || cleanCep.length !== 8) {
      setCepError("Por favor, insira um CEP válido com 8 dígitos.");
      return;
    }

    setIsFetchingCep(true);
    setCepError("");
    try {
      const response = await fetch(
        `https://viacep.com.br/ws/${cleanCep}/json/`,
      );
      const data = await response.json();

      if (data.erro) {
        setCepError(
          "CEP não encontrado. Por favor, verifique o número ou preencha o endereço manualmente.",
        );
      } else {
        setCustomer((prev) => ({
          ...prev,
          address: data.logradouro || prev.address,
          neighborhood: data.bairro || prev.neighborhood,
          city: `${data.localidade} - ${data.uf}`,
        }));
        setEditedFields((prev) => ({
          ...prev,
          address: true,
          neighborhood: true,
          city: true,
          cep: true,
        }));
        setErrors((prev) => ({
          ...prev,
          address: false,
          neighborhood: false,
          city: false,
        }));

        // Foca automaticamente no campo Número após carregar o endereço do CEP
        setTimeout(() => {
          inputRefs.current["addressNumber"]?.focus();
        }, 100);
      }
    } catch (error) {
      console.error("Erro ao buscar CEP:", error);
      setCepError("Erro ao consultar o serviço de CEP. Preencha manualmente.");
    } finally {
      setIsFetchingCep(false);
    }
  };

  // Busca automática do CEP quando o usuário digita/cola 8 dígitos
  useEffect(() => {
    const cleanCep = customer.cep?.replace(/\D/g, "");
    if (cleanCep && cleanCep.length === 8) {
      // Ignora se o CEP atual estiver mascarado (contém asteriscos vindos do CRM)
      const hasAsterisks = customer.cep.includes("*");
      if (!hasAsterisks) {
        const debounce = setTimeout(() => {
          handleFetchCep();
        }, 600); // Debounce de 600ms para evitar chamadas múltiplas durante a digitação rápida
        return () => clearTimeout(debounce);
      }
    }
  }, [customer.cep]);

  const handleCepKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleFetchCep();
    }
  };

  const handleConsultMap = () => {
    const { address, addressNumber, neighborhood, city } = customer;
    if (!address || !city)
      return alert(
        "Para consultar o mapa, preencha pelo menos a Rua e a Cidade.",
      );
    const query = `${address}, ${addressNumber || ""}, ${neighborhood || ""}, ${city}`;
    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    setCustomer((prev) => ({ ...prev, locationUrl: mapUrl }));
    window.open(mapUrl, "_blank");
  };

  const validateFields = () => {
    const newErrors: Record<string, boolean> = {};
    let hasError = false;
    const requiredFields = [
      "name",
      "phone",
    ];
    if (deliveryMode === "delivery") {
      requiredFields.push("address", "addressNumber", "neighborhood", "city");
    }

    requiredFields.forEach((field) => {
      // @ts-ignore
      const val = getFinalSubmitValue(field);
      if (!val || val.toString().trim() === "") {
        newErrors[field] = true;
        hasError = true;
      }
    });

    const finalPhone = getFinalSubmitValue("phone");
    if (!hasError && finalPhone.replace(/\D/g, "").length < 10) {
      alert("Por favor, insira um número de telefone válido com DDD.");
      newErrors["phone"] = true;
      hasError = true;
    }

    setErrors(newErrors);

    if (hasError) {
      for (const field of requiredFields) {
        if (newErrors[field]) {
          const el = inputRefs.current[field];
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.focus();
          }
          break;
        }
      }
    }

    return !hasError;
  };

  const handleFinish = async () => {
    if (!validateFields()) return;

    if (hasControlledItems && !prescriptionConfirmed) {
      alert(
        "Por favor, confirme que você possui a receita médica para os medicamentos controlados.",
      );
      return;
    }

    const cName = getFinalSubmitValue("name");
    const cPhone = getFinalSubmitValue("phone");
    const cAddress = getFinalSubmitValue("address");
    const cNumber = getFinalSubmitValue("addressNumber");
    const cCity = getFinalSubmitValue("city");
    const cCep = getFinalSubmitValue("cep");
    const cNeighborhood = getFinalSubmitValue("neighborhood");
    const cComplement = getFinalSubmitValue("complement");

    if (customer.paymentMethod === "Dinheiro") {
      if (customer.changeFor) {
        const cleanValueStr = customer.changeFor
          .replace(/[^\d,.]/g, "")
          .replace(",", ".");
        const changeValue = parseFloat(cleanValueStr);
        if (!isNaN(changeValue) && changeValue > 0 && changeValue < total) {
          alert(
            `O valor para troco (R$ ${changeValue.toFixed(2)}) não pode ser menor que o total do pedido (R$ ${total.toFixed(2)}).`,
          );
          return;
        }
      } else {
        if (
          !confirm(
            "Você não informou o troco. O entregador não levará troco. Deseja continuar?",
          )
        )
          return;
      }
    }

    let finalLocationUrl = "";
    if (cAddress && cCity) {
      const query = `${cAddress}, ${cNumber}, ${cNeighborhood}, ${cCity}`;
      finalLocationUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    }

    const finalCustomerData: CustomerInfo = {
      ...customer,
      name: cName || "",
      phone: cPhone || "",
      address: cAddress || "",
      addressNumber: cNumber || "",
      city: cCity || "",
      cep: cCep || "Não informado",
      neighborhood: cNeighborhood || "",
      complement: cComplement || "",
      locationUrl: finalLocationUrl,
    };

    setIsSubmitting(true);

    if (customer.paymentMethod === "Mercado Pago" && tenant?.id) {
      setStatusMessage("Gerando link seguro de pagamento Mercado Pago...");
      try {
        const prefRes = await fetch(
          `/api/v1/store/${tenant.id}/mercadopago/preference`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              items,
              customer: finalCustomerData,
              discount,
              total,
            }),
          },
        );

        if (!prefRes.ok) {
          const errData = await prefRes.json();
          throw new Error(errData.error || "Falha do servidor ao obter link.");
        }

        const prefData = await prefRes.json();
        const paymentUrl = prefData.init_point;
        if (paymentUrl) {
          setStatusMessage("Redirecionando ao Mercado Pago...");
          window.open(paymentUrl, "_blank");
          toast.success("Checkout Mercado Pago aberto em nova aba!");
        }
      } catch (mpError: any) {
        console.error("Mercado Pago error:", mpError);
        alert(
          `Não foi possível iniciar o pagamento do Mercado Pago: ${mpError.message || "Tente novamente ou escolha outro método de pagamento."}`,
        );
        setIsSubmitting(false);
        setStatusMessage("");
        return;
      }
    }

    setStatusMessage("Enviando seu pedido...");
    try {
      if (tenant?.id && finalCustomerData.phone) {
        fetch("/api/checkout/address-save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenant_id: tenant.id,
            whatsapp: finalCustomerData.phone,
            customer_name: finalCustomerData.name,
            cep: finalCustomerData.cep,
            street: finalCustomerData.address,
            number: finalCustomerData.addressNumber,
            neighborhood: finalCustomerData.neighborhood,
            city: finalCustomerData.city,
            complement: finalCustomerData.complement,
          }),
        }).catch((e) => console.error("Could not save address history", e));
      }

      await onComplete(
        finalCustomerData,
        total,
        activeProductCoupon || activeGlobalCoupon || undefined,
        discount,
        deliveryFee,
        deliveryMode
      );
      localStorage.removeItem("farmaflow_coupon_code");
      setActiveProductCoupon(null);
      setCouponCode("");
    } catch (error) {
      console.error("Erro no processo de finalização:", error);
    } finally {
      setIsSubmitting(false);
      setStatusMessage("");
    }
  };

  const getInputClass = (fieldName: string, extraClasses = "") => {
    const hasError = errors[fieldName];
    return `w-full bg-white border-2 rounded-2xl py-4 px-6 outline-none text-black transition-all font-bold placeholder:font-medium placeholder:text-gray-300 ${
      hasError
        ? "border-red-500 ring-4 ring-red-100 focus:border-red-600 focus:ring-red-200"
        : "border-gray-50 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50"
    } ${extraClasses}`;
  };

  const isMercadoPagoActive = gateways.some(
    (gw) => gw.gateway_name === "mercado_pago" && gw.is_active,
  );
  const availablePaymentMethods = ["Pix", "Cartão", "Dinheiro"];
  if (isMercadoPagoActive) {
    availablePaymentMethods.push("Mercado Pago");
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-gray-400 space-y-6">
        <div className="bg-white p-12 rounded-full shadow-sm border border-gray-50">
          <Trash2 size={80} className="text-gray-100" />
        </div>
        <div className="text-center space-y-2">
          <p className="text-2xl font-black text-gray-900">
            Seu carrinho está vazio.
          </p>
          <p className="text-gray-400 font-medium">
            Selecione alguns produtos no catálogo para continuar.
          </p>
        </div>
        <button
          onClick={onBackToStore}
          className="bg-emerald-600 text-white px-8 py-3 rounded-2xl font-bold"
        >
          Voltar à Loja
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 pb-24">
      <div className="space-y-6">
        <div className="flex items-center gap-4 mb-4">
          <button
            onClick={onBackToStore}
            className="p-3 bg-white border-2 border-gray-100 rounded-2xl text-gray-700 shadow-lg shadow-gray-100 hover:bg-gray-50 hover:border-gray-200 active:scale-95 transition-all"
          >
            <ArrowLeft size={24} strokeWidth={2.5} />
          </button>
          <h2 className="text-3xl font-black text-gray-900 tracking-tight">
            Meus Itens
          </h2>
        </div>

        {activeGlobalCoupon && activeGlobalCoupon?.minPurchaseValue
          ? (() => {
              const minPurchase = Number(
                activeGlobalCoupon?.minPurchaseValue || 0,
              );
              const faltaQuanto =
                minPurchase > subtotal ? minPurchase - subtotal : 0;
              return faltaQuanto > 0 ? (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="bg-amber-100 p-2 rounded-xl text-amber-600 shrink-0">
                      <Tag size={20} />
                    </div>
                    <div>
                      <h4 className="text-amber-900 font-black text-sm">
                        Quase lá!
                      </h4>
                      <p className="text-amber-800 text-xs mt-1 leading-relaxed">
                        Falta apenas{" "}
                        <span className="font-black">
                          {faltaQuanto.toLocaleString("pt-BR", {
                            style: "currency",
                            currency: "BRL",
                          })}
                        </span>{" "}
                        para você liberar o desconto do cupom{" "}
                        <span className="font-black">
                          {activeGlobalCoupon?.code}
                        </span>
                        ! 🛒✨
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={onBackToStore}
                    className="bg-amber-200 hover:bg-amber-300 text-amber-900 px-4 py-2.5 rounded-xl font-bold text-xs whitespace-nowrap transition-colors shadow-sm active:scale-95"
                  >
                    Ver mais produtos
                  </button>
                </div>
              ) : (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3">
                  <div className="bg-emerald-100 p-2 rounded-xl text-emerald-600 shrink-0">
                    <Tag size={20} />
                  </div>
                  <div>
                    <h4 className="text-emerald-900 font-black text-sm">
                      🎉 Parabéns!
                    </h4>
                    <p className="text-emerald-800 text-xs mt-1">
                      O valor mínimo foi atingido e o cupom{" "}
                      <span className="font-black">
                        {activeGlobalCoupon?.code}
                      </span>{" "}
                      foi aplicado com sucesso!
                    </p>
                  </div>
                </div>
              );
            })()
          : null}

        <div className="space-y-4">
          {items.map((item) => {
            const isMaxStock = item.quantity >= item.stock;
            const itemTotal = calculateItemTotal(item, promotions, matrizProducts, tenant?.id);
            const promoDetails = calculateItemPromotionDetails(
              item,
              promotions,
              matrizProducts,
              tenant?.id,
            );
            let activePromo =
              promotions.find((p) => p.id === promoDetails.promotionId) ||
              promotions.find((p) => {
                const now = new Date();
                if (!isPromotionActive(p, now)) return false;
                return checkProductMatchesRule(p, item, matrizProducts, tenant?.id);
              });

            if (
              !activePromo &&
              promoDetails.promotionId?.startsWith("legacy_") &&
              item.promotionType
            ) {
              activePromo = {
                id: promoDetails.promotionId,
                name: promoDetails.promotionName || "Desconto",
                type: item.promotionType,
                buyX:
                  item.promotionType === "BUY_X_PAY_Y"
                    ? item.buyX
                    : item.discountQtyThreshold,
                payY: item.payY,
              } as unknown as PromotionRule;
            }

            let displayImage = fixImageUrl(item.image);
            const isGeneric =
              item.drugType?.trim().toLowerCase() === "genérico" ||
              item.drugType?.trim().toLowerCase() === "generico";
            if (!displayImage && isGeneric && tenant) {
              const mfgKey = item.manufacturer
                ? Object.keys(tenant.manufacturerLogos || {}).find(
                    (k) =>
                      k.trim().toLowerCase() ===
                      item.manufacturer?.trim().toLowerCase(),
                  )
                : null;
              if (mfgKey && tenant.manufacturerLogos?.[mfgKey]) {
                displayImage = fixImageUrl(tenant.manufacturerLogos[mfgKey]);
              } else {
                displayImage = GENERIC_PLACEHOLDER;
              }
            }

            return (
              <div
                key={item.id}
                className="bg-white p-5 rounded-[2rem] border border-gray-50 flex gap-5 shadow-sm hover:shadow-md transition-all"
              >
                <div className="h-24 w-24 rounded-3xl bg-gray-50 flex-shrink-0 overflow-hidden flex items-center justify-center">
                  {displayImage ? (
                    <picture>
                      <source srcSet={displayImage} type="image/webp" />
                      <img
                        src={displayImage.replace(
                          "&output=webp",
                          "&output=jpeg",
                        )}
                        className="w-full h-full object-contain"
                        alt={item.name}
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        decoding="async"
                      />
                    </picture>
                  ) : (
                    <Package className="text-gray-200" size={32} />
                  )}
                </div>
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-black text-gray-900 truncate text-lg">
                      {item.name}
                    </h4>
                    {isControlledProduct(item) && (
                      <span className="bg-amber-100 text-amber-700 text-[10px] font-black uppercase px-2 py-0.5 rounded-full whitespace-nowrap">
                        Receita
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider">
                    Ref: {item.internalCode}
                  </p>

                  {activePromo && (
                    <div className="flex flex-col gap-1 mb-2">
                      <span className="bg-red-50 text-red-600 text-[9px] font-black uppercase px-2 py-0.5 rounded-lg w-fit flex items-center gap-1 border border-red-100">
                        <Tag size={10} strokeWidth={4} /> {activePromo.name}
                      </span>
                      {activePromo.type === "BUY_X_PAY_Y" &&
                        item.quantity < (activePromo.buyX || 1) && (
                          <p className="text-[9px] font-bold text-red-400 uppercase tracking-tight">
                            Adicione mais{" "}
                            {(activePromo.buyX || 1) - item.quantity} para
                            ativar!
                          </p>
                        )}
                      {activePromo.type === "BUY_X_PAY_Y" &&
                        item.quantity >= (activePromo.buyX || 1) && (
                          <p className="text-[9px] font-bold text-emerald-600 uppercase tracking-tight">
                            Desconto Aplicado!
                          </p>
                        )}
                      {activePromo.type === "FIXED_COMBO" &&
                        item.quantity < (activePromo.buyX || 1) && (
                          <p className="text-[9px] font-bold text-red-400 uppercase tracking-tight">
                            Adicione mais{" "}
                            {(activePromo.buyX || 1) - item.quantity} para o
                            combo de R$ {(activePromo.payY || 0).toFixed(2)}!
                          </p>
                        )}
                      {activePromo.type === "FIXED_COMBO" &&
                        item.quantity >= (activePromo.buyX || 1) && (
                          <p className="text-[9px] font-bold text-emerald-600 uppercase tracking-tight">
                            Combo aplicado! Você economizou R${" "}
                            {promoDetails.discount?.toFixed(2) || "0.00"}
                          </p>
                        )}
                      {activePromo.type === "DISCOUNT_ON_QTY" &&
                        item.quantity < (activePromo.buyX || 1) && (
                          <p className="text-[9px] font-bold text-red-400 uppercase tracking-tight">
                            Adicione mais{" "}
                            {(activePromo.buyX || 1) - item.quantity} para
                            ativar!
                          </p>
                        )}
                      {activePromo.type === "DISCOUNT_ON_QTY" &&
                        item.quantity >= (activePromo.buyX || 1) && (
                          <p className="text-[9px] font-bold text-emerald-600 uppercase tracking-tight">
                            Desconto Aplicado!
                          </p>
                        )}
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-2">
                    <p className="font-black text-emerald-600 text-xl">
                      R$ {itemTotal.toFixed(2)}
                    </p>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => updateQuantity(item.id, -1)}
                        className="w-10 h-10 rounded-xl flex items-center justify-center bg-gray-100 text-gray-800 hover:bg-gray-200 transition-all shadow-sm"
                      >
                        <Minus size={18} strokeWidth={3} />
                      </button>
                      <span className="font-black text-xl w-8 text-center text-gray-900">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQuantity(item.id, 1)}
                        disabled={isMaxStock}
                        className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all shadow-md ${isMaxStock ? "bg-gray-100 text-gray-300 cursor-not-allowed" : "bg-gray-900 text-white hover:bg-emerald-600"}`}
                      >
                        <Plus size={18} strokeWidth={3} />
                      </button>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => onRemove(item.id)}
                  className="text-gray-300 hover:text-red-500 transition-colors self-start p-1"
                >
                  <Trash2 size={20} />
                </button>
              </div>
            );
          })}
        </div>

        {(() => {
          const recommendation = getCrossSellRecommendation(items);
          if (recommendation) {
            const Icon = {
              PlusCircle: PlusCircle,
              Baby: Baby,
              ShieldAlert: ShieldAlert,
              Sparkles: Sparkles,
            }[recommendation.icon] || PlusCircle;

            return (
              <div className="mt-8 bg-blue-50/50 border border-blue-100 rounded-3xl p-6 flex flex-col md:flex-row items-center gap-6 animate-in slide-in-from-bottom-4 fade-in duration-500">
                <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shrink-0 shadow-sm border border-blue-50 text-blue-600">
                   <Icon size={32} />
                </div>
                <div className="flex-1 text-center md:text-left">
                  <h4 className="text-lg font-black text-blue-900 mb-2 leading-tight">{recommendation.message}</h4>
                  <p className="text-sm text-blue-700/80 font-medium">Aproveite para adicionar antes de finalizar sua compra.</p>
                </div>
                <button 
                  onClick={() => {
                     onBackToStore();
                     setTimeout(() => window.dispatchEvent(new CustomEvent('ff_search', { detail: recommendation.searchQuery })), 50);
                  }}
                  className="w-full md:w-auto bg-blue-600 text-white px-8 py-4 rounded-2xl font-black text-sm uppercase tracking-wide shadow-lg shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all shrink-0 flex items-center justify-center gap-2"
                >
                  {recommendation.cta} <ArrowRight size={18} />
                </button>
              </div>
            );
          }
          return null;
        })()}

      </div>

      <div className="space-y-8">
        <div className="bg-white p-10 md:p-14 rounded-[3.5rem] border border-gray-100 shadow-[0_20px_50px_rgba(0,0,0,0.03)] space-y-10">
          <h3 className="text-2xl font-black text-gray-900 border-b border-gray-50 pb-6 tracking-tight">
            Finalizar Pedido
          </h3>
          <div className="space-y-8">
            <div className="space-y-4 animate-in fade-in">
              <h4 className="font-black text-gray-900 text-lg">Identificação do Cliente</h4>
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest px-1">
                    WhatsApp / Telefone{" "}
                    {errors.phone && <span className="text-red-500">*</span>}
                  </label>
                  <div className="relative">
                    <input
                      ref={(el) => {
                        inputRefs.current["phone"] = el;
                      }}
                      type="tel"
                      placeholder="(00) 00000-0000"
                      className={getInputClass("phone")}
                      value={formatPhone(customer.phone)}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/\D/g, "").slice(0, 11);
                        handleFieldChange("phone", raw);
                      }}
                      maxLength={15}
                    />
                    {isFetchingCrm && (
                      <div className="absolute right-4 top-1/2 -translate-y-1/2">
                        <Loader2
                          size={18}
                          className="animate-spin text-emerald-500"
                        />
                      </div>
                    )}
                  </div>
                  {dataRecovered && (
                    <div className="flex items-center gap-1 mt-1 px-2 text-emerald-600 animate-in fade-in slide-in-from-top-2">
                      <CheckCircle size={12} />
                      <span className="text-[10px] font-bold">
                        Dados de entrega recuperados automaticamente!
                      </span>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest px-1">
                    Seu Nome Completo{" "}
                    {errors.name && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    ref={(el) => {
                      inputRefs.current["name"] = el;
                    }}
                    type="text"
                    placeholder="Como devemos lhe chamar?"
                    className={getInputClass("name")}
                    value={getDisplayValue("name")}
                    onFocus={() => {
                      if (
                        realCustomerData &&
                        realCustomerData.name &&
                        !editedFields.name
                      ) {
                        handleFieldChange("name", "");
                      }
                    }}
                    onChange={(e) => handleFieldChange("name", e.target.value)}
                  />
                </div>
              </div>
            </div>

            {deliveryMode === "delivery" && (
              <div className="space-y-4 pt-4 border-t border-gray-50 animate-in slide-in-from-top-4">
              <div className="flex items-center justify-between">
                <h4 className="font-black text-gray-900 text-lg">
                  Local de Entrega
                </h4>
                <button
                  type="button"
                  onClick={handleConsultMap}
                  className="flex items-center gap-2 bg-blue-50 text-blue-700 hover:bg-blue-100 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wide border border-blue-100"
                >
                  <MapPin size={14} /> Mapa
                </button>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest">
                    CEP
                  </label>
                  <div className="flex items-center gap-3">
                    <a
                      href="https://buscacepinter.correios.com.br/app/endereco/index.php"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-bold text-blue-600 hover:text-blue-700 underline"
                    >
                      Buscar no Correios
                    </a>
                    <button 
                      type="button" 
                      onClick={() => {
                        setCepUnknown(!cepUnknown);
                        if (!cepUnknown) {
                           handleFieldChange("cep", "");
                           setCepError("");
                           setTimeout(() => inputRefs.current["address"]?.focus(), 100);
                        }
                      }}
                      className="text-[11px] font-bold text-emerald-600 hover:text-emerald-700 underline underline-offset-2"
                    >
                      {cepUnknown ? "Voltar ao CEP" : "Não sei meu CEP"}
                    </button>
                  </div>
                </div>
                {cepUnknown && (
                  <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3.5 flex items-center justify-between gap-2 text-xs font-bold text-emerald-800 animate-in fade-in slide-in-from-top-1">
                    <span>📍 Preenchendo endereço sem CEP. Pode digitar o nome da rua e número abaixo!</span>
                    <button
                      type="button"
                      onClick={() => setCepUnknown(false)}
                      className="text-emerald-700 underline shrink-0 hover:text-emerald-900 font-extrabold"
                    >
                      Usar CEP
                    </button>
                  </div>
                )}
                {!cepUnknown && (
                  <div className="animate-in fade-in slide-in-from-top-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="00000-000"
                        className="flex-1 bg-white border-2 border-gray-50 rounded-2xl py-4 px-6 focus:border-emerald-500 outline-none text-black font-bold placeholder:text-gray-300"
                        value={getDisplayValue("cep")}
                        onFocus={() => {
                          if (
                            realCustomerData &&
                            realCustomerData.cep &&
                            !editedFields.cep
                          ) {
                            handleFieldChange("cep", "");
                          }
                        }}
                        onChange={(e) => {
                          handleFieldChange("cep", e.target.value);
                          setCepError("");
                        }}
                        onKeyDown={handleCepKeyDown}
                        enterKeyHint="search"
                      />
                      <button
                        type="button"
                        onClick={handleFetchCep}
                        disabled={isFetchingCep}
                        className="bg-emerald-50 text-emerald-600 px-6 py-4 rounded-2xl font-black text-xs uppercase border border-emerald-100 shrink-0"
                      >
                        {isFetchingCep ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <SearchIcon size={16} />
                        )}
                      </button>
                    </div>
                    {cepError && (
                      <p className="text-xs text-red-500 font-bold px-1 mt-1">
                        {cepError}
                      </p>
                    )}
                  </div>
                )}
              </div>
              <div className="flex gap-4">
                <div className="flex-1 space-y-2 min-w-0">
                  <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest px-1">
                    Rua{" "}
                    {errors.address && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    ref={(el) => {
                      inputRefs.current["address"] = el;
                    }}
                    type="text"
                    placeholder="Nome da rua"
                    className={getInputClass("address")}
                    value={getDisplayValue("address")}
                    onFocus={() => {
                      if (
                        realCustomerData &&
                        realCustomerData.address &&
                        !editedFields.address
                      ) {
                        handleFieldChange("address", "");
                      }
                    }}
                    onChange={(e) =>
                      handleFieldChange("address", e.target.value)
                    }
                  />
                </div>
                <div className="w-[80px] shrink-0 space-y-2">
                  <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest px-1">
                    Nº{" "}
                    {errors.addressNumber && (
                      <span className="text-red-500">*</span>
                    )}
                  </label>
                  <input
                    ref={(el) => {
                      inputRefs.current["addressNumber"] = el;
                    }}
                    type="tel"
                    placeholder="123"
                    className={getInputClass(
                      "addressNumber",
                      "text-center px-2 text-black",
                    )}
                    style={{
                      backgroundColor: "#ffffff",
                      color: "#000000",
                      WebkitTextFillColor: "#000000",
                      opacity: 1,
                      caretColor: "#000000",
                    }}
                    value={getDisplayValue("addressNumber")}
                    onFocus={() => {
                      if (
                        realCustomerData &&
                        realCustomerData.addressNumber &&
                        !editedFields.addressNumber
                      ) {
                        handleFieldChange("addressNumber", "");
                      }
                    }}
                    onChange={(e) =>
                      handleFieldChange("addressNumber", e.target.value)
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest px-1">
                  Complemento {"(Opcional)"}
                </label>
                <input
                  type="text"
                  placeholder="Apto, Bloco, Casa..."
                  className="w-full bg-white border-2 border-gray-50 rounded-2xl py-4 px-6 focus:border-emerald-500 outline-none text-black font-bold placeholder:text-gray-300"
                  value={getDisplayValue("complement") || ""}
                  onFocus={() => {
                    if (
                      realCustomerData &&
                      realCustomerData.complement &&
                      !editedFields.complement
                    ) {
                      handleFieldChange("complement", "");
                    }
                  }}
                  onChange={(e) =>
                    handleFieldChange("complement", e.target.value)
                  }
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest px-1">
                    Bairro{" "}
                    {errors.neighborhood && (
                      <span className="text-red-500">*</span>
                    )}
                  </label>
                  <input
                    ref={(el) => {
                      inputRefs.current["neighborhood"] = el;
                    }}
                    type="text"
                    placeholder="Bairro"
                    className={getInputClass("neighborhood")}
                    value={getDisplayValue("neighborhood")}
                    onFocus={() => {
                      if (
                        realCustomerData &&
                        realCustomerData.neighborhood &&
                        !editedFields.neighborhood
                      ) {
                        handleFieldChange("neighborhood", "");
                      }
                    }}
                    onChange={(e) =>
                      handleFieldChange("neighborhood", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest px-1">
                    Cidade{" "}
                    {errors.city && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    ref={(el) => {
                      inputRefs.current["city"] = el;
                    }}
                    type="text"
                    placeholder="Cidade"
                    className={getInputClass("city")}
                    value={getDisplayValue("city")}
                    onFocus={() => {
                      if (
                        realCustomerData &&
                        realCustomerData.city &&
                        !editedFields.city
                      ) {
                        handleFieldChange("city", "");
                      }
                    }}
                    onChange={(e) => handleFieldChange("city", e.target.value)}
                  />
                </div>
              </div>
            </div>
            )}

            <div className="space-y-4 pt-4 border-t border-gray-50">
              <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest px-1">
                Pagamento
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3">
                {availablePaymentMethods.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() =>
                      setCustomer({ ...customer, paymentMethod: m as any })
                    }
                    className={`py-4 rounded-2xl text-[10px] font-black border-2 transition-all ${customer.paymentMethod === m ? "bg-emerald-600 text-white border-emerald-600" : "bg-white border-gray-50 text-gray-400 hover:border-emerald-100"}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              {customer.paymentMethod === "Mercado Pago" && (
                <div className="bg-emerald-50 rounded-2xl p-5 border border-emerald-100 flex items-start gap-3 mt-3 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="bg-emerald-500 text-white rounded-full p-2 mt-0.5 shrink-0">
                    <CheckCircle size={18} />
                  </div>
                  <div>
                    <h5 className="text-xs font-black text-emerald-900 uppercase tracking-tight">
                      Checkout Seguro Mercado Pago
                    </h5>
                    <p className="text-[11px] text-emerald-800 leading-relaxed font-semibold mt-0.5">
                      Você será redirecionado para preencher os dados de entrega
                      e concluir o pagamento de forma 100% segura por Pix ou
                      Cartão de Crédito no Mercado Pago. Os dados do seu pedido
                      também serão enviados diretamente no WhatsApp!
                    </p>
                  </div>
                </div>
              )}
              {customer.paymentMethod === "Dinheiro" && (
                <div className="space-y-2">
                  <label className="text-[11px] font-black text-emerald-600 uppercase tracking-widest px-1">
                    Precisa de troco?
                  </label>
                  <input
                    type="text"
                    placeholder="Para quanto?"
                    className="w-full bg-emerald-50 border-2 border-emerald-100 rounded-2xl py-4 px-6 focus:border-emerald-500 outline-none text-emerald-900 font-bold"
                    value={customer.changeFor || ""}
                    onChange={(e) =>
                      setCustomer({ ...customer, changeFor: e.target.value })
                    }
                  />
                </div>
              )}
            </div>
          </div>

          {hasControlledItems && (
            <div className="pt-6 border-t border-gray-50">
              <div className="bg-amber-50 border-l-4 border-amber-500 p-5 rounded-r-3xl flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle
                    className="text-amber-500 shrink-0 mt-0.5"
                    size={24}
                  />
                  <div>
                    <h4 className="text-sm font-black text-amber-900 uppercase tracking-tight mb-1">
                      Atenção: Retenção de Receita
                    </h4>
                    <p className="text-xs font-medium text-amber-800 leading-relaxed">
                      Seu carrinho contém medicamentos que exigem retenção de
                      receita médica. A entrega só poderá ser concluída mediante
                      apresentação do documento original.
                    </p>
                  </div>
                </div>
                <label className="flex items-start gap-3 cursor-pointer group">
                  <div className="relative flex items-center justify-center mt-0.5">
                    <input
                      type="checkbox"
                      className="peer appearance-none w-5 h-5 border-2 border-amber-300 rounded bg-white checked:bg-amber-500 checked:border-amber-500 transition-colors cursor-pointer"
                      checked={prescriptionConfirmed}
                      onChange={(e) =>
                        setPrescriptionConfirmed(e.target.checked)
                      }
                    />
                    <svg
                      className="absolute w-3 h-3 text-white opacity-0 peer-checked:opacity-100 pointer-events-none"
                      viewBox="0 0 14 10"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M1 5L4.5 8.5L13 1"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <span className="text-xs font-bold text-amber-900 group-hover:text-amber-700 transition-colors">
                    Estou ciente de que preciso apresentar a receita física no
                    ato da entrega/retirada.
                  </span>
                </label>
              </div>
            </div>
          )}

          <div className="pt-6 border-t border-gray-50 space-y-4">
            <h4 className="font-black text-gray-900 text-lg flex items-center gap-2">
              <Tag size={20} className="text-brand" /> Cupom de Desconto
            </h4>
            {!activeProductCoupon ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Digite seu cupom"
                    className="flex-1 bg-white border-2 border-gray-50 rounded-2xl py-4 px-6 focus:border-brand outline-none text-black font-bold placeholder:text-gray-300 uppercase"
                    value={couponCode}
                    onChange={(e) =>
                      setCouponCode(e.target.value.toUpperCase())
                    }
                  />
                  <button
                    type="button"
                    onClick={handleApplyCoupon}
                    disabled={isApplyingCoupon}
                    className="bg-brand text-brand-contrast px-6 py-4 rounded-2xl font-black text-xs uppercase shadow-md active:scale-95 transition-all disabled:opacity-50"
                  >
                    {isApplyingCoupon ? (
                      <Loader2 className="animate-spin" size={16} />
                    ) : (
                      "Aplicar"
                    )}
                  </button>
                </div>
                {couponError && (
                  <p className="text-red-500 text-xs font-bold px-2">
                    {couponError}
                  </p>
                )}
              </div>
            ) : (
              <div className="bg-green-50 border border-green-100 rounded-2xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-green-100 p-2 rounded-xl text-green-600">
                    <Tag size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-green-800 font-black text-sm uppercase">
                        {activeProductCoupon?.code}
                      </p>
                      {activeProductCoupon?.couponScope === "GLOBAL" &&
                      activeProductCoupon?.minPurchaseValue ? (
                        <span className="bg-green-200 text-green-800 text-[9px] font-black uppercase px-2 py-0.5 rounded-full whitespace-nowrap">
                          Válido acima de R${" "}
                          {Number(activeProductCoupon?.minPurchaseValue || 0)
                            .toFixed(2)
                            .replace(".", ",")}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-green-600 text-xs font-bold">
                      {activeProductCoupon?.discountType === "PERCENTAGE"
                        ? `${activeProductCoupon?.discountValue}% de desconto`
                        : `R$ ${activeProductCoupon?.discountValue?.toFixed(2)} de desconto`}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRemoveCoupon}
                  className="text-red-500 hover:bg-red-50 p-2 rounded-xl transition-colors"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            )}
          </div>

          <div className="pt-10 border-t border-gray-50 space-y-6">
            <div className="flex justify-between items-center text-gray-400 font-bold px-1">
              <span>Subtotal</span>
              <span className="text-black">R$ {subtotal.toFixed(2)}</span>
            </div>
            {tenant?.deliverySettings?.enabled && (
              <div className="flex flex-col gap-1 px-1">
                <div className="flex justify-between items-center text-gray-400 font-bold">
                  <span>Taxa de Entrega</span>
                  {isCalculatingFee ? (
                     <span className="text-gray-500 flex items-center gap-2 text-sm">
                       <Loader2 size={14} className="animate-spin" /> Calculando...
                     </span>
                  ) : (
                    <span className={!isDeliveryPending && deliveryFee === 0 && !deliveryError ? "text-emerald-600 font-extrabold uppercase text-xs" : "text-black"}>
                      {deliveryError ? (
                        <span className="text-red-500 text-xs">-</span>
                      ) : isDeliveryPending ? (
                        <span className="text-amber-600 font-bold text-xs uppercase">A calcular</span>
                      ) : deliveryFee === -1 ? (
                        <span className="text-amber-600 font-bold text-xs uppercase">A combinar</span>
                      ) : deliveryFee === 0 ? "Grátis" : `R$ ${deliveryFee.toFixed(2)}`}
                    </span>
                  )}
                </div>
                {deliveryError && !isCalculatingFee && (
                  <div className="text-red-500 text-xs flex items-center gap-1 font-medium mt-1">
                    <AlertTriangle size={12} /> {deliveryError}
                  </div>
                )}
              </div>
            )}
            {tenant?.deliverySettings?.enabled &&
              (tenant?.deliverySettings?.minOrderForFreeDelivery || 0) > 0 && (
                <div className="px-1">
                  {subtotal >= (tenant?.deliverySettings?.minOrderForFreeDelivery || 0) ? (
                    <div className="bg-emerald-50 border border-emerald-100/50 rounded-2xl p-4 flex items-start gap-3 animate-in fade-in">
                      <div className="text-emerald-600 mt-0.5 shrink-0">
                        <Truck size={18} />
                      </div>
                      <div className="text-xs text-emerald-800 font-bold leading-relaxed">
                        Parabéns! Você atingiu o valor mínimo de <strong>R$ {(tenant?.deliverySettings?.minOrderForFreeDelivery || 0).toFixed(2)}</strong> e ganhou <strong>Frete Grátis</strong> nesta compra! 🎉
                      </div>
                    </div>
                  ) : (
                    <div className="bg-blue-50 border border-blue-100/50 rounded-2xl p-4 flex items-start gap-3 animate-in fade-in">
                      <div className="text-blue-500 mt-0.5 shrink-0 animate-bounce">
                        <Truck size={18} />
                      </div>
                      <div className="text-xs text-blue-800 font-bold leading-relaxed flex-1">
                        Falta apenas <strong className="text-blue-600 text-sm">R$ {((tenant?.deliverySettings?.minOrderForFreeDelivery || 0) - subtotal).toFixed(2)}</strong> em produtos para você ganhar <strong className="text-emerald-600">Frete Grátis</strong>!
                        <div className="mt-2 w-full bg-blue-200/50 rounded-full h-1.5 overflow-hidden">
                           <div 
                             className="bg-blue-500 h-full transition-all duration-500" 
                             style={{ width: `${Math.min(100, (subtotal / (tenant?.deliverySettings?.minOrderForFreeDelivery || 1)) * 100)}%` }}
                           />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            {discount > 0 && (
              <div className="flex justify-between items-center text-green-500 font-bold px-1">
                <span>
                  Desconto (
                  {[activeGlobalCoupon?.code, activeProductCoupon?.code]
                    .filter(Boolean)
                    .join(", ")}
                  )
                </span>
                <span>- R$ {discount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between items-center py-6 px-8 bg-emerald-50 rounded-3xl border border-emerald-100">
              <span className="text-emerald-900 font-black text-lg">
                Total Final
              </span>
              <span className="text-emerald-600 font-black text-3xl tracking-tight">
                R$ {total.toFixed(2)}
              </span>
            </div>

            {tenant?.minimumOrderValue &&
            subtotal < (tenant?.minimumOrderValue || 0) ? (
              <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-start gap-3">
                <AlertTriangle
                  className="text-red-500 shrink-0 mt-0.5"
                  size={20}
                />
                <div>
                  <p className="text-red-800 font-bold text-sm">
                    Valor mínimo não atingido
                  </p>
                  <p className="text-red-600 text-xs mt-1">
                    O valor mínimo para entrega é de{" "}
                    <strong>R$ {(tenant?.minimumOrderValue || 0).toFixed(2)}</strong>.
                    Adicione mais{" "}
                    <strong>
                      R$ {((tenant?.minimumOrderValue || 0) - subtotal).toFixed(2)}
                    </strong>{" "}
                    em produtos para continuar.
                  </p>
                </div>
              </div>
            ) : null}

            <button
              onClick={handleFinish}
              disabled={
                isSubmitting ||
                isCalculatingFee ||
                !!deliveryError ||
                (!!tenant?.minimumOrderValue &&
                  subtotal < (tenant?.minimumOrderValue || 0))
              }
              className={`w-full py-6 rounded-[2.2rem] font-black text-xl flex items-center justify-center gap-4 shadow-2xl shadow-emerald-200 active:scale-95 transition-all ${
                isSubmitting ||
                isCalculatingFee ||
                !!deliveryError ||
                (!!tenant?.minimumOrderValue &&
                  subtotal < (tenant?.minimumOrderValue || 0))
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed shadow-none"
                  : "bg-emerald-600 text-white hover:bg-emerald-700"
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin" size={24} /> Enviando...
                </>
              ) : (
                <>
                  <Send size={24} /> Concluir no WhatsApp
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
