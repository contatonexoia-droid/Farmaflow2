const fs = require('fs');
let code = fs.readFileSync('components/Cart.tsx', 'utf8');

// Add deliveryMode to onComplete definition
code = code.replace(
  'calculatedDeliveryFee?: number,\n  ) => Promise<void> | void;',
  'calculatedDeliveryFee?: number,\n    deliveryMode?: "delivery" | "pickup",\n  ) => Promise<void> | void;'
);

// Add deliveryMode state to Cart component
code = code.replace(
  'const [cepError, setCepError] = useState("");',
  'const [cepError, setCepError] = useState("");\n  const [deliveryMode, setDeliveryMode] = useState<"delivery" | "pickup">("delivery");'
);

// Update delivery fee calculation logic to return 0 if pickup
code = code.replace(
  'if (!tenant?.deliverySettings?.enabled) {',
  'if (!tenant?.deliverySettings?.enabled || deliveryMode === "pickup") {'
);

// Update isDeliveryPending logic to check deliveryMode
code = code.replace(
  'const isDeliveryPending = Boolean(',
  'const isDeliveryPending = Boolean(\n    deliveryMode === "delivery" &&'
);

// Update required fields in validateFields
const oldRequiredFields = `const requiredFields = [
      "name",
      "phone",
      "address",
      "addressNumber",
      "neighborhood",
      "city",
    ];`;
const newRequiredFields = `const requiredFields = [
      "name",
      "phone",
    ];
    if (deliveryMode === "delivery") {
      requiredFields.push("address", "addressNumber", "neighborhood", "city");
    }`;
code = code.replace(oldRequiredFields, newRequiredFields);

// Pass deliveryMode in handleFinish
code = code.replace(
  'calculatedDeliveryFee?: number,',
  'calculatedDeliveryFee?: number,\n    deliveryMode?: "delivery" | "pickup",'
); // Just in case it replaces the wrong thing wait no.

// Let's replace onComplete call inside handleFinish
code = code.replace(
  'deliveryFee,\n      );\n      localStorage.removeItem("farmaflow_coupon_code");',
  'deliveryFee,\n        deliveryMode\n      );\n      localStorage.removeItem("farmaflow_coupon_code");'
);

// We need to add the selector UI before "Local de Entrega".
const uiBeforeAddress = `<div className="space-y-4 pt-4 border-t border-gray-50">
              <div className="flex items-center justify-between">
                <h4 className="font-black text-gray-900 text-lg">
                  Local de Entrega
                </h4>`;

const uiWithSelector = `{tenant?.deliverySettings?.storePickupEnabled && (
              <div className="space-y-4 pt-4 border-t border-gray-50 animate-in fade-in">
                <h4 className="font-black text-gray-900 text-lg">Opção de Recebimento</h4>
                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => setDeliveryMode("delivery")}
                    className={\`flex-1 py-4 px-4 rounded-2xl border-2 font-bold transition-all flex flex-col items-center gap-2 \${
                      deliveryMode === "delivery"
                        ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                        : "border-gray-100 bg-white text-gray-500 hover:border-emerald-200"
                    }\`}
                  >
                    <Truck size={24} />
                    <span>Receber em Casa</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeliveryMode("pickup")}
                    className={\`flex-1 py-4 px-4 rounded-2xl border-2 font-bold transition-all flex flex-col items-center gap-2 \${
                      deliveryMode === "pickup"
                        ? "border-blue-600 bg-blue-50 text-blue-700"
                        : "border-gray-100 bg-white text-gray-500 hover:border-blue-200"
                    }\`}
                  >
                    <MapPin size={24} />
                    <span>Retirar na Loja</span>
                  </button>
                </div>
              </div>
            )}

            {deliveryMode === "delivery" && (
              <div className="space-y-4 pt-4 border-t border-gray-50 animate-in slide-in-from-top-4">
              <div className="flex items-center justify-between">
                <h4 className="font-black text-gray-900 text-lg">
                  Local de Entrega
                </h4>`;

code = code.replace(uiBeforeAddress, uiWithSelector);

// Hide the closing div for Local de Entrega correctly
const paymentSectionStart = `<div className="space-y-4 pt-4 border-t border-gray-50">
              <div className="flex items-center justify-between">
                <h4 className="font-black text-gray-900 text-lg">
                  Forma de Pagamento`;

const newPaymentSectionStart = `</div>\n            )}\n\n            <div className="space-y-4 pt-4 border-t border-gray-50">
              <div className="flex items-center justify-between">
                <h4 className="font-black text-gray-900 text-lg">
                  Forma de Pagamento`;
code = code.replace(paymentSectionStart, newPaymentSectionStart);

// Let's modify the total preview side.
const taxaDeEntregaJSX = `              {tenant?.deliverySettings?.enabled && tenant?.deliverySettings?.type === 'dynamic' && !isAddressIncomplete && deliveryFee >= 0 && (
                <div className="flex justify-between items-center text-sm font-bold text-gray-600">
                  <span>Taxa de Entrega</span>
                  <span className={deliveryFee === 0 ? "text-emerald-500" : ""}>
                    {deliveryFee === 0 ? "Grátis" : \`R$ \${deliveryFee.toFixed(2)}\`}
                  </span>
                </div>
              )}`;

const newTaxaDeEntregaJSX = `              {tenant?.deliverySettings?.enabled && tenant?.deliverySettings?.type === 'dynamic' && deliveryMode === 'delivery' && !isAddressIncomplete && deliveryFee >= 0 && (
                <div className="flex justify-between items-center text-sm font-bold text-gray-600">
                  <span>Taxa de Entrega</span>
                  <span className={deliveryFee === 0 ? "text-emerald-500" : ""}>
                    {deliveryFee === 0 ? "Grátis" : \`R$ \${deliveryFee.toFixed(2)}\`}
                  </span>
                </div>
              )}
              {deliveryMode === 'pickup' && (
                <div className="flex justify-between items-center text-sm font-bold text-blue-600">
                  <span>Retirada</span>
                  <span>Grátis</span>
                </div>
              )}`;
code = code.replace(taxaDeEntregaJSX, newTaxaDeEntregaJSX);


fs.writeFileSync('components/Cart.tsx', code);
