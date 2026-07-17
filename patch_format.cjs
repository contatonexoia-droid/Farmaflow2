const fs = require('fs');
let code = fs.readFileSync('components/SuperAdminManager.tsx', 'utf8');

const oldFormat = `    if (addr.street || addr.cep) {
      const parts = [];
      const streetNum = \\\`\\\${addr.street}\\\${addr.number ? ', ' + addr.number : ''}\\\${addr.complement ? ' (' + addr.complement + ')' : ''}\\\`;
      if (streetNum.trim()) parts.push(streetNum.trim());
      if (addr.neighborhood) parts.push(addr.neighborhood);
      if (addr.city || addr.state) parts.push(\\\`\\\${addr.city}\\\${addr.city && addr.state ? ' - ' + addr.state : addr.state}\\\`);
      if (addr.cep) parts.push(\\\`CEP: \\\${addr.cep}\\\`);
      
      editData.fullAddress = parts.join(' - ');
    }`;
    
const newFormat = `    if (addr.street || addr.cep) {
      const streetNumComp = \`\${addr.street || ''}\${addr.number ? ', ' + addr.number : ''}\${addr.complement ? ' (' + addr.complement + ')' : ''}\`.trim();
      const cityState = \`\${addr.city || ''}\${addr.city && addr.state ? ' - ' + addr.state : (addr.state || '')}\`.trim();
      
      const parts = [];
      if (streetNumComp) parts.push(streetNumComp);
      if (addr.neighborhood) parts.push(addr.neighborhood);
      if (cityState) parts.push(cityState);
      if (addr.cep) parts.push(addr.cep); // Only the CEP number, no 'CEP: ' prefix, to match exact example
      
      // The example was "Logradouro, Número - Bairro, Cidade - UF, CEP"
      // We will join with " - " for street - neighborhood - city - cep
      // Actually: Logradouro, 123 - Centro, São Paulo - SP, 01000-000
      
      let finalAddress = "";
      if (streetNumComp) finalAddress += streetNumComp;
      if (addr.neighborhood) finalAddress += (finalAddress ? " - " : "") + addr.neighborhood;
      if (cityState) finalAddress += (finalAddress ? ", " : "") + cityState;
      if (addr.cep) finalAddress += (finalAddress ? ", " : "") + addr.cep;
      
      editData.fullAddress = finalAddress;
    }`;

// use regex for safer replace
code = code.replace(/if \(addr\.street \|\| addr\.cep\) \{[\s\S]*?editData\.fullAddress = parts\.join\(' - '\);\n    \}/, newFormat);
fs.writeFileSync('components/SuperAdminManager.tsx', code);
