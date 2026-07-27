const fs = require('fs');
let code = fs.readFileSync('services/storage.ts', 'utf8');

code = code.replace(
  '  appliedCoupon: o.applied_coupon || o.appliedCoupon || undefined,',
  '  appliedCoupon: o.applied_coupon || o.appliedCoupon || undefined,\n  deliveryMode: o.delivery_mode || o.deliveryMode || "delivery",'
);

code = code.replace(
  '      applied_coupon: order.appliedCoupon,',
  '      applied_coupon: order.appliedCoupon,\n      delivery_mode: order.deliveryMode || "delivery",'
);

fs.writeFileSync('services/storage.ts', code);
