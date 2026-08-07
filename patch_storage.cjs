const fs = require('fs');

let content = fs.readFileSync('services/storage.ts', 'utf8');

const replacement = `
const getAuthHeaders = (tenantId: string) => {
  let token = '';
  try {
    if (typeof window !== 'undefined') {
        const saved = window.localStorage.getItem('ff_session');
        if (saved) {
          const parsed = JSON.parse(saved);
          token = parsed.access_token;
        }
    }
  } catch (e) {}
  return {
    'Content-Type': 'application/json',
    'x-tenant-id': tenantId,
    ...(token ? { 'Authorization': \`Bearer \${token}\` } : {})
  };
};

export const getPromotionsByTenant = async (
  tenantId: string,
  networkId?: string,
): Promise<PromotionRule[]> => {
  try {
    const query = networkId ? \`?networkId=\${networkId}\` : '';
    const res = await fetch(\`/api/v1/tenants/\${tenantId}/promos\${query}\`);
    if (!res.ok) throw new Error("Failed to fetch promos");
    const data = await res.json();
    return (data || []).map(mapDbPromotionToApp);
  } catch (e: any) {
    handleNetworkError(e, "Promoções");
    return [];
  }
};

export const savePromotion = async (promotion: PromotionRule) => {
  try {
    const payload: any = {
      id: promotion.id,
      tenant_id: promotion.tenantId,
      name: promotion.name,
      type: promotion.type,
      target_type: promotion.targetType,
      target_value: promotion.targetValue,
      buy_x: promotion.buyX,
      pay_y: promotion.payY,
      lightning_discount_percentage: promotion.lightningDiscountPercentage,
      discount_thresholds: promotion.discountThresholds,
      combo_products: promotion.comboProducts,
      combo_discount_percentage: promotion.comboDiscountPercentage,
      specific_product_ids: promotion.specificProductIds,
      filters_metadata: {
        ...(promotion.filtersMetadata || {}),
        highlightInCategoriesBar: promotion.highlightInCategoriesBar,
        highlightColor: promotion.highlightColor,
        highlightIcon: promotion.highlightIcon,
        scheduleConfig: promotion.scheduleConfig,
      },
      start_date: promotion.startDate,
      end_date: promotion.endDate,
      is_active: promotion.isActive,
    };
    
    // scope is required by the backend
    payload.scope = promotion.scope || "SINGLE_STORE";
    
    const res = await fetch(\`/api/v1/tenants/\${promotion.tenantId}/promos\`, {
      method: 'POST',
      headers: getAuthHeaders(promotion.tenantId),
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text);
    }
  } catch (e: any) {
    throw new Error(handleNetworkError(e, "Salvar Promoção"));
  }
};

export const deletePromotion = async (id: string, tenantId: string) => {
  try {
    const res = await fetch(\`/api/v1/tenants/\${tenantId}/promos/\${id}\`, {
        method: 'DELETE',
        headers: getAuthHeaders(tenantId)
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text);
    }
  } catch (e: any) {
    throw new Error(handleNetworkError(e, "Excluir Promoção"));
  }
};

export const getCouponsByTenant = async (
  tenantId: string,
  networkId?: string,
): Promise<CouponRule[]> => {
  try {
    const query = networkId ? \`?networkId=\${networkId}\` : '';
    const res = await fetch(\`/api/v1/tenants/\${tenantId}/vouchers\${query}\`);
    if (!res.ok) throw new Error("Failed to fetch coupons");
    const data = await res.json();
    return (data || []).map(mapCouponFromDB);
  } catch (e: any) {
    console.error("Error fetching coupons:", e);
    return [];
  }
};

export const saveCoupon = async (coupon: CouponRule) => {
  try {
    const dbCoupon: any = {
      id: coupon.id,
      tenant_id: coupon.tenantId,
      code: coupon.code,
      discount_type: coupon.discountType,
      discount_value: coupon.discountValue,
      coupon_scope: coupon.couponScope,
      min_purchase_value: coupon.minPurchaseValue,
      usage_limit: coupon.usageLimit,
      times_used: coupon.timesUsed,
      first_purchase_only: coupon.firstPurchaseOnly,
      applicable_products: coupon.applicableProducts,
      applicable_categories: coupon.applicableCategories,
      applicable_manufacturers: coupon.applicableManufacturers,
      start_date: coupon.startDate,
      end_date: coupon.endDate,
      is_active: coupon.isActive,
    };
    dbCoupon.scope = coupon.scope || "SINGLE_STORE";
    
    const res = await fetch(\`/api/v1/tenants/\${coupon.tenantId}/vouchers\`, {
      method: 'POST',
      headers: getAuthHeaders(coupon.tenantId),
      body: JSON.stringify(dbCoupon)
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text);
    }
  } catch (e: any) {
    throw new Error(handleNetworkError(e, "Salvar Cupom"));
  }
};

export const deleteCoupon = async (id: string, tenantId: string) => {
  try {
    const res = await fetch(\`/api/v1/tenants/\${tenantId}/vouchers/\${id}\`, {
        method: 'DELETE',
        headers: getAuthHeaders(tenantId)
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text);
    }
  } catch (e: any) {
    throw new Error(handleNetworkError(e, "Excluir Cupom"));
  }
};
`;

// Replace from getPromotionsByTenant up to end of deleteCoupon
const startIndex = content.indexOf('export const getPromotionsByTenant');
const endIndex = content.indexOf('export const saveAppReview') > -1 ? content.indexOf('export const saveAppReview') : content.length;

if (startIndex > -1 && endIndex > -1) {
    const modifiedContent = content.substring(0, startIndex) + replacement + '\n' + content.substring(endIndex);
    fs.writeFileSync('services/storage.ts', modifiedContent);
    console.log("Successfully patched storage.ts");
} else {
    console.error("Could not find bounds to replace in storage.ts");
}
