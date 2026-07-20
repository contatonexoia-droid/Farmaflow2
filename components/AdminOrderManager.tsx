import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  Order,
  OrderStatus,
  calculateItemTotal,
  PharmacyConfig,
  Product,
  PromotionRule,
  CouponRule,
  checkProductMatchesRule,
} from "../types";
import {
  Search,
  Eye,
  Edit3,
  Trash2,
  CheckCircle,
  XCircle,
  Clock,
  MapPin,
  Phone,
  X,
  ChevronDown,
  CalendarDays,
  User,
  Package,
  Plus,
  Minus,
  FileText,
  Archive,
  Save,
  Printer,
  Upload,
  ClipboardList,
  DollarSign,
  AlertTriangle,
} from "lucide-react";
import { OrderConferenceModal } from "./OrderConferenceModal";
import { SmartNumberInput } from "./SmartNumberInput";

interface AdminOrderManagerProps {
  orders: Order[];
  products: Product[];
  onUpdateOrderStatus: (orderId: string, newStatus: OrderStatus) => void;
  onUpdateOrderCustomer: (
    orderId: string,
    updatedOrderData: Partial<Order>,
  ) => void;
  onDeleteOrder: (orderId: string) => void;
  onCleanupOldOrders: () => void;
  tenant?: PharmacyConfig;
  onProductsStateUpdate?: (products: Product[]) => void;
  promotions?: PromotionRule[];
  coupons?: CouponRule[];
  matrizProducts?: Product[];
  isDelivererMode?: boolean;
}

