const fs = require('fs');
const file = 'components/AdminProductManager.tsx';
let code = fs.readFileSync(file, 'utf8');

// Replace the column checks definition right after hasImageColumn
code = code.replace(
    /const hasImageColumn[^\}]+\}\);/g,
    `$&

        const hasColumn = (keys: string[]) => {
            const normalize = (str: string) => str.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
            const normalizedKeys = keys.map(k => normalize(k));
            return headers.some(h => normalizedKeys.includes(normalize(h)));
        };

        const hasStockCol = hasColumn(['Estoque', 'Qtd', 'Quantidade', 'ESTOQUE_ATUAL', 'estoque']);
        const hasPriceCol = hasColumn(['valor', 'preco', 'preco_venda', 'preco venda', 'valor_venda', 'novo_preco', 'Preco', 'Valor', 'Preço', 'Venda', 'PRECO_VENDA']);
        const hasOriginalPriceCol = hasColumn(['PrecoOriginal', 'PreçoOriginal', 'De', 'Original', 'PrecoDe', 'PRECO_ORIGINAL', 'Preço original', 'Preco original', 'preco_original']);
        const hasDescCol = hasColumn(['Descricao', 'Descrição', 'Detalhes', 'Info', 'DESCRICAO_COMERCIAL', 'DescricaoDetalhada', 'Obs']);
        const hasLabCol = hasColumn(['Laboratorio', 'Fabricante', 'Marca', 'FABRICANTE_LAB', 'fabricantes']);
        const hasActivePrincipleCol = hasColumn(['Principio Ativo', 'PrincipioAtivo', 'Princípio Ativo', 'Substancia', 'Formula', 'PRINCIPIO_ATIVO']);
        const hasLegalTypeCol = hasColumn(['Tipo Legal', 'TipoLegal', 'Tipo', 'CategoriaLegal', 'Medicamento', 'TIPO_MEDICAMENTO', 'tipo medicamento']);
        const hasDeptCol = hasColumn(['Departamento', 'DEPARTAMENTO', 'Secao']);
        const hasSubcatCol = hasColumn(['SUBCATEGORIA', 'Subcategoria', 'Categoria', 'CATEGORIA_CLASSE', 'categoria']);
        const hasEanCol = hasColumn(['ean', 'ean_barras', 'barcode', 'codigo_de_barras', 'codigo barras', 'cod barras', 'EAN', 'Barras', 'CodigoBarras', 'EAN_BARRAS']);
        const hasNameCol = hasColumn(['Nome', 'Produto', 'Descricao', 'NOME_PRODUTO', 'Nome produto']);
        const hasCodeCol = hasColumn(['Código', 'Codigo', 'Cod', 'REF', 'ID', 'Código Interno', 'Codigo Interno', 'COD_INTERNO', 'referencia', 'ref.']);
        const hasPrescriptionCol = hasColumn(['Receita', 'RetencaoReceita', 'Controlado', 'TarjaPreta', 'RequiresPrescription', 'EXIGE_RECEITA']);
        const hasPromoTypeCol = hasColumn(['TipoPromocao', 'Promocao', 'Promo', 'TipoOferta', 'TIPO_PROMOCAO']);
        const hasBuyXCol = hasColumn(['Leve', 'BuyX', 'QtdLeve', 'PROMO_LEVE']);
        const hasPayYCol = hasColumn(['Pague', 'PayY', 'QtdPague', 'PROMO_PAGUE']);
`
);

