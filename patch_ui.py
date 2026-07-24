with open("components/Storefront.tsx", "r") as f:
    content = f.read()

target = """        {!(debouncedSearchTerm.length > 0 && filteredProducts.length > 0) && (
          <SmartBanner"""

replacement = """        {searchFallback && (
          <div className="mb-6 p-4 md:p-6 bg-blue-50 border border-blue-100 rounded-2xl flex items-start gap-4">
             <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0 text-blue-500">
               <Info size={20} />
             </div>
             <div>
               <h4 className="text-blue-900 font-bold text-sm md:text-base">
                 Não encontramos '{searchFallback.originalName}' disponível no momento.
               </h4>
               <p className="text-blue-700 text-xs md:text-sm mt-1 font-medium">
                 Mas temos opções com a mesma fórmula ({searchFallback.principle}) {searchFallback.presentation ? `e apresentação (${searchFallback.presentation})` : ''} em estoque para você:
               </p>
             </div>
          </div>
        )}
        {!(debouncedSearchTerm.length > 0 && filteredProducts.length > 0) && (
          <SmartBanner"""

if target in content:
    with open("components/Storefront.tsx", "w") as f:
        f.write(content.replace(target, replacement))
    print("Replaced successfully")
else:
    print("Target not found")
