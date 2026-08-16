with open("components/Storefront.tsx", "r") as f:
    content = f.read()

target = """        // Fallback Logic overrides normal search
        if (searchFallback) {
           if (p.stock <= 0) return null; // must be in stock
           const pPrinciple = normalizeStr(p.activePrinciple || "");
           const pPres = normalizeStr(p.presentation || "");
           
           const matchesPrinciple = searchFallback.principle === pPrinciple;
           // optionally check presentation, if presentation exists in both
           const matchesPres = !searchFallback.presentation || !pPres || searchFallback.presentation === pPres;
           
           if (matchesPrinciple && matchesPres) {
              matchScore += 500; // high score for fallback match
           } else {
              return null; // strictly filter out everything else
           }
        }
        // 4. NLP / Search logic: Only executed if there is a search term query active
        else if (searchTokens.length > 0) {"""

replacement = """        // Fallback Logic overrides normal search
        if (searchFallback) {
           if (p.stock <= 0) return null; // must be in stock
           const pPrinciple = normalizeStr(p.activePrinciple || "");
           const pPres = normalizeStr(p.presentation || "");
           const pName = normalizeStr(p.name || "");
           
           const matchesPrinciple = searchFallback.principle === pPrinciple;
           
           if (matchesPrinciple) {
              matchScore += 100; // Base score for fallback principle match
              
              const presentationKeywords = ["gotas", "comprimido", "xarope", "supositorio", "spray", "capsula", "pomada", "creme", "solucao", "injetavel"];
              
              // 1. Exact presentation match via product struct
              if (searchFallback.presentation && pPres && searchFallback.presentation === pPres) {
                 matchScore += 800;
              } 
              // 2. Exact presentation match via extracted keywords
              else {
                 let hasPresMatch = false;
                 const originalName = normalizeStr(searchFallback.originalName || "");
                 for (const kw of presentationKeywords) {
                    if (originalName.includes(kw) || searchTokens.includes(kw)) {
                        if (pName.includes(kw) || pPres.includes(kw)) {
                            hasPresMatch = true;
                            break;
                        }
                    }
                 }
                 if (hasPresMatch) {
                    matchScore += 800;
                 }
              }
           } else {
              return null; // strictly filter out everything else
           }
        }
        // 4. NLP / Search logic: Only executed if there is a search term query active
        else if (searchTokens.length > 0) {"""

if target in content:
    with open("components/Storefront.tsx", "w") as f:
        f.write(content.replace(target, replacement))
    print("Replaced successfully")
else:
    print("Target not found")
