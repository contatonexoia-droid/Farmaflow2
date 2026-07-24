with open("components/AdminDashboard.tsx", "r") as f:
    content = f.read()

target = """            </div>
            
        </div>

      </div>
    </div>
  );
};"""

replacement = """            </div>
            
        </div>

      </div>

      {/* Novas Seções: Top Produtos e Top Clientes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Top Produtos */}
        <div className={`p-6 rounded-2xl border shadow-sm flex flex-col ${theme.cardBg} ${theme.cardBorder}`}>
          <div className="mb-4">
              <h3 className={`text-lg font-black flex items-center gap-2 ${theme.textPrimary}`}><Package size={18} className="text-emerald-500"/> Top Produtos</h3>
              <p className={`text-[11px] mt-1 ${theme.textSecondary}`}>Os itens mais vendidos no período selecionado</p>
          </div>
          <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className={`text-xs text-gray-500 bg-gray-50 uppercase font-black ${isDarkMode ? 'bg-gray-800' : ''}`}>
                      <tr>
                          <th className="px-4 py-3">Produto</th>
                          <th className="px-4 py-3 text-right">Qtd</th>
                          <th className="px-4 py-3 text-right">Faturamento</th>
                      </tr>
                  </thead>
                  <tbody className={`divide-y ${isDarkMode ? 'divide-gray-700' : 'divide-gray-100'}`}>
                      {topProducts.length > 0 ? topProducts.map((p, idx) => (
                          <tr key={p.id} className={`transition-colors ${isDarkMode ? 'hover:bg-gray-700/50' : 'hover:bg-gray-50'}`}>
                              <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-black text-gray-500 shrink-0">{idx + 1}</span>
                                      <span className={`font-bold text-xs truncate max-w-[200px] ${theme.textPrimary}`} title={p.name}>{p.name}</span>
                                  </div>
                              </td>
                              <td className={`px-4 py-3 text-right font-black ${theme.textSecondary}`}>{p.quantity}</td>
                              <td className="px-4 py-3 text-right font-black text-emerald-600">R$ {p.revenue.toFixed(2)}</td>
                          </tr>
                      )) : (
                          <tr>
                              <td colSpan={3} className="px-4 py-8 text-center text-gray-400 font-bold text-xs">
                                  Nenhum produto vendido no período.
                              </td>
                          </tr>
                      )}
                  </tbody>
              </table>
          </div>
        </div>

        {/* Top Clientes */}
        <div className={`p-6 rounded-2xl border shadow-sm flex flex-col ${theme.cardBg} ${theme.cardBorder}`}>
          <div className="mb-4">
              <h3 className={`text-lg font-black flex items-center gap-2 ${theme.textPrimary}`}><Users size={18} className="text-blue-500"/> Top Clientes</h3>
              <p className={`text-[11px] mt-1 ${theme.textSecondary}`}>Os clientes que mais compraram no período selecionado</p>
          </div>
          <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className={`text-xs text-gray-500 bg-gray-50 uppercase font-black ${isDarkMode ? 'bg-gray-800' : ''}`}>
                      <tr>
                          <th className="px-4 py-3">Cliente</th>
                          <th className="px-4 py-3 text-right">Pedidos</th>
                          <th className="px-4 py-3 text-right">Total Gasto</th>
                      </tr>
                  </thead>
                  <tbody className={`divide-y ${isDarkMode ? 'divide-gray-700' : 'divide-gray-100'}`}>
                      {topCustomers.length > 0 ? topCustomers.map((c, idx) => (
                          <tr key={c.id} className={`transition-colors ${isDarkMode ? 'hover:bg-gray-700/50' : 'hover:bg-gray-50'}`}>
                              <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-black text-gray-500 shrink-0">{idx + 1}</span>
                                      <div className="flex flex-col">
                                          <span className={`font-bold text-xs truncate max-w-[150px] ${theme.textPrimary}`} title={c.name}>{c.name}</span>
                                          <span className={`text-[10px] ${theme.textSecondary}`}>{c.phone.replace(/(\d{2})(\d{4,5})(\d{4})/, '($1) $2-****')}</span>
                                      </div>
                                  </div>
                              </td>
                              <td className={`px-4 py-3 text-right font-black ${theme.textSecondary}`}>{c.ordersCount}</td>
                              <td className="px-4 py-3 text-right font-black text-blue-600">R$ {c.revenue.toFixed(2)}</td>
                          </tr>
                      )) : (
                          <tr>
                              <td colSpan={3} className="px-4 py-8 text-center text-gray-400 font-bold text-xs">
                                  Nenhum cliente comprou no período.
                              </td>
                          </tr>
                      )}
                  </tbody>
              </table>
          </div>
        </div>
      </div>
    </div>
  );
};"""

if target in content:
    with open("components/AdminDashboard.tsx", "w") as f:
        f.write(content.replace(target, replacement))
    print("Replaced successfully")
else:
    print("Target not found")
