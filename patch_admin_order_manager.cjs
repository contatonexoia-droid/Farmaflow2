const fs = require('fs');
let code = fs.readFileSync('components/AdminOrderManager.tsx', 'utf8');

const targetStr = `{isPendingLongTime && (
                        <span className="text-[10px] font-black text-red-600 bg-red-100 px-2 py-1 rounded-md flex items-center gap-1">
                          <AlertTriangle size={12} /> Pendente há muito tempo
                        </span>
                      )}`;

const newStr = `{isPendingLongTime && (
                        <span className="text-[10px] font-black text-red-600 bg-red-100 px-2 py-1 rounded-md flex items-center gap-1">
                          <AlertTriangle size={12} /> Pendente há muito tempo
                        </span>
                      )}
                      
                      {order.prescriptionStatus === "PENDING" && (
                        <span className="text-[10px] font-black text-amber-700 bg-amber-100 px-2 py-1 rounded-md flex items-center gap-1 border border-amber-200">
                          Receita em análise
                        </span>
                      )}
                      {order.prescriptionStatus === "APPROVED" && (
                        <span className="text-[10px] font-black text-emerald-700 bg-emerald-100 px-2 py-1 rounded-md flex items-center gap-1 border border-emerald-200">
                          Receita Aprovada
                        </span>
                      )}
                      {order.prescriptionStatus === "REJECTED" && (
                        <span className="text-[10px] font-black text-red-700 bg-red-100 px-2 py-1 rounded-md flex items-center gap-1 border border-red-200">
                          Receita Reprovada
                        </span>
                      )}`;

code = code.replace(targetStr, newStr);
fs.writeFileSync('components/AdminOrderManager.tsx', code);
