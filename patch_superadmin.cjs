const fs = require('fs');
let code = fs.readFileSync('components/SuperAdminManager.tsx', 'utf8');

// Add address state
const stateInsertionPoint = "const [editData, setEditData] = useState<Partial<PharmacyConfig>>({";
const addressState = `
  const [addressData, setAddressData] = useState({
    cep: "",
    street: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: ""
  });
  const [isFetchingCep, setIsFetchingCep] = useState(false);
  const [cepError, setCepError] = useState("");

`;

if (!code.includes('const [addressData')) {
  code = code.replace(stateInsertionPoint, addressState + stateInsertionPoint);
}

// Add fetchCep function
const fetchCepFn = `
  const handleCepChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/\\D/g, "");
    if (value.length > 8) value = value.slice(0, 8);
    
    let formatted = value;
    if (value.length > 5) {
      formatted = value.slice(0, 5) + "-" + value.slice(5);
    }
    
    setAddressData(prev => ({ ...prev, cep: formatted }));
    
    if (value.length === 8) {
      setIsFetchingCep(true);
      setCepError("");
      try {
        const res = await fetch(\`https://viacep.com.br/ws/\${value}/json/\`);
        const data = await res.json();
        
        if (data.erro) {
          setCepError("CEP não encontrado.");
        } else {
          setAddressData(prev => ({
            ...prev,
            street: data.logradouro || "",
            neighborhood: data.bairro || "",
            city: data.localidade || "",
            state: data.uf || ""
          }));
        }
      } catch (err) {
        setCepError("Erro ao buscar CEP.");
      } finally {
        setIsFetchingCep(false);
      }
    } else {
      setCepError("");
    }
  };
`;

