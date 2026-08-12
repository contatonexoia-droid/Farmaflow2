import React, { useState } from 'react';
import { Upload, X, FileText, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';

interface Props {
  tenantId: string;
  onUploadSuccess: (url: string) => void;
  onUploadRemove: () => void;
  uploadedUrl?: string | null;
}

export const PrescriptionUpload: React.FC<Props> = ({ tenantId, onUploadSuccess, onUploadRemove, uploadedUrl }) => {
  const [isUploading, setIsUploading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {
      toast.error('Formato inválido. Envie PDF, JPG ou PNG.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('O arquivo deve ter no máximo 5MB.');
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      // Using our new endpoint
      const response = await fetch(`/api/v1/store/${tenantId}/prescriptions/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        let errMsg = 'Falha no upload';
        try {
          const errData = await response.json();
          if (errData && errData.error) errMsg = errData.error;
        } catch (_) {
          try {
            const errText = await response.text();
            if (errText) errMsg = errText.substring(0, 100);
          } catch (_) {}
        }
        throw new Error(errMsg);
      }

      const data = await response.json();
      if (!data || !data.fileUrl) {
        throw new Error('Servidor não retornou a URL do arquivo.');
      }
      onUploadSuccess(data.fileUrl);
      toast.success('Receita anexada com sucesso!');
    } catch (error: any) {
      console.error("Erro no upload da receita:", error);
      toast.error(`Erro ao enviar a receita: ${error.message || 'Por favor, tente novamente.'}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 md:p-5 mt-4">
      <div className="flex items-start gap-3 mb-3">
        <AlertTriangle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div>
          <h4 className="font-bold text-blue-900 text-sm md:text-base">Anexo de Receita Obrigatório</h4>
          <p className="text-xs md:text-sm text-blue-700 mt-1">
            Seu pedido contém medicamentos controlados ou que exigem retenção de receita. Por favor, anexe a foto ou PDF da receita médica.
          </p>
        </div>
      </div>

      {!uploadedUrl ? (
        <div className="mt-4">
          <label className={`flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-xl cursor-pointer ${isUploading ? 'border-gray-300 bg-gray-50' : 'border-blue-300 bg-white hover:bg-blue-50/50 transition-colors'}`}>
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              {isUploading ? (
                <Loader2 className="w-6 h-6 text-blue-500 animate-spin mb-2" />
              ) : (
                <Upload className="w-6 h-6 text-blue-500 mb-2" />
              )}
              <p className="text-xs text-blue-600 font-medium">
                {isUploading ? 'Enviando arquivo...' : 'Clique para enviar foto ou PDF'}
              </p>
            </div>
            <input 
              type="file" 
              className="hidden" 
              accept="image/jpeg,image/png,application/pdf"
              onChange={handleFileChange}
              disabled={isUploading}
            />
          </label>
        </div>
      ) : (
        <div className="mt-4 flex items-center justify-between bg-white p-3 rounded-lg border border-green-200">
          <div className="flex items-center gap-2 overflow-hidden">
            <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
            <span className="text-sm font-medium text-green-700 truncate">Receita anexada com sucesso</span>
          </div>
          <button
            type="button"
            onClick={onUploadRemove}
            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors flex-shrink-0"
            title="Remover anexo"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