export const AdminOrderManager: React.FC<AdminOrderManagerProps> = ({
  orders,
  products,
  onUpdateOrderStatus,
  onUpdateOrderCustomer,
  onDeleteOrder,
  onCleanupOldOrders,
  tenant,
  onProductsStateUpdate,
  promotions = [],
  coupons = [],
  matrizProducts = [],
  isDelivererMode = false,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | OrderStatus>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [viewingOrder, setViewingOrder] = useState<Order | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [conferenceOrder, setConferenceOrder] = useState<Order | null>(null);
  const [sendingToPDV, setSendingToPDV] = useState<string | null>(null);

  const handleSendToPDV = async (order: Order) => {
    try {
      setSendingToPDV(order.id);
      const response = await fetch('/api/integrations/erp/send-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ order_id: order.id, tenant_id: order.tenantId }),
      });

      if (!response.ok) {
        let errorMessage = response.statusText;
        try {
          const errData = await response.json();
          if (errData.error) errorMessage = errData.error;
        } catch(e) {}
        throw new Error(`Erro: ${errorMessage}`);
      }

      const data = await response.json();
      
      onUpdateOrderStatus(order.id, 'enviado_ao_pdv' as OrderStatus);
      alert('Pedido enviado para a fila do caixa!');
    } catch (error: any) {
      console.error(error);
      alert(`Falha ao enviar para o PDV. ${error.message || ''}`);
    } finally {
      setSendingToPDV(null);
    }
  };

  const startInputRef = useRef<HTMLInputElement>(null);
  const endInputRef = useRef<HTMLInputElement>(null);

  const openPicker = (ref: React.RefObject<HTMLInputElement | null>) => {
    if (ref.current) {
      try {
        if ("showPicker" in ref.current) {
          (ref.current as any).showPicker();
        } else {
          (ref.current as any).focus();
          (ref.current as any).click();
        }
      } catch (e) {
        (ref.current as any).focus();
      }
    }
  };

  const safeDate = (dateStr: string) => {
    try {
      if (!dateStr) return "-";
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return "-";
      return d.toLocaleString("pt-BR");
    } catch (e) {
      return "-";
    }
  };

  const executeWhatsAppTrigger = async (order: Order) => {
    if (!tenant) return;
    const cleanPhone = order.customer.phone.replace(/\D/g, "");
    console.log(
      `[FarmaFlow Debug]: Disparando webhook para o pedido ${order.id} com status Em Rota/Enviado`,
    );

    try {
      const { supabase } = await import("../services/supabase");
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (session) headers["Authorization"] = `Bearer ${session.access_token}`;

      const response = await fetch(
        `/api/v1/tenants/${tenant.id}/messages/whatsapp`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            orderId: order.id,
            customerName: order.customer.name,
            customerPhone: cleanPhone,
          }),
        },
      );

      if (!response.ok) {
        const err = await response.json().catch(() => null);
        console.error(
          "[FarmaFlow WhatsApp Error]:",
          "Status Code:",
          response.status,
          err,
        );
      } else {
        console.log(
          "[FarmaFlow Debug]: Resposta do Webhook WhatsApp:",
          await response.json(),
        );
      }
    } catch (e) {
      console.error("[FarmaFlow WhatsApp Error]:", e);
    }
  };

  const handleSendDeliveryNotification = async (order: Order) => {
    const cleanPhone = order.customer.phone.replace(/\D/g, "");
    const message = `Olá, ${order.customer.name}! 🛵 Seu pedido da Farmácia já foi separado e acabou de sair para entrega com o nosso motoboy. Em breve ele estará aí!`;

    // Opção A: Abrir nativo (Recomendado via App / Web)
    const waUrl = `https://wa.me/55${cleanPhone}?text=${encodeURIComponent(message)}`;
    window.open(waUrl, "_blank", "noopener,noreferrer");

    // Opção B: (Descomente se preferir via API background)
    /*
      executeWhatsAppTrigger(order);
      alert("Notificação solicitada via servidor!");
      */
  };

  const handleStatusChangeWrapper = (order: Order, newStatus: OrderStatus) => {
    onUpdateOrderStatus(order.id, newStatus);
    if (newStatus === "dispatched" && order.status !== "dispatched") {
      executeWhatsAppTrigger(order);
    }
  };

  // Debouncing for search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  const filteredOrders = useMemo(() => {
    const term = debouncedSearchTerm.toLowerCase();
    return (orders || [])
      .filter((order) => {
        if (!order) return false;
        if (!order.date) return false;

        // Se for entregador, só vê dispatched
        if (isDelivererMode && order.status !== "dispatched") {
          return false;
        }

        const orderDateStr = order.date.split("T")[0];
        const customerName = order.customer?.name || "";
        const customerPhone = order.customer?.phone || "";
        const orderId = order.id || "";

        const matchesSearch =
          customerName.toLowerCase().includes(term) ||
          orderId.toLowerCase().includes(term) ||
          customerPhone.includes(debouncedSearchTerm);

        const matchesStatus =
          statusFilter === "all" || order.status === statusFilter;
        const matchesDate =
          (!startDate || orderDateStr >= startDate) &&
          (!endDate || orderDateStr <= endDate);

        return matchesSearch && matchesStatus && matchesDate;
      })
      .sort((a, b) => {
        const dateA = a.date ? new Date(a.date).getTime() : 0;
        const dateB = b.date ? new Date(b.date).getTime() : 0;
        return dateB - dateA;
      });
  }, [orders, debouncedSearchTerm, statusFilter, startDate, endDate]);

  const oldOrdersCount = useMemo(() => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return (orders || []).filter(
      (o) => o.date && new Date(o.date) < thirtyDaysAgo,
    ).length;
  }, [orders]);

  const handleEditClick = (order: Order) => {
    try {
      setEditingOrder(JSON.parse(JSON.stringify(order)));
    } catch (e) {
      console.error("Erro ao clonar pedido:", e);
    }
  };

  const recalculateOrderTotals = (items: any[], appliedCouponCode?: string) => {
    const subtotal = items.reduce(
      (acc, curr) => acc + calculateItemTotal(curr, promotions, matrizProducts, tenant?.id, items),
      0,
    );

    let discount = 0;
    if (appliedCouponCode) {
      const couponCode = appliedCouponCode.trim().toUpperCase();
      const appliedCoupon = coupons.find((c) => c.code === couponCode);
      if (appliedCoupon && appliedCoupon.isActive) {
        if (
          appliedCoupon?.couponScope === "GLOBAL" &&
          appliedCoupon?.minPurchaseValue &&
          subtotal < appliedCoupon.minPurchaseValue
        ) {
          // Invalidated by subtotal drop
        } else {
          let applicableTotal = 0;
          if (
            appliedCoupon?.targetType === "ALL" ||
            appliedCoupon?.couponScope === "GLOBAL"
          ) {
            applicableTotal = subtotal;
          } else {
            applicableTotal = items.reduce((acc, item) => {
              let isApplicable = checkProductMatchesRule(appliedCoupon, item, matrizProducts, tenant?.id);

              if (isApplicable) {
                return acc + calculateItemTotal(item, promotions, matrizProducts, tenant?.id, items);
              }
              return acc;
            }, 0);
          }
          if (applicableTotal > 0) {
            if (appliedCoupon?.discountType === "PERCENTAGE") {
              discount =
                applicableTotal * ((appliedCoupon?.discountValue || 0) / 100);
            } else {
              discount = Math.min(
                appliedCoupon?.discountValue || 0,
                applicableTotal,
              );
            }
          }
        }
      }
    }

    return {
      couponDiscount: discount,
      total: Math.max(0, subtotal - discount),
    };
  };

  const updateEditingItemQty = (index: number, delta: number) => {
    setEditingOrder((prev) => {
      if (!prev) return null;
      const items = [...(prev.items || [])];
      const item = items[index];
      if (!item) return prev;

      const newQty = (item.quantity || 0) + delta;

      if (newQty <= 0) {
        if (confirm("Remover este item do pedido?")) {
          items.splice(index, 1);
        } else {
          return prev;
        }
      } else {
        items[index] = { ...item, quantity: newQty };
      }

      const { couponDiscount, total } = recalculateOrderTotals(
        items,
        prev.appliedCoupon,
      );
      return {
        ...prev,
        items,
        couponDiscount,
        total: parseFloat(total.toFixed(2)),
      };
    });
  };

  const updateEditingItemPrice = (index: number, newPrice: number) => {
    setEditingOrder((prev) => {
      if (!prev) return null;
      const items = [...(prev.items || [])];
      if (!items[index]) return prev;

      items[index] = { ...items[index], price: newPrice };

      const { couponDiscount, total } = recalculateOrderTotals(
        items,
        prev.appliedCoupon,
      );
      return {
        ...prev,
        items,
        couponDiscount,
        total: parseFloat(total.toFixed(2)),
      };
    });
  };

  const removeEditingItem = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    if (!confirm("Deseja realmente remover este item do pedido?")) return;

    setEditingOrder((prev) => {
      if (!prev) return null;
      const items = (prev.items || []).filter((_, i) => i !== index);
      const { couponDiscount, total } = recalculateOrderTotals(
        items,
        prev.appliedCoupon,
      );
      return {
        ...prev,
        items,
        couponDiscount,
        total: parseFloat(total.toFixed(2)),
      };
    });
  };

  const handleSaveEdit = () => {
    if (editingOrder) {
      if (!editingOrder.items || editingOrder.items.length === 0) {
        alert("O pedido não pode ficar sem itens.");
        return;
      }
      onUpdateOrderCustomer(editingOrder.id, editingOrder);
      setEditingOrder(null);
    }
  };

  const handleDeleteClick = (id: string) => setDeleteTargetId(id);
  const confirmDelete = () => {
    if (deleteTargetId) {
      onDeleteOrder(deleteTargetId);
      setDeleteTargetId(null);
    }
  };

  const handleCleanupClick = () => {
    if (oldOrdersCount === 0) {
      alert("Não há pedidos antigos para excluir.");
      return;
    }
    setShowCleanupModal(true);
  };
  const confirmCleanup = () => {
    onCleanupOldOrders();
    setShowCleanupModal(false);
  };

  const handleGenerateDocument = (
    order: Order,
    type: "RECIBO" | "ORÇAMENTO",
  ) => {
    if (!tenant) return;
    const docWindow = window.open("", "_blank", "width=800,height=600");
    if (!docWindow) return alert("Habilite pop-ups para imprimir o documento.");

    const logoHtml = tenant.logo
      ? `<img src="${tenant.logo}" style="max-height: 80px; display: block; margin: 0 auto;" referrerPolicy="no-referrer">`
      : "";
    const itemsHtml = order.items
      .map(
        (item) => `
        <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${item.quantity}x</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${item.name}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">R$ ${calculateItemTotal(item, promotions, matrizProducts, tenant?.id, order.items).toFixed(2)}</td>
        </tr>
      `,
      )
      .join("");

    const validityHtml =
      type === "ORÇAMENTO"
        ? `<p style="margin: 10px 0 0 0; font-size: 12px; color: #d97706; font-weight: bold;">Validade deste orçamento: 7 dias a partir da data de emissão.</p>`
        : "";

    const html = `
        <html>
        <head>
            <title>${type} #${order.id}</title>
            <style>
                body { font-family: 'Helvetica', sans-serif; padding: 40px; color: #333; font-size: 14px; }
                .header { text-align: center; margin-bottom: 40px; }
                .company-name { font-size: 24px; font-weight: bold; margin: 10px 0 5px 0; text-transform: uppercase; }
                .company-info { font-size: 12px; color: #666; line-height: 1.4; }
                .section-title { font-weight: bold; border-bottom: 2px solid #000; padding-bottom: 5px; margin: 20px 0 10px 0; text-transform: uppercase; font-size: 12px; }
                .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
                .row { display: flex; justify-content: space-between; margin-bottom: 5px; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                th { text-align: left; border-bottom: 2px solid #ddd; padding: 8px; font-size: 12px; text-transform: uppercase; }
                .total-row { font-size: 18px; font-weight: bold; text-align: right; margin-top: 20px; padding-top: 10px; border-top: 2px solid #000; }
                .footer { margin-top: 60px; text-align: center; font-size: 12px; color: #888; }
                .signature-box { margin-top: 50px; display: flex; justify-content: space-between; gap: 40px; }
                .signature-line { border-top: 1px solid #000; flex: 1; text-align: center; padding-top: 10px; font-size: 12px; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="header">
                ${logoHtml}
                <div class="company-name">${tenant.name}</div>
                <div class="company-info">
                    ${tenant.cnpj ? `CNPJ: ${tenant.cnpj}<br>` : ""}
                    ${tenant.fullAddress ? `${tenant.fullAddress}<br>` : ""}
                    ${tenant.corporateEmail ? `Email: ${tenant.corporateEmail} | ` : ""} Tel: ${tenant.whatsapp}
                </div>
            </div>

            <div style="text-align: center; margin-bottom: 30px;">
                <h2 style="margin: 0; text-transform: uppercase;">${type === "RECIBO" ? "Recibo de Venda" : "Orçamento de Venda"}</h2>
                <p style="margin: 5px 0 0 0; font-weight: bold;">Pedido #${order.id}</p>
                <p style="margin: 0; font-size: 12px; color: #666;">Data de Emissão: ${new Date().toLocaleString("pt-BR")}</p>
                ${validityHtml}
            </div>

            <div class="section-title">Dados do Cliente</div>
            <div class="grid">
                <div>
                    <div class="row"><span>Nome:</span> <strong>${order.customer?.name}</strong></div>
                    <div class="row"><span>Telefone:</span> <strong>${order.customer?.phone}</strong></div>
                </div>
                <div>
                    <div class="row"><span>Endereço:</span> <strong>${order.customer?.address || "N/A"}, ${order.customer?.addressNumber || ""}</strong></div>
                    <div class="row"><span>Cidade:</span> <strong>${order.customer?.neighborhood} - ${order.customer?.city}</strong></div>
                </div>
            </div>

            <div class="section-title">Itens do Documento</div>
            <table>
                <thead>
                    <tr>
                        <th width="10%">Qtd</th>
                        <th width="60%">Descrição</th>
                        <th width="30%" style="text-align: right;">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml}
                </tbody>
            </table>

            <div class="total-row">
                ${order.appliedCoupon ? `<div style="font-size: 14px; font-weight: normal; margin-bottom: 5px; color: #10b981;">Cupom Aplicado: ${order.appliedCoupon}</div>` : ""}
                Valor Total: R$ ${order.total.toFixed(2)}
            </div>
            <div style="text-align: right; font-size: 12px; margin-top: 5px;">
                Condição de Pagamento: <strong>${order.customer?.paymentMethod}</strong>
            </div>

            ${
              order.observation
                ? `
            <div class="section-title">Observações</div>
            <p>${order.observation}</p>
            `
                : ""
            }

            <div class="signature-box">
                <div class="signature-line">
                    Assinatura do Responsável
                </div>
                <div class="signature-line">
                    Assinatura do Cliente
                </div>
            </div>

            <div class="footer">
                Documento sem valor fiscal. Emitido pelo sistema FarmaFlow AI.
            </div>
            
            <script>
                window.onload = function() { window.print(); }
            </script>
        </body>
        </html>
      `;

    docWindow.document.write(html);
    docWindow.document.close();
  };

  const handleReceiptUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    order: Order,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024)
      return alert("Arquivo muito grande. Máximo 2MB.");

    const reader = new FileReader();
    reader.onload = (evt) => {
      if (evt.target?.result) {
        onUpdateOrderCustomer(order.id, {
          receiptFile: evt.target.result as string,
        });
        alert("Documento anexado com sucesso!");
      }
    };
    reader.readAsDataURL(file);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "confirmed":
        return (
          <span className="bg-blue-100 text-blue-700 px-3 py-1.5 rounded-full text-[10px] font-black uppercase flex items-center gap-1 w-fit border border-blue-200">
            <CheckCircle size={10} /> Confirmado
          </span>
        );
      case "dispatched":
        return (
          <span className="bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded-full text-[10px] font-black uppercase flex items-center gap-1 w-fit border border-emerald-200">
            <Package size={10} /> Em Rota
          </span>
        );
      case "cancelled":
        return (
          <span className="bg-red-100 text-red-700 px-3 py-1.5 rounded-full text-[10px] font-black uppercase flex items-center gap-1 w-fit border border-red-200">
            <XCircle size={10} /> Cancelado
          </span>
        );
      case "enviado_ao_pdv":
        return (
          <span className="bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-full text-[10px] font-black uppercase flex items-center gap-1 w-fit border border-indigo-200">
            <Upload size={10} /> Enviado ao PDV
          </span>
        );
      case "impresso_no_pdv":
      case "concluido_no_pdv":
        return (
          <span className="bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded-full text-[10px] font-black uppercase flex items-center gap-1 w-fit border border-emerald-200">
            <CheckCircle size={10} /> Concluído no PDV
          </span>
        );
      case "erro_integracao_pdv":
        return (
          <span className="bg-orange-100 text-orange-700 px-3 py-1.5 rounded-full text-[10px] font-black uppercase flex items-center gap-1 w-fit border border-orange-200">
            <AlertTriangle size={10} /> Erro PDV
          </span>
        );
      default:
        return (
          <span className="bg-amber-100 text-amber-700 px-3 py-1.5 rounded-full text-[10px] font-black uppercase flex items-center gap-1 w-fit border border-amber-200">
            <Clock size={10} /> Pendente
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 px-4 md:px-0">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100">
        <div>
          <h2 className="text-2xl font-black text-gray-900 tracking-tight">
            Gerenciar Pedidos
          </h2>
          <p className="text-gray-500 text-sm font-medium">
            {filteredOrders.length} pedidos encontrados
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-4 w-full lg:w-auto items-stretch md:items-center">
          <button
            onClick={handleCleanupClick}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-red-50 text-red-600 rounded-2xl font-bold text-xs hover:bg-red-100 transition-colors border border-red-100 active:scale-95"
          >
            <Archive size={16} />{" "}
            <span className="whitespace-nowrap">Limpar Antigos</span>
          </button>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 bg-gray-50 p-1.5 rounded-2xl border border-gray-100 shadow-inner">
            <div
              className="flex items-center gap-3 px-3 py-2 bg-white rounded-xl border-2 border-transparent cursor-pointer hover:border-emerald-500 transition-all shadow-sm w-full sm:w-auto"
              onClick={() => openPicker(startInputRef)}
            >
              <CalendarDays size={18} className="text-emerald-600 shrink-0" />
              <div className="flex flex-col flex-1">
                <span className="text-[9px] font-black text-gray-400 uppercase leading-none mb-0.5">
                  De
                </span>
                <input
                  ref={startInputRef}
                  type="date"
                  style={{ colorScheme: "light" }}
                  className="bg-transparent text-[10px] font-black text-gray-800 outline-none w-full sm:w-[100px] uppercase cursor-pointer"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
            </div>
            <span className="hidden sm:inline text-[9px] font-black text-gray-300">
              →
            </span>
            <div
              className="flex items-center gap-3 px-3 py-2 bg-white rounded-xl border-2 border-transparent cursor-pointer hover:border-emerald-500 transition-all shadow-sm w-full sm:w-auto"
              onClick={() => openPicker(endInputRef)}
            >
              <CalendarDays size={18} className="text-emerald-600 shrink-0" />
              <div className="flex flex-col flex-1">
                <span className="text-[9px] font-black text-gray-400 uppercase leading-none mb-0.5">
                  Até
                </span>
                <input
                  ref={endInputRef}
                  type="date"
                  style={{ colorScheme: "light" }}
                  className="bg-transparent text-[10px] font-black text-gray-800 outline-none w-full sm:w-[100px] uppercase cursor-pointer"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
            {(startDate || endDate) && (
              <button
                onClick={() => {
                  setStartDate("");
                  setEndDate("");
                }}
                className="p-2.5 bg-red-50 text-red-500 hover:bg-red-100 rounded-xl transition-all border border-red-100 w-full sm:w-auto flex justify-center"
              >
                <X size={18} />
              </button>
            )}
          </div>

          <div className="relative group flex-1 md:w-64">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-emerald-500 transition-colors"
              size={18}
            />
            <input
              type="text"
              placeholder="Buscar cliente ou ID..."
              className="w-full pl-12 pr-4 py-3 bg-gray-50 border-2 border-transparent rounded-2xl outline-none focus:bg-white focus:border-emerald-500 transition-all font-bold text-sm text-gray-900"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap bg-white p-2 rounded-3xl border border-gray-100 shadow-sm gap-2 w-full max-w-full">
        {(
          ["all", "pending", "confirmed", "dispatched", "cancelled"] as const
        ).map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status as any)}
            className={`flex-1 sm:flex-none px-4 md:px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap border-2 text-center flex justify-center ${statusFilter === status ? "bg-emerald-600 border-emerald-600 text-white shadow-lg" : "bg-transparent border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-50"}`}
          >
            {status === "all"
              ? "Ver Todos"
              : status === "pending"
                ? "Pendentes"
                : status === "confirmed"
                  ? "Confirmados"
                  : status === "dispatched"
                    ? "Enviados"
                    : "Cancelados"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 pb-10">
        {filteredOrders.length > 0 ? (
          filteredOrders.map((order) => {
            const isPendingLongTime =
              order.status === "pending" &&
              new Date().getTime() - new Date(order.date).getTime() >
                30 * 60 * 1000;

            return (
              <div
                key={order.id}
                className={`bg-white p-6 rounded-[2.5rem] shadow-sm border ${isPendingLongTime ? "border-red-300 bg-red-50/20" : "border-gray-100"} hover:shadow-xl transition-all group overflow-hidden`}
              >
                <div className="flex flex-col lg:flex-row justify-between gap-6">
                  <div className="flex-1 space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest bg-gray-50 px-2 py-1 rounded-md">
                        ID: {order.id}
                      </span>
                      <span className="text-[10px] font-bold text-gray-400">
                        {safeDate(order.date)}
                      </span>
                      {getStatusBadge(order.status)}
                      {isPendingLongTime && (
                        <span className="text-[10px] font-black text-red-600 bg-red-100 px-2 py-1 rounded-md flex items-center gap-1">
                          <AlertTriangle size={12} /> Pendente há muito tempo
                        </span>
                      )}
                    </div>

                    <div>
                      <h3 className="text-xl font-black text-gray-900">
                        {order.customer?.name || "Cliente sem nome"}
                      </h3>
                      <div className="flex items-center gap-2 text-emerald-600 text-xs font-black mt-1">
                        <Phone size={14} /> {order.customer?.phone || "-"}
                      </div>
                    </div>

                    <div className="bg-gray-50/80 p-4 rounded-2xl border border-gray-100 flex items-start gap-3">
                      <div className="p-2 bg-white rounded-xl text-gray-400 shadow-sm border border-gray-50">
                        <MapPin size={16} />
                      </div>
                      <p className="text-sm text-gray-700 font-bold leading-relaxed">
                        {order.customer?.address || "Endereço não informado"},{" "}
                        {order.customer?.addressNumber || "S/N"}
                        <br />
                        {order.customer?.neighborhood || "-"} —{" "}
                        {order.customer?.city || "-"}
                      </p>
                    </div>
                    {order.observation && (
                      <div className="bg-yellow-50 p-3 rounded-xl border border-yellow-100 text-xs text-yellow-800 font-medium flex items-start gap-2">
                        <FileText size={14} className="mt-0.5 shrink-0" />{" "}
                        {order.observation}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setViewingOrder(order)}
                        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2 active:scale-95"
                      >
                        <Eye size={14} /> Ver Detalhes
                      </button>
                      <button
                        onClick={() => handleEditClick(order)}
                        className="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2 active:scale-95 border border-blue-100"
                      >
                        <Edit3 size={14} /> Editar
                      </button>
                      <button
                        onClick={() => onDeleteOrder(order.id)}
                        className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2 active:scale-95 border border-red-100"
                      >
                        <Trash2 size={14} /> Excluir
                      </button>

                      {isPendingLongTime && order.customer?.phone && (
                        <a
                          href={`https://wa.me/55${order.customer.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Olá ${order.customer.name}, vimos que você iniciou um pedido de ${order.items[0]?.name}${order.items.length > 1 ? " e outros itens" : ""}. Teve alguma dúvida com o PIX? Posso te ajudar?`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2 active:scale-95 shadow-sm"
                        >
                          <Phone size={14} /> Recuperar Venda (WhatsApp)
                        </a>
                      )}

                      {order.status === "dispatched" &&
                        order.customer?.phone && (
                          <button
                            onClick={() =>
                              handleSendDeliveryNotification(order)
                            }
                            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2 active:scale-95 shadow-sm"
                          >
                            <span>🛵</span> Notificar Entrega (WhatsApp)
                          </button>
                        )}
                    </div>
                  </div>

                  <div className="flex flex-col justify-between items-stretch lg:items-end gap-6 lg:min-w-[320px]">
                    <div className="text-left lg:text-right bg-emerald-50/30 p-4 rounded-3xl border border-emerald-50/50">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">
                        Total do Pedido
                      </p>
                      <p className="text-3xl font-black text-emerald-600 tracking-tight">
                        R$ {(order.total || 0).toFixed(2)}
                      </p>
                      <div className="flex items-center lg:justify-end gap-2 text-[10px] text-gray-500 font-black uppercase mt-1">
                        <span className="bg-white px-2 py-0.5 rounded-md border border-gray-100">
                          {(order.items || []).length} ITENS
                        </span>
                        <span className="bg-white px-2 py-0.5 rounded-md border border-gray-100">
                          {order.customer?.paymentMethod || "PIX"}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-3 justify-end w-full">
                      {(order.status === "pending" || order.status === "confirmed" || order.status === "erro_integracao_pdv") && !isDelivererMode && (
                        <button
                          onClick={() => handleSendToPDV(order)}
                          disabled={sendingToPDV === order.id}
                          className="w-full sm:w-auto px-6 py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2"
                        >
                          {sendingToPDV === order.id ? (
                            <span className="flex items-center gap-2">
                              <span className="animate-spin border-2 border-white border-t-transparent rounded-full w-4 h-4"></span>
                              Enviando...
                            </span>
                          ) : (
                            <>
                              <Upload size={16} /> Enviar para PDV
                            </>
                          )}
                        </button>
                      )}

                      {order.status === "confirmed" ? (
                        <button
                          onClick={() => setConferenceOrder(order)}
                          className="w-full sm:w-auto px-6 py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2"
                        >
                          <Package size={16} /> Iniciar Conferência
                        </button>
                      ) : isDelivererMode ? (
                        <div className="flex-1 sm:flex-none py-4 px-6 bg-gray-100 text-gray-400 font-bold text-center rounded-2xl flex items-center justify-center text-[13px] tracking-wide">
                          Somente Leitura
                        </div>
                      ) : (
                        <div className="relative w-full sm:w-auto flex-1 sm:flex-none">
                          <select
                            value={order.status}
                            onChange={(e) =>
                              handleStatusChangeWrapper(
                                order,
                                e.target.value as OrderStatus,
                              )
                            }
                            className="appearance-none bg-gray-900 text-white pl-5 pr-12 py-4 rounded-2xl text-[11px] font-black uppercase tracking-widest cursor-pointer hover:bg-gray-800 transition-all w-full outline-none border border-gray-700 active:scale-95 shadow-lg shadow-gray-200"
                          >
                            <option value="pending">Marcar: Pendente</option>
                            <option value="confirmed">Confirmar Pedido</option>
                            {order.status === "enviado_ao_pdv" && (
                              <option value="enviado_ao_pdv">Enviado ao PDV</option>
                            )}
                            {order.status === "impresso_no_pdv" && (
                              <option value="impresso_no_pdv">Impresso no PDV</option>
                            )}
                            {order.status === "concluido_no_pdv" && (
                              <option value="concluido_no_pdv">Concluído no PDV</option>
                            )}
                            {order.status === "erro_integracao_pdv" && (
                              <option value="erro_integracao_pdv">Erro Integração PDV</option>
                            )}
                            <option value="dispatched">
                              Em Rota (Enviado)
                            </option>
                            <option value="cancelled">Cancelar Pedido</option>
                          </select>
                          <ChevronDown
                            size={16}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 pointer-events-none"
                          />
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2 justify-between sm:justify-end w-full sm:w-auto mt-4 sm:mt-0">
                        {order.receiptFile ? (
                          <a
                            href={order.receiptFile}
                            target="_blank"
                            rel="noreferrer"
                            className="flex-1 sm:flex-none p-4 bg-blue-50 border border-blue-200 text-blue-600 rounded-2xl hover:bg-blue-100 transition-all shadow-sm active:scale-90 flex justify-center"
                            title="Ver Comprovante"
                          >
                            <FileText size={20} />
                          </a>
                        ) : (
                          <label
                            className="flex-1 sm:flex-none p-4 bg-white border border-gray-200 text-gray-600 rounded-2xl hover:bg-gray-50 hover:text-gray-900 transition-all shadow-sm active:scale-90 cursor-pointer flex justify-center"
                            title="Anexar Comprovante"
                          >
                            <Upload size={20} />
                            <input
                              type="file"
                              className="hidden"
                              accept="image/*,.pdf"
                              onChange={(e) => handleReceiptUpload(e, order)}
                            />
                          </label>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            handleGenerateDocument(order, "ORÇAMENTO")
                          }
                          className="flex-1 sm:flex-none p-4 bg-white border border-gray-200 text-orange-600 rounded-2xl hover:bg-orange-50 hover:text-orange-700 transition-all shadow-sm active:scale-90 flex justify-center"
                          title="Emitir Orçamento"
                        >
                          <ClipboardList size={20} />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleGenerateDocument(order, "RECIBO")
                          }
                          className="flex-1 sm:flex-none p-4 bg-white border border-gray-200 text-gray-600 rounded-2xl hover:bg-gray-50 hover:text-gray-900 transition-all shadow-sm active:scale-90 flex justify-center"
                          title="Emitir Recibo"
                        >
                          <Printer size={20} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewingOrder(order)}
                          className="flex-1 sm:flex-none p-4 bg-white border border-gray-200 text-gray-600 rounded-2xl hover:bg-blue-50 hover:text-blue-600 transition-all shadow-sm active:scale-90 flex justify-center"
                          title="Ver Detalhes"
                        >
                          <Eye size={20} />
                        </button>
                        {!isDelivererMode && (
                          <button
                            type="button"
                            onClick={() => handleEditClick(order)}
                            className="flex-1 sm:flex-none p-4 bg-white border border-gray-200 text-gray-600 rounded-2xl hover:bg-amber-50 hover:text-amber-600 transition-all shadow-sm active:scale-90 flex justify-center"
                            title="Editar Pedido"
                          >
                            <Edit3 size={20} />
                          </button>
                        )}
                        {!isDelivererMode && (
                          <button
                            type="button"
                            onClick={() => handleDeleteClick(order.id)}
                            className="flex-1 sm:flex-none p-4 bg-white border border-gray-200 text-red-400 rounded-2xl hover:bg-red-50 hover:text-red-600 transition-all shadow-sm active:scale-90 flex justify-center"
                            title="Excluir"
                          >
                            <Trash2 size={20} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="bg-white p-20 rounded-[3rem] text-center border-2 border-dashed border-gray-100">
            <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <Archive size={40} className="text-gray-200" />
            </div>
            <p className="text-gray-400 font-bold">
              Nenhum pedido encontrado com estes filtros.
            </p>
          </div>
        )}
      </div>

      {showCleanupModal && (
        <div className="fixed inset-0 z-[100] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md mx-auto rounded-[3rem] shadow-2xl p-10 animate-in zoom-in-95">
            <div className="flex flex-col items-center text-center space-y-6">
              <div className="w-24 h-24 bg-red-50 rounded-full flex items-center justify-center animate-bounce">
                <Trash2 size={48} className="text-red-500" />
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-black text-gray-900">
                  Limpeza de Arquivo
                </h3>
                <p className="text-gray-500 font-medium">
                  Você tem {oldOrdersCount} pedidos antigos.
                </p>
              </div>
              <button
                onClick={confirmCleanup}
                className="w-full py-5 bg-red-600 text-white rounded-[2rem] font-black shadow-xl"
              >
                Confirmar Exclusão
              </button>
              <button
                onClick={() => setShowCleanupModal(false)}
                className="text-gray-400 font-bold"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTargetId && (
        <div className="fixed inset-0 z-[100] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6">
          <div className="bg-white w-full max-w-sm mx-auto rounded-[2.5rem] p-8 shadow-2xl animate-in zoom-in-95 text-center">
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <Trash2 size={32} />
            </div>
            <h3 className="text-xl font-black text-gray-900 mb-2">
              Excluir Pedido?
            </h3>
            <p className="text-gray-500 text-sm font-medium mb-8">
              Esta ação não pode ser desfeita.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setDeleteTargetId(null)}
                className="py-4 bg-gray-50 text-gray-500 rounded-2xl font-bold hover:bg-gray-100"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDelete}
                className="py-4 bg-red-600 text-white rounded-2xl font-black shadow-lg"
              >
                Sim, Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {viewingOrder && (
        <div className="fixed inset-0 z-[100] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6">
          <div className="bg-white w-full max-w-lg sm:max-w-2xl mx-auto max-h-[90vh] rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95">
            <div className="p-6 border-b flex justify-between items-center bg-gray-50 shrink-0">
              <div>
                <h3 className="text-xl font-black text-gray-900">
                  Detalhes do Pedido
                </h3>
                <p className="text-xs text-gray-500 font-bold">
                  ID: {viewingOrder.id}
                </p>
              </div>
              <button
                onClick={() => setViewingOrder(null)}
                className="p-2 bg-white rounded-full text-gray-500 hover:text-red-500 shadow-sm"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto overflow-x-hidden flex-1 space-y-6 scrollbar-thin">
              <div className="bg-emerald-50/50 p-6 rounded-3xl border border-emerald-100 space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center shrink-0">
                    <User size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-black text-gray-900 truncate">
                      {viewingOrder.customer?.name}
                    </h4>
                    <p className="text-xs text-gray-500 font-bold truncate">
                      {viewingOrder.customer?.phone}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <MapPin
                    size={16}
                    className="text-emerald-500 mt-1 shrink-0"
                  />
                  <p className="text-sm text-gray-700 font-medium leading-relaxed min-w-0 flex-1 break-words">
                    {viewingOrder.customer?.address},{" "}
                    {viewingOrder.customer?.addressNumber || "S/N"}
                    <br />
                    {viewingOrder.customer?.neighborhood} —{" "}
                    {viewingOrder.customer?.city}
                  </p>
                </div>
              </div>

              {viewingOrder.observation && (
                <div className="bg-yellow-50 p-4 rounded-2xl border border-yellow-100">
                  <p className="text-[10px] font-black uppercase text-yellow-600 mb-1">
                    Observações
                  </p>
                  <p className="text-sm font-bold text-yellow-900">
                    {viewingOrder.observation}
                  </p>
                </div>
              )}

              <div>
                <h4 className="font-black text-gray-900 mb-4 flex items-center gap-2">
                  <Package size={18} className="text-gray-400" /> Itens do
                  Pedido
                </h4>
                <div className="space-y-3">
                  {(viewingOrder.items || []).map((item, idx) => (
                    <div
                      key={item.id || idx}
                      className="flex items-center gap-4 p-3 rounded-2xl border border-gray-100 bg-white"
                    >
                      <div className="w-12 h-12 bg-gray-50 rounded-xl overflow-hidden shrink-0">
                        {item.image ? (
                          <img
                            src={item.image}
                            className="w-full h-full object-cover"
                            alt={item.name}
                            referrerPolicy="no-referrer"
                            loading="lazy"
                          />
                        ) : (
                          <Package className="w-full h-full p-3 text-gray-300" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-gray-900 text-sm line-clamp-1">
                          {item.name}
                        </p>
                        <p className="text-[10px] text-gray-400 font-bold">
                          {item.quantity}x R$ {(item.price || 0).toFixed(2)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-black text-gray-900 text-sm">
                          R$ {calculateItemTotal(item, promotions, matrizProducts, tenant?.id, viewingOrder.items).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="p-6 pb-8 sm:pb-6 border-t bg-gray-50 flex flex-wrap gap-4 justify-between items-center shrink-0">
              <div>
                <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">
                  Total
                </p>
                <p className="text-2xl font-black text-emerald-600">
                  R$ {(viewingOrder.total || 0).toFixed(2)}
                </p>
                {viewingOrder.appliedCoupon && (
                  <p className="text-[10px] text-emerald-500 font-bold mt-1">
                    Cupom: {viewingOrder.appliedCoupon}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end">
                <span className="text-[10px] font-bold text-gray-500 uppercase">
                  {viewingOrder.customer?.paymentMethod}
                </span>
                {viewingOrder.customer?.changeFor && (
                  <span className="text-[10px] text-gray-400">
                    Troco para: {viewingOrder.customer.changeFor}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {editingOrder && (
        <div className="fixed inset-0 z-[100] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6">
          <div className="bg-white w-full max-w-lg sm:max-w-3xl mx-auto max-h-[90vh] rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95">
            <div className="p-6 border-b flex justify-between items-center bg-gray-50 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-amber-100 text-amber-600 rounded-xl">
                  <Edit3 size={20} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-gray-900">
                    Editar Pedido
                  </h3>
                  <p className="text-xs text-gray-500 font-bold">
                    ID: {editingOrder.id}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setEditingOrder(null)}
                className="p-2 bg-white rounded-full text-gray-500 hover:text-red-500 shadow-sm"
              >
                <X size={20} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-4 sm:p-8 space-y-8 scrollbar-thin overflow-x-hidden">
              <div className="space-y-4">
                <h4 className="text-sm font-black uppercase text-gray-400 tracking-widest flex items-center gap-2">
                  <User size={16} /> Dados do Cliente
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-black uppercase text-gray-400 tracking-widest pl-1">
                      Nome
                    </label>
                    <input
                      className="w-full bg-gray-50 border-2 border-transparent focus:bg-white focus:border-brand rounded-xl p-3 outline-none font-bold text-gray-800 transition-all"
                      value={editingOrder.customer?.name || ""}
                      onChange={(e) =>
                        setEditingOrder({
                          ...editingOrder,
                          customer: {
                            ...editingOrder.customer,
                            name: e.target.value,
                          },
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-gray-400 tracking-widest pl-1">
                      Telefone
                    </label>
                    <input
                      className="w-full bg-gray-50 border-2 border-transparent focus:bg-white focus:border-brand rounded-xl p-3 outline-none font-bold text-gray-800 transition-all"
                      value={editingOrder.customer?.phone || ""}
                      onChange={(e) =>
                        setEditingOrder({
                          ...editingOrder,
                          customer: {
                            ...editingOrder.customer,
                            phone: e.target.value,
                          },
                        })
                      }
                    />
                  </div>
                  <div className="md:col-span-2 grid grid-cols-4 gap-2">
                    <div className="col-span-3">
                      <label className="text-[10px] font-black uppercase text-gray-400 tracking-widest pl-1">
                        Endereço
                      </label>
                      <input
                        className="w-full bg-gray-50 border-2 border-transparent focus:bg-white focus:border-brand rounded-xl p-3 outline-none font-bold text-gray-800 transition-all"
                        value={editingOrder.customer?.address || ""}
                        onChange={(e) =>
                          setEditingOrder({
                            ...editingOrder,
                            customer: {
                              ...editingOrder.customer,
                              address: e.target.value,
                            },
                          })
                        }
                      />
                    </div>
                    <div className="col-span-1">
                      <label className="text-[10px] font-black uppercase text-gray-400 tracking-widest pl-1">
                        Nº
                      </label>
                      <input
                        className="w-full bg-gray-50 border-2 border-transparent focus:bg-white focus:border-brand rounded-xl p-3 outline-none font-bold text-gray-800 transition-all text-center"
                        value={editingOrder.customer?.addressNumber || ""}
                        onChange={(e) =>
                          setEditingOrder({
                            ...editingOrder,
                            customer: {
                              ...editingOrder.customer,
                              addressNumber: e.target.value,
                            },
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-100 my-4"></div>

              <div className="space-y-4">
                <h4 className="text-sm font-black uppercase text-gray-400 tracking-widest flex items-center gap-2">
                  <Package size={16} /> Itens do Pedido
                </h4>

                <div className="space-y-3">
                  {(editingOrder.items || []).map((item, idx) => {
                    const productInStore = products.find(
                      (p) => p.id === item.id,
                    );
                    const originalOrder = orders.find(
                      (o) => o.id === editingOrder.id,
                    );
                    const originalItem = originalOrder?.items.find(
                      (i) => i.id === item.id,
                    );
                    const originalQty = originalItem?.quantity || 0;

                    return (
                      <div
                        key={item.id || idx}
                        className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm relative overflow-hidden group"
                      >
                        <div className="flex gap-4">
                          <div className="w-16 h-16 bg-gray-50 rounded-xl overflow-hidden shrink-0 border border-gray-50">
                            {item.image ? (
                              <img
                                src={item.image}
                                className="w-full h-full object-cover"
                                alt={item.name}
                                referrerPolicy="no-referrer"
                                loading="lazy"
                              />
                            ) : (
                              <Package className="w-full h-full p-4 text-gray-300" />
                            )}
                          </div>

                          <div className="flex-1 min-w-0 pr-8">
                            <p className="font-black text-gray-900 text-sm leading-tight line-clamp-2 mb-1.5">
                              {item.name || "Produto sem nome"}
                            </p>
                            <div className="flex flex-wrap items-center gap-3">
                              {item.internalCode && (
                                <span className="text-[9px] font-black text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200 uppercase tracking-wide">
                                  Ref: {item.internalCode}
                                </span>
                              )}
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">
                                  Valor Unit.
                                </span>
                                <div className="relative group/price">
                                  <DollarSign
                                    size={10}
                                    className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 z-10"
                                  />
                                  <SmartNumberInput
                                    isFloat={true}
                                    className="w-24 bg-gray-50 border border-gray-200 rounded-lg pl-5 pr-2 py-1 text-[11px] font-black text-gray-900 outline-none focus:border-emerald-500 focus:bg-white transition-all relative z-0"
                                    value={
                                      Number.isNaN(item.price)
                                        ? ""
                                        : (item.price ?? "")
                                    }
                                    onChangeValue={(val) =>
                                      updateEditingItemPrice(idx, val)
                                    }
                                  />
                                </div>
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => removeEditingItem(e, idx)}
                            className="absolute top-2 right-2 p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                            title="Remover Item"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>

                        <div className="mt-4 flex items-center justify-between border-t border-gray-50 pt-3">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1 bg-gray-50 rounded-xl p-1 border border-gray-100">
                              <button
                                type="button"
                                onClick={() => updateEditingItemQty(idx, -1)}
                                className="w-8 h-8 flex items-center justify-center bg-white rounded-lg shadow-sm text-gray-600 hover:text-red-500 active:scale-95 transition-all border border-gray-100"
                              >
                                <Minus size={14} strokeWidth={3} />
                              </button>
                              <span className="font-black text-sm text-gray-900 w-8 text-center">
                                {item.quantity}
                              </span>
                              <button
                                type="button"
                                onClick={() => updateEditingItemQty(idx, 1)}
                                className="w-8 h-8 flex items-center justify-center rounded-lg shadow-sm active:scale-95 transition-all bg-gray-900 text-white hover:bg-emerald-600"
                              >
                                <Plus size={14} strokeWidth={3} />
                              </button>
                            </div>
                          </div>

                          <div className="text-right">
                            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                              Subtotal
                            </p>
                            <p className="font-black text-emerald-600 text-lg tracking-tight">
                              R${" "}
                              {calculateItemTotal(item, promotions, matrizProducts, tenant?.id, editingOrder.items).toFixed(2)}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-col items-end pt-2 space-y-2">
                  {editingOrder.appliedCoupon && (
                    <div className="text-right">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                        Desconto do Cupom ({editingOrder.appliedCoupon})
                      </p>
                      <p className="text-sm font-black text-emerald-500">
                        - R$ {(editingOrder.couponDiscount || 0).toFixed(2)}
                      </p>
                    </div>
                  )}
                  <div className="text-right">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                      Novo Total
                    </p>
                    <p className="text-2xl font-black text-emerald-600">
                      R$ {(editingOrder.total || 0).toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-100 my-4"></div>

              <div className="space-y-2">
                <h4 className="text-sm font-black uppercase text-gray-400 tracking-widest flex items-center gap-2">
                  <FileText size={16} /> Observações
                </h4>
                <textarea
                  rows={3}
                  className="w-full bg-yellow-50 border-2 border-yellow-100 focus:border-yellow-400 rounded-2xl p-4 outline-none font-medium text-yellow-900 resize-none text-sm placeholder:text-yellow-700/50"
                  placeholder="Adicione notas internas sobre o pedido..."
                  value={editingOrder.observation || ""}
                  onChange={(e) =>
                    setEditingOrder({
                      ...editingOrder,
                      observation: e.target.value,
                    })
                  }
                />
              </div>
            </div>

            <div className="p-6 pb-8 sm:pb-6 border-t bg-gray-50 grid grid-cols-2 gap-4 shrink-0">
              <button
                type="button"
                onClick={() => setEditingOrder(null)}
                className="py-4 rounded-2xl font-bold text-gray-500 bg-white border border-gray-200 hover:bg-gray-100 transition-all text-sm sm:text-base"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="py-4 rounded-2xl font-black text-white bg-emerald-600 shadow-lg shadow-emerald-200 active:scale-95 transition-all flex items-center justify-center gap-2 text-sm sm:text-base"
              >
                <Save size={18} className="hidden sm:inline-block" /> Salvar
                Alterações
              </button>
            </div>
          </div>
        </div>
      )}

      {conferenceOrder && (
        <OrderConferenceModal
          order={conferenceOrder}
          tenantPassword={tenant?.admin_password}
          onClose={() => setConferenceOrder(null)}
          onConfirmDispatch={async () => {
            onUpdateOrderCustomer(conferenceOrder.id, {
              status: "dispatched",
              observation: `${conferenceOrder.observation || ""}\n[LOG SISTEMA]: Baixa física confirmada e validada via bipagem de todos os itens.`,
            });
            executeWhatsAppTrigger(conferenceOrder);
            setConferenceOrder(null);
          }}
          onDeductInstantly={async (productId, qty) => {
            const product = products.find((p) => p.id === productId);
            if (!product) {
              return {
                success: false,
                message: `Erro na baixa: Produto não encontrado com ID: ${productId}`,
              };
            }
            const currentStock = Number(product.stock) || 0;
            if (currentStock < qty) {
              return {
                success: false,
                message: `Erro na baixa: Estoque atual (${currentStock}) é menor que o solicitado (${qty}) para o produto: ${product.name}`,
              };
            }

            const updatedProd = { ...product, stock: currentStock - qty };
            const newProducts = products.map((p) =>
              p.id === updatedProd.id ? updatedProd : p,
            );
            if (onProductsStateUpdate) onProductsStateUpdate(newProducts);

            // Salvar de imediato no backend
            if (tenant) {
              try {
                const { saveProductsByTenant } =
                  await import("../services/storage");
                await saveProductsByTenant(tenant.id, [updatedProd]);
              } catch (e) {
                console.error("Falha ao persistir a baixa instantânea", e);
              }
            }
            return { success: true };
          }}
          onRevertInstantly={async (scannedItems) => {
            if (!tenant) return;
            const stockChanges: Product[] = [];
            let nextProducts = [...products];

            for (const [id, count] of Object.entries(scannedItems)) {
              if (count > 0) {
                const product = nextProducts.find((p) => p.id === id);
                if (product) {
                  const updatedProd = {
                    ...product,
                    stock: product.stock + count,
                  };
                  stockChanges.push(updatedProd);
                  nextProducts = nextProducts.map((p) =>
                    p.id === updatedProd.id ? updatedProd : p,
                  );
                }
              }
            }

            if (stockChanges.length > 0) {
              if (onProductsStateUpdate) onProductsStateUpdate(nextProducts);
              try {
                const { saveProductsByTenant } =
                  await import("../services/storage");
                await saveProductsByTenant(tenant.id, stockChanges);
              } catch (e) {
                console.error("Falha ao reverter estoque no backend", e);
              }
            }
          }}
        />
      )}
    </div>
  );
};