const handleEditClickRegex = /const handleEditClick = \(e: React\.MouseEvent, tenant: PharmacyConfig\) => \{/;
if (!code.includes('const handleCepChange')) {
  code = code.replace(handleEditClickRegex, fetchCepFn + '\n  const handleEditClick = (e: React.MouseEvent, tenant: PharmacyConfig) => {');
}

// Update handleEditClick to parse address if possible
const handleEditReplacement = `const handleEditClick = (e: React.MouseEvent, tenant: PharmacyConfig) => {
    e.stopPropagation();
    
    // Attempt to parse existing fullAddress
    let cep = "", street = "", number = "", complement = "", neighborhood = "", city = "", state = "";
    if (tenant.fullAddress) {
      // Basic parse: Logradouro, Número - Bairro, Cidade - UF, CEP
      const parts = tenant.fullAddress.split(',');
      if (parts.length >= 2) {
        street = parts[0].trim();
        const secondPart = parts.slice(1).join(',').trim();
        const dashParts = secondPart.split('-');
        if (dashParts.length >= 2) {
           number = dashParts[0].trim();
           // Try to find cep at the end
           const cepMatch = tenant.fullAddress.match(/\\d{5}-\\d{3}/);
           if (cepMatch) cep = cepMatch[0];
        } else {
           street = tenant.fullAddress; // fallback
        }
      } else {
        street = tenant.fullAddress;
      }
    }
    setAddressData({ cep, street, number, complement, neighborhood, city, state });
    
    setEditData({`;

if (!code.includes('setAddressData({ cep, street')) {
    code = code.replace('const handleEditClick = (e: React.MouseEvent, tenant: PharmacyConfig) => {\n    e.stopPropagation();\n    setEditData({ ', handleEditReplacement);
}

// Update handleAddNew to clear addressData
const handleAddNewRegex = /const handleAddNew = \(\) => \{/;
const handleAddNewReplacement = `const handleAddNew = () => {
    setAddressData({ cep: "", street: "", number: "", complement: "", neighborhood: "", city: "", state: "" });`;

if (!code.includes('setAddressData({ cep: "", street: "", number: "", complement: "", neighborhood: "", city: "", state: "" });')) {
    code = code.replace(handleAddNewRegex, handleAddNewReplacement);
}

// Update handleSave to assemble address
const handleSaveRegex = /setAttemptedSave\(true\);\n\s*setSaveError\(null\);/;
const handleSaveReplacement = `setAttemptedSave(true);
    setSaveError(null);
    
    // Format fullAddress
    const addr = addressData;
    if (addr.street || addr.cep) {
      const parts = [];
      const streetNum = \`\${addr.street}\${addr.number ? ', ' + addr.number : ''}\${addr.complement ? ' (' + addr.complement + ')' : ''}\`;
      if (streetNum.trim()) parts.push(streetNum.trim());
      if (addr.neighborhood) parts.push(addr.neighborhood);
      if (addr.city || addr.state) parts.push(\`\${addr.city}\${addr.city && addr.state ? ' - ' + addr.state : addr.state}\`);
      if (addr.cep) parts.push(\`CEP: \${addr.cep}\`);
      
      editData.fullAddress = parts.join(' - ');
    }`;

if (!code.includes('// Format fullAddress')) {
    code = code.replace(/setAttemptedSave\(true\);\s*setSaveError\(null\);/, handleSaveReplacement);
}

// Replace UI
const uiOld = `<div className="space-y-1">
                      <label className="text-[11px] font-black uppercase text-gray-800 ml-2">Endereço Completo</label>
                      <input type="text" className="w-full bg-white p-4 rounded-2xl border-2 border-gray-200 outline-none font-bold text-black" value={editData.fullAddress || ''} onChange={e => setEditData({...editData, fullAddress: e.target.value})} placeholder="Rua, Número, Bairro, Cidade - UF" />
                    </div>`;
                    
const uiNew = `<div className="col-span-1 md:col-span-2 bg-white p-6 rounded-3xl border border-gray-200 space-y-4">
                      <h4 className="text-xs font-black uppercase text-gray-500 mb-2 flex items-center gap-2">
                        <MapPin size={14} /> Endereço
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label className="text-[11px] font-black uppercase text-gray-800 ml-2">
                            CEP {isFetchingCep && <Loader2 size={12} className="inline animate-spin" />}
                          </label>
                          <input 
                            type="text" 
                            className="w-full bg-gray-50 p-4 rounded-2xl border-2 border-gray-100 outline-none font-bold text-black focus:border-emerald-500 transition-colors" 
                            value={addressData.cep} 
                            onChange={handleCepChange} 
                            placeholder="00000-000" 
                            maxLength={9}
                          />
                          {cepError && <span className="text-red-500 text-xs font-bold ml-2">{cepError}</span>}
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <label className="text-[11px] font-black uppercase text-gray-800 ml-2">Logradouro</label>
                          <input 
                            type="text" 
                            className="w-full bg-gray-50 p-4 rounded-2xl border-2 border-gray-100 outline-none font-bold text-black focus:border-emerald-500 transition-colors" 
                            value={addressData.street} 
                            onChange={e => setAddressData({...addressData, street: e.target.value})} 
                            placeholder="Rua / Avenida" 
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-black uppercase text-gray-800 ml-2">Número</label>
                          <input 
                            type="text" 
                            className="w-full bg-gray-50 p-4 rounded-2xl border-2 border-gray-100 outline-none font-bold text-black focus:border-emerald-500 transition-colors" 
                            value={addressData.number} 
                            onChange={e => setAddressData({...addressData, number: e.target.value})} 
                            placeholder="123" 
                          />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <label className="text-[11px] font-black uppercase text-gray-800 ml-2">Complemento</label>
                          <input 
                            type="text" 
                            className="w-full bg-gray-50 p-4 rounded-2xl border-2 border-gray-100 outline-none font-bold text-black focus:border-emerald-500 transition-colors" 
                            value={addressData.complement} 
                            onChange={e => setAddressData({...addressData, complement: e.target.value})} 
                            placeholder="Sala 1, Loja 2 (Opcional)" 
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-black uppercase text-gray-800 ml-2">Bairro</label>
                          <input 
                            type="text" 
                            className="w-full bg-gray-50 p-4 rounded-2xl border-2 border-gray-100 outline-none font-bold text-black focus:border-emerald-500 transition-colors" 
                            value={addressData.neighborhood} 
                            onChange={e => setAddressData({...addressData, neighborhood: e.target.value})} 
                            placeholder="Centro" 
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-black uppercase text-gray-800 ml-2">Cidade</label>
                          <input 
                            type="text" 
                            className="w-full bg-gray-50 p-4 rounded-2xl border-2 border-gray-100 outline-none font-bold text-black focus:border-emerald-500 transition-colors" 
                            value={addressData.city} 
                            onChange={e => setAddressData({...addressData, city: e.target.value})} 
                            placeholder="São Paulo" 
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-black uppercase text-gray-800 ml-2">UF</label>
                          <select 
                            className="w-full bg-gray-50 p-4 rounded-2xl border-2 border-gray-100 outline-none font-bold text-black focus:border-emerald-500 transition-colors" 
                            value={addressData.state} 
                            onChange={e => setAddressData({...addressData, state: e.target.value})}
                          >
                            <option value="">UF</option>
                            <option value="AC">AC</option><option value="AL">AL</option><option value="AP">AP</option><option value="AM">AM</option>
                            <option value="BA">BA</option><option value="CE">CE</option><option value="DF">DF</option><option value="ES">ES</option>
                            <option value="GO">GO</option><option value="MA">MA</option><option value="MT">MT</option><option value="MS">MS</option>
                            <option value="MG">MG</option><option value="PA">PA</option><option value="PB">PB</option><option value="PR">PR</option>
                            <option value="PE">PE</option><option value="PI">PI</option><option value="RJ">RJ</option><option value="RN">RN</option>
                            <option value="RS">RS</option><option value="RO">RO</option><option value="RR">RR</option><option value="SC">SC</option>
                            <option value="SP">SP</option><option value="SE">SE</option><option value="TO">TO</option>
                          </select>
                        </div>
                      </div>
                    </div>`;

if (code.includes(uiOld)) {
    code = code.replace(uiOld, uiNew);
} else {
    // If exact match fails, use a regex
    const uiRegex = /<div className="space-y-1">\s*<label className="text-\[11px\] font-black uppercase text-gray-800 ml-2">Endereço Completo<\/label>\s*<input type="text" className="w-full bg-white p-4 rounded-2xl border-2 border-gray-200 outline-none font-bold text-black" value=\{editData\.fullAddress \|\| ''\} onChange=\{e => setEditData\(\{\.\.\.editData, fullAddress: e\.target\.value\}\)\} placeholder="Rua, Número, Bairro, Cidade - UF" \/>\s*<\/div>/;
    code = code.replace(uiRegex, uiNew);
}

fs.writeFileSync('components/SuperAdminManager.tsx', code);
