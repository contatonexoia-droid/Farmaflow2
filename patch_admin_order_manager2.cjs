const fs = require('fs');
let code = fs.readFileSync('components/AdminOrderManager.tsx', 'utf8');

const targetClassStr = 'className={`bg-white p-6 rounded-[2.5rem] shadow-sm border ${isPendingLongTime ? "border-red-300 bg-red-50/20" : "border-gray-100"} hover:shadow-xl transition-all group overflow-hidden`}';

const newClassStr = 'className={`bg-white p-6 rounded-[2.5rem] shadow-sm border ${order.prescriptionStatus === "REJECTED" ? "border-red-500 bg-red-50 opacity-80" : isPendingLongTime ? "border-red-300 bg-red-50/20" : "border-gray-100"} hover:shadow-xl transition-all group overflow-hidden`}';

code = code.replace(targetClassStr, newClassStr);
fs.writeFileSync('components/AdminOrderManager.tsx', code);
