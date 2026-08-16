const fs = require('fs');
let code = fs.readFileSync('components/AdminProductManager.tsx', 'utf8');

// The field requires_prescription doesn't exist in the product payload we are sending to supabase,
// nor is it in the basic Product type unless added. Let's make sure it's safely stripped or handled.

// First let's check what fields we are sending
const payloadMatch = code.match(/const productToSave: Product = \{([\s\S]*?)\};/);
if (payloadMatch) {
    let payload = payloadMatch[0];
    
    // Make sure we strip any custom local UI fields from productToSave before sending to Supabase
    // If requires_prescription was added but isn't in DB, it causes RLS error.
    
    // We already removed originalPrice, buyX, payY.
    // Let's also ensure requires_prescription is removed if it's there.
    if (payload.includes('requires_prescription')) {
        payload = payload.replace(/requires_prescription:[\s\S]*?,/g, '');
        code = code.replace(payloadMatch[0], payload);
        console.log('Removed requires_prescription from payload');
    } else {
        // If it's spreading ...editingProduct, it will include requires_prescription!
        // We need to explicitly delete it before upsert or destructure without it.
        const newPayloadStr = `const { requires_prescription, promotionType, originalPrice, buyX, payY, ...restProduct } = editingProduct as any;
    const productToSave: any = {
        ...restProduct,
        barcode: editingProduct.barcode ? editingProduct.barcode.trim() : '',
        image: finalImage,
        price: Number(editingProduct.price),
        stock: Number(editingProduct.stock),
        internalCode: editingProduct.internalCode || Math.random().toString(36).substr(2, 6).toUpperCase()
    };`;
        
        code = code.replace(/const productToSave: Product = \{[\s\S]*?\};/, newPayloadStr);
        console.log('Updated productToSave payload to strictly remove UI-only fields from ...editingProduct');
    }
}

fs.writeFileSync('components/AdminProductManager.tsx', code);
