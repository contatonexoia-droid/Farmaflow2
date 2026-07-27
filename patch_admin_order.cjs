const fs = require('fs');
let code = fs.readFileSync('components/AdminOrderManager.tsx', 'utf8');

// First replace for the detailed view
const oldDetailView = `{viewingOrder.customer?.address},{" "}
                    {viewingOrder.customer?.addressNumber || "S/N"}
                  </p>
                  <p className="text-sm font-bold text-gray-500">
                    {viewingOrder.customer?.neighborhood} —{" "}
                    {viewingOrder.customer?.city}`;

const newDetailView = `{viewingOrder.deliveryMode === "pickup" ? (
                    <span className="bg-blue-100 text-blue-800 font-bold px-2 py-1 rounded-md text-xs">Retirada na Loja</span>
                  ) : (
                    <>
                      {viewingOrder.customer?.address},{" "}
                      {viewingOrder.customer?.addressNumber || "S/N"}
                      <br />
                      <span className="text-sm font-bold text-gray-500">
                        {viewingOrder.customer?.neighborhood} —{" "}
                        {viewingOrder.customer?.city}
                      </span>
                    </>
                  )}`;

// Wait, the regex needs to match exactly. I will just use regex to replace the specific JSX block for the list view
code = code.replace(
  '<MapPin size={14} className="text-gray-400 mt-1 shrink-0" />',
  \`<MapPin size={14} className="text-gray-400 mt-1 shrink-0" />
                      {order.deliveryMode === "pickup" ? (
                        <div className="flex flex-col">
                          <span className="text-blue-600 font-black">Retirada na Loja</span>
                        </div>
                      ) : (\`
);

// We need to close the ternary for the list view. Let's find the closing tag.
// It's probably `</div>` after `{order.customer?.city || "-"}`
const listCityMatch = `{order.customer?.city || "-"}
                      </div>`;
code = code.replace(
  listCityMatch,
  \`{order.customer?.city || "-"}
                      </div>
                      )}\`
);

// Second replace for the modal detail view
code = code.replace(
  '<MapPin size={18} className="text-gray-400 shrink-0" />',
  \`<MapPin size={18} className="text-gray-400 shrink-0" />
                  {viewingOrder.deliveryMode === "pickup" ? (
                    <div>
                      <span className="bg-blue-100 text-blue-800 font-black px-3 py-1 rounded-lg text-sm">Retirada na Loja</span>
                    </div>
                  ) : (\`
);

// Close the ternary for the modal
const modalCityMatch = `{viewingOrder.customer?.city}
                  </p>`;
code = code.replace(
  modalCityMatch,
  \`{viewingOrder.customer?.city}
                  </p>
                  )}\`
);

// Now for the print view (Receipt)
const oldPrintView = `<div class="row"><span>Endereço:</span> <strong>\${order.customer?.address || "N/A"}, \${order.customer?.addressNumber || ""}</strong></div>
                    <div class="row"><span>Cidade:</span> <strong>\${order.customer?.neighborhood} - \${order.customer?.city}</strong></div>`;

const newPrintView = `\${order.deliveryMode === "pickup" 
                      ? '<div class="row"><strong style="font-size: 16px;">RETIRADA NA LOJA</strong></div>'
                      : \`<div class="row"><span>Endereço:</span> <strong>\${order.customer?.address || "N/A"}, \${order.customer?.addressNumber || ""}</strong></div>
                         <div class="row"><span>Cidade:</span> <strong>\${order.customer?.neighborhood} - \${order.customer?.city}</strong></div>\`
                    }`;
code = code.replace(oldPrintView, newPrintView);


fs.writeFileSync('components/AdminOrderManager.tsx', code);