// We need to modify updatedProductData around line 2090
code = code.replace(
    /const newName = p\.name;[^;]+;[\s\S]+?let diffDetails = \[\];/g,
    `const newName = hasNameCol && name ? String(name) : p.name;
                const newCode = hasCodeCol && code !== undefined ? String(code) : (p.internalCode ? String(p.internalCode).trim() : undefined);
                const newEan = hasEanCol && ean ? String(ean).trim() : (p.barcode && String(p.barcode).trim() !== '' ? String(p.barcode).trim() : undefined);
                const newPrice = hasPriceCol && finalPrice > 0 ? finalPrice : p.price;
                const newOriginalPrice = hasOriginalPriceCol ? (finalOriginalPrice > 0 ? finalOriginalPrice : 0) : p.originalPrice;
                
                let newPromoType = p.promotionType;
                if (hasPromoTypeCol && rowPromoType !== undefined) {
                    newPromoType = rowPromoType;
                } else if (hasOriginalPriceCol || hasPriceCol) {
                    if ((newOriginalPrice || 0) > 0 && newPrice < (newOriginalPrice || 0)) {
                        newPromoType = 'DISCOUNT';
                    } else if (newPromoType === 'DISCOUNT' && (!(newOriginalPrice || 0) || (newOriginalPrice || 0) <= newPrice)) {
                        newPromoType = 'NONE';
                    }
                }

                const hasChanges = 
                    p.internalCode !== newCode ||
                    p.price !== newPrice ||
                    (p.originalPrice || 0) !== newOriginalPrice ||
                    p.promotionType !== newPromoType ||
                    p.stock !== newStock ||
                    p.name !== newName ||
                    p.barcode !== newEan ||
                    (hasDescCol && getVal(['Descricao', 'DescricaoDetalhada', 'Obs', 'DESCRICAO_COMERCIAL'])) ||
                    (hasLabCol && getVal(['Laboratorio', 'Fabricante', 'Marca', 'FABRICANTE_LAB', 'fabricantes'])) ||
                    (hasActivePrincipleCol && getVal(['PrincipioAtivo', 'Formula', 'PRINCIPIO_ATIVO'])) ||
                    (hasLegalTypeCol && getVal(['Tipo', 'TipoLegal', 'TIPO_MEDICAMENTO', 'tipo medicamento'])) ||
                    (hasDeptCol || hasSubcatCol);

                if (hasChanges) {
                    const updatedProductData = {
                        ...p,
                        name: newName,
                        price: newPrice,
                        originalPrice: newOriginalPrice,
                        promotionType: newPromoType,
                        stock: newStock,
                        internalCode: newCode,
                        barcode: newEan
                    };
                    
                    if (hasDescCol) {
                        const val = getVal(['Descricao', 'DescricaoDetalhada', 'Obs', 'DESCRICAO_COMERCIAL']);
                        if (val !== undefined) updatedProductData.description = String(val);
                    }
                    if (hasLabCol) {
                        const val = getVal(['Laboratorio', 'Fabricante', 'Marca', 'FABRICANTE_LAB', 'fabricantes']);
                        if (val !== undefined) {
                            updatedProductData.manufacturer = findMatchingManufacturer(val, manufacturerOptions, tenant.manufacturerSynonyms || {});
                        }
                    }
                    if (hasActivePrincipleCol) {
                        const val = getVal(['PrincipioAtivo', 'Formula', 'PRINCIPIO_ATIVO']);
                        if (val !== undefined) updatedProductData.activePrinciple = String(val);
                    }
                    if (hasLegalTypeCol) {
                        const val = getVal(['Tipo', 'TipoLegal', 'TIPO_MEDICAMENTO', 'tipo medicamento']);
                        if (val !== undefined) updatedProductData.drugType = String(val);
                    }
                    if (hasDeptCol || hasSubcatCol) {
                        updatedProductData.category = finalCategoryStr !== undefined ? finalCategoryStr : p.category;
                    }
                    if (hasPrescriptionCol && rowRequiresPrescription !== undefined) {
                        updatedProductData.requires_prescription = rowRequiresPrescription;
                    }
                    if (hasImageColumn) {
                        updatedProductData.image = finalImage !== undefined ? finalImage : p.image;
                    }
                    if (hasBuyXCol && rowBuyX !== undefined) updatedProductData.buyX = rowBuyX;
                    if (hasPayYCol && rowPayY !== undefined) updatedProductData.payY = rowPayY;

                    if (isNewProductUpdate) {
                        const idx = newProducts.findIndex(np => np.id === p.id);
                        if (idx > -1) newProducts[idx] = updatedProductData;
                        if (newCode) newProductsByCode.set(newCode, updatedProductData);
                        if (newEan) newProductsByEan.set(newEan, updatedProductData);
                        importedProducts.push(updatedProductData);
                    } else {
                        const idx = updatedProducts.findIndex(up => up.id === p.id);
                        if (idx > -1) {
                            updatedProducts[idx] = updatedProductData;
                        } else {
                            updatedProducts.push(updatedProductData);
                            countUpdated++;
                        }
                        if (newCode) productsByCode.set(newCode, updatedProductData);
                        if (newEan) productsByEan.set(newEan, updatedProductData);
                        importedProducts.push(updatedProductData);
                    }

                    let diffDetails = [];`
);

