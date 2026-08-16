const fs = require('fs');
let code = fs.readFileSync('components/Storefront.tsx', 'utf8');

const synonymMapRegex = /    const SYNONYM_MAP: Record<string, string\[\]> = \{[\s\S]*?    \};\n/g;

// extract the SYNONYM_MAP string
const match = code.match(synonymMapRegex);
if (!match) {
  console.log("Could not find SYNONYM_MAP");
  process.exit(1);
}

let synonymMapStr = match[0];
// Remove it from the original location
code = code.replace(synonymMapStr, "");

// Modify synonymMapStr to be a global const and add shampoo mappings
synonymMapStr = synonymMapStr.replace("    const SYNONYM_MAP: Record<string, string[]> = {", "const SYNONYM_MAP: Record<string, string[]> = {");
synonymMapStr = synonymMapStr.replace("  };", "};\n");

// Add shampoo mappings
const shampooMappings = `
  shampoo: ["shampoo", "sh", "xampu"],
  sh: ["shampoo", "sh", "xampu"],
  xampu: ["shampoo", "sh", "xampu"],
`;
synonymMapStr = synonymMapStr.replace("    };\n", shampooMappings + "};\n");

// Insert global SYNONYM_MAP right after TYPO_MAP
const typoMapRegex = /const TYPO_MAP: Record<string, string> = \{[\s\S]*?\};\n/;
code = code.replace(typoMapRegex, (match) => {
  return match + "\n" + synonymMapStr;
});

// Now update `filteredProducts` logic:
const filteredRegex = /matchedCat =\s*pCat\.includes\(token\) \|\|\s*SYNONYM_MAP\[token\]\?\.some\(\(syn\) => pCat\.includes\(syn\)\);\s*nameMatched = pName\.includes\(token\) \|\| pActive\.includes\(token\);\s*otherMatched = pInd\.includes\(token\) \|\| pType\.includes\(token\);/g;

const newFilteredLogic = `matchedCat =
                pCat.includes(token) ||
                SYNONYM_MAP[token]?.some((syn) => pCat.includes(syn));
              nameMatched = 
                pName.includes(token) || 
                pActive.includes(token) ||
                SYNONYM_MAP[token]?.some((syn) => pName.includes(syn) || pActive.includes(syn));
              otherMatched = 
                pInd.includes(token) || 
                pType.includes(token) ||
                SYNONYM_MAP[token]?.some((syn) => pInd.includes(syn) || pType.includes(syn));`;
                
code = code.replace(filteredRegex, newFilteredLogic);


// Now update `intelligentSuggestions` logic:
const intelRegex = /nameMatched = pName\.includes\(token\) \|\| pActive\.includes\(token\);\s*otherMatched =\s*pInd\.includes\(token\) \|\|\s*pCat\.includes\(token\) \|\|\s*pManuf\.includes\(token\);/g;

const newIntelLogic = `nameMatched = 
              pName.includes(token) || 
              pActive.includes(token) ||
              SYNONYM_MAP[token]?.some((syn) => pName.includes(syn) || pActive.includes(syn));
            otherMatched =
              pInd.includes(token) ||
              pCat.includes(token) ||
              pManuf.includes(token) ||
              SYNONYM_MAP[token]?.some((syn) => pInd.includes(syn) || pCat.includes(syn) || pManuf.includes(syn));`;

code = code.replace(intelRegex, newIntelLogic);

fs.writeFileSync('components/Storefront.tsx', code);
console.log("Successfully patched Storefront.tsx");
