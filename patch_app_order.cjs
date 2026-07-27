const fs = require('fs');
let code = fs.readFileSync('App.tsx', 'utf8');

const orderBlockOld = `      const newOrder: Order = {
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
      };`;

const orderBlockNew = `      const newOrder: Order = {
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
      };`;
code = code.replace(orderBlockOld, orderBlockNew);

const whatsappMsgOld = `      if (customer.address) {
        msg += \`*📍 ENTREGA*\\n\`;
        msg += \`\${customer.address}, \${customer.addressNumber}\\n\`;
        if (customer.complement) msg += \`*Comp:* \${customer.complement}\\n\`;
        msg += \`\${customer.neighborhood} - \${customer.city}\\n\`;
        if (customer.locationUrl)
          msg += \`\\n🗺️ *Ver no Mapa:*\\n\${customer.locationUrl}\\n\`;
        msg += \`\\n────────────────\\n\`;
      }`;

const whatsappMsgNew = `      if (deliveryMode === 'pickup') {
        msg += \`*📍 RETIRADA NA LOJA*\\n\`;
        msg += \`O cliente irá retirar o pedido no balcão.\\n\`;
        msg += \`\\n────────────────\\n\`;
      } else if (customer.address) {
        msg += \`*📍 ENTREGA*\\n\`;
        msg += \`\${customer.address}, \${customer.addressNumber}\\n\`;
        if (customer.complement) msg += \`*Comp:* \${customer.complement}\\n\`;
        msg += \`\${customer.neighborhood} - \${customer.city}\\n\`;
        if (customer.locationUrl)
          msg += \`\\n🗺️ *Ver no Mapa:*\\n\${customer.locationUrl}\\n\`;
        msg += \`\\n────────────────\\n\`;
      }`;
code = code.replace(whatsappMsgOld, whatsappMsgNew);

fs.writeFileSync('App.tsx', code);
