const fs = require('fs');
let code = fs.readFileSync('components/AdminProductManager.tsx', 'utf8');

const strToFind = `const { requires_prescription, promotionType, originalPrice, buyX, payY, ...restProduct } = editingProduct as any;
    const productToSave: any = {
        ...restProduct,
        barcode: editingProduct.barcode ? editingProduct.barcode.trim() : '',
        image: finalImage,
        price: Number(editingProduct.price),
        stock: Number(editingProduct.stock),
        internalCode: editingProduct.internalCode || Math.random().toString(36).substr(2, 6).toUpperCase()
    };`;

const strToReplace = `const productToSave: any = {
        ...editingProduct,
        barcode: editingProduct.barcode ? editingProduct.barcode.trim() : '',
        image: finalImage,
        price: Number(editingProduct.price),
        stock: Number(editingProduct.stock),
        originalPrice: Number(editingProduct.originalPrice) || 0,
        buyX: Number(editingProduct.buyX) || 0,
        payY: Number(editingProduct.payY) || 0,
        requires_prescription: editingProduct.requires_prescription || false,
        promotionType: editingProduct.promotionType || 'NONE',
        internalCode: editingProduct.internalCode || Math.random().toString(36).substr(2, 6).toUpperCase()
    };`;

code = code.replace(strToFind, strToReplace);
fs.writeFileSync('components/AdminProductManager.tsx', code);
console.log('Fixed AdminProductManager.tsx undo');
