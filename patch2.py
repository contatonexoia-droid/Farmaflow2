with open("components/Storefront.tsx", "r") as f:
    content = f.read()

target = """        let matchScore = 0;

        // 4. NLP / Search logic: Only executed if there is a search term query active
        if (searchTokens.length > 0) {"""

replacement = """        let matchScore = 0;

        // Fallback Logic overrides normal search
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

if target in content:
    with open("components/Storefront.tsx", "w") as f:
        f.write(content.replace(target, replacement))
    print("Replaced successfully")
else:
    print("Target not found")
