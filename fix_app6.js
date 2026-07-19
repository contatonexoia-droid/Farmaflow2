import fs from 'fs';
let content = fs.readFileSync('App.tsx', 'utf-8');
content = content.replace(
`    if (currentTenant?.networkId && currentTenant.networkId !== currentTenant.id) {
      getProductsByTenant(currentTenant.networkId, setMatrizProducts).catch(console.error);
    } else {`,
`    if (currentTenant?.networkId && currentTenant.networkId !== currentTenant.id) {
      getProductsByTenant(currentTenant.networkId, setMatrizProducts)
        .then((initialProds) => {
          setMatrizProducts((prev) => (prev.length === 0 && initialProds.length > 0 ? initialProds : prev));
        })
        .catch(console.error);
    } else {`
);
fs.writeFileSync('App.tsx', content);
