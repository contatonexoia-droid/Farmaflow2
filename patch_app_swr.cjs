const fs = require('fs');
let code = fs.readFileSync('App.tsx', 'utf8');

const importTarget = 'import { useState, useEffect, useMemo, useRef } from "react";';
if (!code.includes(importTarget)) {
  console.error("Could not find import React");
}
code = code.replace(importTarget, importTarget + '\nimport useSWR, { mutate } from "swr";');

const hookTarget = 'const [orders, setOrders] = useState<Order[]>([]);';
const newHook = `const [orders, setOrders] = useState<Order[]>([]);
  useSWR(currentTenant ? \`orders-trigger-\${currentTenant.id}\` : null, async () => {
    const ords = await getOrdersByTenant(currentTenant.id);
    setOrders(ords);
    return true;
  });`;
code = code.replace(hookTarget, newHook);

fs.writeFileSync('App.tsx', code);
