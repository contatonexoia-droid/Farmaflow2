import { supabase } from './supabase.js';

const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

export const processImportedImage = async (imageUrl: string, fileName: string): Promise<string | null> => {
  if (!imageUrl) return null;

  // 1. Sanitize URL
  let cleanUrl = imageUrl.trim();
  
  // 2. Handle Base64
  if (cleanUrl.startsWith('data:image/')) {
    return await uploadBase64Image(cleanUrl, fileName);
  }

  // 3. Handle External/Internal URLs by downloading and re-uploading
  try {
    // If it's a Supabase URL or external URL, try to fetch it
    const response = await fetch(cleanUrl);
    if (!response.ok) {
      console.warn(`Failed to fetch image from URL: ${cleanUrl}, marking as broken (null)`);
      return null; // Return null to mark as broken, so it can be repaired later
    }

    const blob = await response.blob();
    
    // Convert to base64 to reuse our robust upload logic (which includes resizing and fallbacks)
    const base64Data = await blobToBase64(blob);
    const newUrl = await uploadBase64Image(base64Data, fileName);
    
    return newUrl || cleanUrl; // Return new URL or fallback to original
  } catch (error) {
    console.warn(`Error processing imported image ${cleanUrl}:`, error);
    return cleanUrl; // Fallback to original URL
  }
};

export const uploadBase64Image = async (base64Data: string, fileName: string): Promise<string | null> => {
  try {
    if (!base64Data || !base64Data.startsWith('data:image/')) {
      return null;
    }

    let blob: Blob;
    let mimeType: string;

    try {
      // Try fetch first
      const response = await fetch(base64Data);
      if (!response.ok) throw new Error('Fetch failed');
      blob = await response.blob();
      mimeType = blob.type;
    } catch (e) {
      // Fallback to manual conversion if fetch fails
      const parts = base64Data.split(',');
      if (parts.length !== 2) return null;
      
      const match = parts[0].match(/^data:(image\/[a-zA-Z0-9+-]+);base64$/);
      if (!match) return null;
      
      mimeType = match[1];
      let base64String = parts[1];
      
      // Decode URL encoding if present
      if (base64String.includes('%')) {
        try {
          base64String = decodeURIComponent(base64String);
        } catch (err) {
          // Ignore malformed URI
        }
      }
      
      // Remove whitespace and ALL invalid characters (including existing padding to fix it later)
      base64String = base64String.replace(/[^A-Za-z0-9+/]/g, '');
      
      // Fix padding
      while (base64String.length % 4 !== 0) {
        base64String += '=';
      }
      
      try {
        const byteString = atob(base64String);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
          ia[i] = byteString.charCodeAt(i);
        }
        blob = new Blob([ab], { type: mimeType });
      } catch (atobError) {
        console.warn('Could not decode base64 string, image might be corrupted.');
        return null;
      }
    }

    // Resize image if needed (max 400px width)
    const resizedBlob = await resizeImageBlob(blob, 400);

    const fileExt = mimeType.split('/')[1] || 'png';
    const safeFileName = fileName.replace(/[^a-zA-Z0-9]/g, '_');
    const filePath = `${safeFileName}-${Date.now()}.${fileExt}`;

    const { data, error } = await supabase.storage
      .from('product-images')
      .upload(filePath, resizedBlob, {
        contentType: mimeType,
        upsert: true
      });

    if (error) {
      console.warn(`Supabase Storage upload failed: ${error.message}. Falling back to resized base64 string.`);
      // Fallback: If Supabase Storage fails (e.g. CORS, bucket missing, network error),
      // we return the RESIZED base64 string. Since it's resized to 400px, it will be 
      // small enough (~20-40KB) to save directly in the database without causing the 
      // "payload too large" error!
      return await blobToBase64(resizedBlob);
    }

    const { data: publicUrlData } = supabase.storage
      .from('product-images')
      .getPublicUrl(filePath);

    return publicUrlData.publicUrl;
  } catch (error: any) {
    console.error('Unexpected error in uploadBase64Image:', error?.message || error);
    return null;
  }
};

const resizeImageBlob = (blob: Blob, maxWidth: number): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(blob);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((resizedBlob) => {
        if (resizedBlob) resolve(resizedBlob);
        else resolve(blob);
      }, blob.type, 0.8);
    };
    img.onerror = () => resolve(blob);
    img.src = URL.createObjectURL(blob);
  });
};
