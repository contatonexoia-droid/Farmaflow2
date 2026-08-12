import React, { useState, useEffect } from 'react';
import { Eye, Check, X, FileText, CheckCircle, AlertTriangle, Loader2, Download } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { mutate } from "swr";
import { MedicalPrescription, AuthSession } from '../types';

interface Props {
  tenantId: string;
  session?: AuthSession;
}

export const AdminPrescriptions: React.FC<Props> = ({ tenantId, session }) => {
  const [prescriptions, setPrescriptions] = useState<MedicalPrescription[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPrescription, setSelectedPrescription] = useState<MedicalPrescription | null>(null);
  const [rejectionNotes, setRejectionNotes] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [filter, setFilter] = useState("PENDING");

  const fetchPrescriptions = async () => {
    setIsLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      } else {
        const localToken = localStorage.getItem('farmaflow_admin_token');
        if (localToken) {
          headers["Authorization"] = `Bearer ${localToken}`;
        }
      }

      const res = await fetch(`/api/v1/tenants/${tenantId}/prescriptions?status=${filter}`, {
        headers
      });
      const data = await res.json();
      if (data.success) {
        setPrescriptions(data.data || []);
      }
    } catch (e) {
      console.error(e);
      toast.error('Erro ao carregar receitas');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPrescriptions();
  }, [tenantId, filter, session]);

  const updateStatus = async (id: string, status: "APPROVED" | "REJECTED") => {
    if (status === "REJECTED" && !rejectionNotes) {
      toast.error("Por favor, informe o motivo da rejeição");
      return;
    }
    
    setIsUpdating(true);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      } else {
        const localToken = localStorage.getItem('farmaflow_admin_token');
        if (localToken) {
          headers["Authorization"] = `Bearer ${localToken}`;
        }
      }

      const res = await fetch(`/api/v1/tenants/${tenantId}/prescriptions/${id}/status`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status, notes: status === "REJECTED" ? rejectionNotes : null })
      });
      const data = await res.json();
      
      if (data.success) {
        toast.success(`Receita ${status === "APPROVED" ? "aprovada" : "rejeitada"} com sucesso`);
        setSelectedPrescription(null);
        setRejectionNotes("");
        fetchPrescriptions();
        // Invalidate global orders state using SWR
        mutate(`orders-trigger-${tenantId}`);
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error(error);
      toast.error("Erro ao atualizar status");
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="p-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">Validação de Receitas</h1>
          <p className="text-gray-500 font-medium">Analise as receitas médicas enviadas pelos clientes na loja virtual.</p>
        </div>
        
        <div className="flex bg-white rounded-full p-1 border border-gray-200 shadow-sm">
          {["PENDING", "APPROVED", "REJECTED"].map(status => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${
                filter === status 
                  ? 'bg-blue-600 text-white shadow-md' 
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {status === "PENDING" ? "Pendentes" : status === "APPROVED" ? "Aprovadas" : "Rejeitadas"}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center py-20">
          <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
        </div>
      ) : prescriptions.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-gray-300">
          <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-gray-900 mb-1">Nenhuma receita encontrada</h3>
          <p className="text-gray-500">Não há receitas com o status selecionado no momento.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {prescriptions.map(p => (
            <div key={p.id} className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 hover:shadow-md transition-all">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider mb-3 ${
                    p.status === "PENDING" ? "bg-amber-100 text-amber-700" :
                    p.status === "APPROVED" ? "bg-green-100 text-green-700" :
                    "bg-red-100 text-red-700"
                  }`}>
                    {p.status === "PENDING" && <AlertTriangle size={12} />}
                    {p.status === "APPROVED" && <CheckCircle size={12} />}
                    {p.status === "REJECTED" && <X size={12} />}
                    {p.status}
                  </span>
                  <p className="text-sm font-bold text-gray-900">Pedido #{p.order_id || "Não finalizado"}</p>
                  <p className="text-xs text-gray-500 mt-1">{new Date(p.created_at || "").toLocaleString("pt-BR")}</p>
                </div>
              </div>
              
              <button 
                onClick={() => setSelectedPrescription(p)}
                className="w-full mt-4 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
              >
                <Eye size={18} />
                Analisar Receita
              </button>
            </div>
          ))}
        </div>
      )}

      {selectedPrescription && (
        <div className="fixed inset-0 z-[200] bg-black/80 flex flex-col md:flex-row items-center justify-center p-4 backdrop-blur-sm">
          <div className="w-full md:w-2/3 h-full max-h-[80vh] flex flex-col relative bg-black rounded-3xl overflow-hidden border border-gray-800">
             <div className="absolute top-4 right-4 z-10 flex gap-2">
                <a href={selectedPrescription.file_url} target="_blank" rel="noopener noreferrer" className="bg-white/10 hover:bg-white/20 text-white p-3 rounded-full backdrop-blur-md transition-colors">
                  <Download size={20} />
                </a>
                <button onClick={() => setSelectedPrescription(null)} className="bg-white/10 hover:bg-white/20 text-white p-3 rounded-full backdrop-blur-md transition-colors">
                  <X size={20} />
                </button>
             </div>
             
             {selectedPrescription.file_url.toLowerCase().endsWith('.pdf') ? (
               <iframe src={selectedPrescription.file_url} className="w-full h-full border-0 bg-white" title="PDF da Receita" />
             ) : (
               <div className="w-full h-full flex items-center justify-center overflow-auto p-4">
                 <img src={selectedPrescription.file_url} alt="Receita" className="max-w-full max-h-full object-contain rounded-xl" />
               </div>
             )}
          </div>
          
          <div className="w-full md:w-1/3 bg-white p-8 md:rounded-r-3xl h-full max-h-[80vh] overflow-y-auto mt-4 md:mt-0 flex flex-col">
            <h3 className="text-xl font-black text-gray-900 mb-6">Ação do Farmacêutico</h3>
            
            {selectedPrescription.status === "PENDING" ? (
              <div className="space-y-6 flex-1">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Motivo da Rejeição (se houver)</label>
                  <textarea 
                    value={rejectionNotes}
                    onChange={e => setRejectionNotes(e.target.value)}
                    placeholder="Ex: Receita vencida, falha na assinatura..."
                    className="w-full border-2 border-gray-200 rounded-xl p-4 min-h-[120px] outline-none focus:border-red-500 transition-colors"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4 mt-auto">
                   <button 
                     disabled={isUpdating}
                     onClick={() => updateStatus(selectedPrescription.id, "REJECTED")}
                     className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 py-4 rounded-2xl font-black uppercase tracking-wider text-sm transition-colors flex items-center justify-center gap-2"
                   >
                     <X size={18} /> Rejeitar
                   </button>
                   <button 
                     disabled={isUpdating}
                     onClick={() => updateStatus(selectedPrescription.id, "APPROVED")}
                     className="bg-green-600 hover:bg-green-700 text-white py-4 rounded-2xl font-black uppercase tracking-wider text-sm shadow-lg shadow-green-200 transition-colors flex items-center justify-center gap-2"
                   >
                     <Check size={18} /> Aprovar
                   </button>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className={`p-5 rounded-2xl border ${selectedPrescription.status === "APPROVED" ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
                  <h4 className={`font-black uppercase tracking-wider text-sm mb-2 ${selectedPrescription.status === "APPROVED" ? "text-green-800" : "text-red-800"}`}>
                    Receita {selectedPrescription.status === "APPROVED" ? "Aprovada" : "Rejeitada"}
                  </h4>
                  {selectedPrescription.notes && (
                     <p className="text-gray-700 text-sm mt-3">
                       <strong className="block text-xs uppercase text-gray-500 mb-1">Observações:</strong>
                       {selectedPrescription.notes}
                     </p>
                  )}
                </div>
                <button 
                  onClick={() => setSelectedPrescription(null)}
                  className="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-4 rounded-2xl transition-colors"
                >
                  Voltar para a lista
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
