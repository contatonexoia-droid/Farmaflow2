import React, { useState } from 'react';
import { supabase } from '../services/supabase';
import { uploadBase64Image } from '../services/storageMedia';
import { Product } from '../types';
import { Loader2, Image as ImageIcon, CheckCircle, AlertTriangle } from 'lucide-react';

interface ImageMigrationToolProps {
  tenantId: string;
  onComplete?: () => void;
}

export const ImageMigrationTool: React.FC<ImageMigrationToolProps> = ({ tenantId, onComplete }) => {
  const [isMigrating, setIsMigrating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [migrated, setMigrated] = useState(0);
  const [errors, setErrors] = useState(0);
  const [isDone, setIsDone] = useState(false);

  const startMigration = async () => {
    setIsMigrating(true);
    setProgress(0);
    setMigrated(0);
    setErrors(0);
    setIsDone(false);

    try {
      // Fetch all products with base64 images
      let allProducts: Product[] = [];
      let from = 0;
      const step = 1000;
      while (true) {
        const { data, error } = await supabase
          .from('products')
          .select('id, image, barcode, internalCode:internal_code')
          .eq('tenant_id', tenantId)
          .like('image', 'data:image/%')
          .range(from, from + step - 1);
          
        if (error) throw error;
        if (!data || data.length === 0) break;
        
        allProducts = allProducts.concat(data as any);
        if (data.length < step) break;
        from += step;
      }

      setTotal(allProducts.length);

      if (allProducts.length === 0) {
        setIsDone(true);
        setIsMigrating(false);
        return;
      }

      // Process in batches
      const BATCH_SIZE = 5;
      for (let i = 0; i < allProducts.length; i += BATCH_SIZE) {
        const batch = allProducts.slice(i, i + BATCH_SIZE);
        
        await Promise.all(batch.map(async (product) => {
          try {
            if (!product.image || !product.image.startsWith('data:image/')) return;
            
            const fileName = product.barcode || product.internalCode || product.id;
            const publicUrl = await uploadBase64Image(product.image, fileName);
            
            if (publicUrl) {
              const { error } = await supabase
                .from('products')
                .update({ image: publicUrl })
                .eq('id', product.id);
                
              if (error) throw error;
              setMigrated(prev => prev + 1);
            } else {
              setErrors(prev => prev + 1);
            }
          } catch (e) {
            console.error(`Error migrating image for product ${product.id}`, e);
            setErrors(prev => prev + 1);
          }
        }));
        
        setProgress(Math.round(((i + batch.length) / allProducts.length) * 100));
      }

      setIsDone(true);
      if (onComplete) onComplete();
    } catch (error) {
      console.error('Migration failed', error);
      alert('Erro ao migrar imagens. Verifique o console.');
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm mb-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center flex-shrink-0">
          <ImageIcon className="text-blue-600" size={24} />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-black text-gray-900">Otimização de Imagens (Base64 para Storage)</h3>
          <p className="text-sm text-gray-500 mt-1 mb-4">
            Converte imagens salvas em formato Base64 para URLs públicas no Supabase Storage. 
            Isso reduz drasticamente o tamanho do banco de dados e resolve problemas de lentidão na loja.
          </p>
          
          {!isMigrating && !isDone && (
            <button 
              onClick={startMigration}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm transition-all shadow-md shadow-blue-200"
            >
              Iniciar Migração de Imagens
            </button>
          )}

          {isMigrating && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-blue-600 font-bold">
                <Loader2 className="animate-spin" size={20} />
                <span>Migrando imagens... {progress}%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                <div className="bg-blue-600 h-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
              </div>
              <p className="text-xs text-gray-500">
                Processados: {migrated + errors} de {total} | Sucesso: {migrated} | Erros: {errors}
              </p>
            </div>
          )}

          {isDone && (
            <div className="flex items-center gap-3 text-emerald-600 font-bold bg-emerald-50 p-4 rounded-xl border border-emerald-100">
              <CheckCircle size={24} />
              <div>
                <p>Migração concluída!</p>
                <p className="text-xs font-medium text-emerald-700 mt-1">
                  {total === 0 ? 'Nenhuma imagem em Base64 encontrada.' : `${migrated} imagens migradas com sucesso. ${errors > 0 ? `${errors} erros.` : ''}`}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
