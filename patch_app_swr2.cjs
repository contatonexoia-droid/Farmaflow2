const fs = require('fs');
let code = fs.readFileSync('App.tsx', 'utf8');

const importTarget = 'import React, {';
const newImport = 'import useSWR from "swr";\nimport React, {';
code = code.replace(importTarget, newImport);

const hookTarget = 'const [orders, setOrders] = useState<Order[]>([]);';
const newHook = `const [orders, setOrders] = useState<Order[]>([]);
  useSWR(currentTenant ? \`orders-trigger-\${currentTenant.id}\` : null, async () => {
    const ords = await getOrdersByTenant(currentTenant.id);
    setOrders(ords);
    return true;
  });`;
code = code.replace(hookTarget, newHook);

fs.writeFileSync('App.tsx', code);
