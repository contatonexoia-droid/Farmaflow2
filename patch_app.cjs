const fs = require('fs');
let code = fs.readFileSync('App.tsx', 'utf8');

code = code.replace(
  'calculatedDeliveryFee: number = 0,\n  ) => {',
  'calculatedDeliveryFee: number = 0,\n    deliveryMode: "delivery" | "pickup" = "delivery",\n  ) => {'
);

code = code.replace(
  '        customer,\n        total: validatedTotal,',
  '        customer,\n        total: validatedTotal,\n        deliveryMode,'
);

fs.writeFileSync('App.tsx', code);