// We need to fix the rowStock assignment for existing Product
code = code.replace(
    /if \(rowStock !== undefined\) \{[\s\S]+?\}\s+const newName = /g,
    `if (hasStockCol && rowStock !== undefined) {
                    if (importStockMode === 'ADD') {
                        newStock += rowStock;
                        changeTxt = \`Acrescentado \${rowStock} un.\`;
                    }
                    else if (importStockMode === 'SUBTRACT') {
                        newStock = newStock - rowStock;
                        changeTxt = \`Baixado \${rowStock} un.\`;
                    }
                    else {
                        newStock = rowStock;
                        changeTxt = \`Definido como \${rowStock} un.\`;
                    }
                }
                const newName = `
);


// Replace the updatePayload logic
code = code.replace(
    /const updatePayload = updatedProducts\.map\(p => \{[\s\S]+?return item;\s+\}\);/g,
    `const updatePayload = updatedProducts.map(p => {
                    const item: any = {
                        id: p.id,
                        tenant_id: tenant.id
                    };
                    
                    if (hasEanCol) item.barcode = (p.barcode && String(p.barcode).trim() !== '') ? String(p.barcode).trim() : null;
                    if (hasCodeCol) item.internal_code = p.internalCode;
                    if (hasNameCol) item.name = p.name;
                    if (hasPriceCol) item.price = p.price;
                    if (hasDeptCol || hasSubcatCol) item.category = p.category;
                    if (hasLabCol) item.manufacturer = p.manufacturer;
                    if (hasStockCol) item.stock = p.stock;
                    if (hasActivePrincipleCol) item.active_principle = p.activePrinciple;
                    if (hasLegalTypeCol) item.drug_type = p.drugType;
                    if (hasDescCol) item.description = p.description;
                    if (hasOriginalPriceCol) {
                        item.original_price = p.originalPrice;
                    }
                    if (hasPromoTypeCol || hasOriginalPriceCol || hasPriceCol) {
                        item.promotion_type = p.promotionType;
                    }
                    if (hasBuyXCol) item.buy_x = p.buyX;
                    if (hasPayYCol) item.pay_y = p.payY;
                    if (hasPrescriptionCol) item.requires_prescription = p.requires_prescription;
                    
                    if (hasImageColumn) {
                        item.image = p.image || null;
                    }
                    
                    return item;
                });`
);

// Replace the actualUpdateFromNewProducts building block
code = code.replace(
    /actualUpdateFromNewProducts\.push\(\{[\s\S]+?\}\);\s+p\.id = existingDbItem\.id;/g,
    `const updateItem: any = {
                            id: existingDbItem.id,
                            tenant_id: tenant.id
                        };
                        
                        if (hasEanCol) updateItem.barcode = cleanBarcode || null;
                        if (hasCodeCol) updateItem.internal_code = cleanCode || existingDbItem.internal_code;
                        if (hasNameCol) updateItem.name = p.name;
                        if (hasPriceCol) updateItem.price = p.price;
                        if (hasOriginalPriceCol) updateItem.original_price = p.originalPrice;
                        if (hasPromoTypeCol || hasOriginalPriceCol || hasPriceCol) updateItem.promotion_type = p.promotionType;
                        if (hasStockCol) updateItem.stock = p.stock;
                        if (hasLabCol) updateItem.manufacturer = p.manufacturer;
                        if (hasDescCol) updateItem.description = p.description;
                        if (hasActivePrincipleCol) updateItem.active_principle = p.activePrinciple;
                        if (hasLegalTypeCol) updateItem.drug_type = p.drugType;
                        if (hasDeptCol || hasSubcatCol) updateItem.category = p.category;
                        if (hasPrescriptionCol) updateItem.requires_prescription = p.requires_prescription;
                        if (hasBuyXCol) updateItem.buy_x = p.buyX;
                        if (hasPayYCol) updateItem.pay_y = p.payY;
                        if (hasImageColumn) updateItem.image = p.image || null;

                        actualUpdateFromNewProducts.push(updateItem);
                        p.id = existingDbItem.id;`
);

fs.writeFileSync('patch_importer.cjs_out', code, 'utf8');
