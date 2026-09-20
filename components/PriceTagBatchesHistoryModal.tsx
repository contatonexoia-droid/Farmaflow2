import React, { useState } from 'react';
import { 
  X, 
  RotateCcw, 
  Trash2, 
  Clock, 
  Printer, 
  Calendar, 
  AlertCircle, 
  RefreshCw, 
  ChevronDown, 
  ChevronUp,
  FileText,
  Sparkles,
  CheckCircle2
} from 'lucide-react';
import { 
  PriceTagBatch, 
  formatTimeRemaining, 
  formatBatchDateTime, 
  getModelBadgeInfo 
} from '../services/priceTagBatchService';

interface PriceTagBatchesHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  batches: PriceTagBatch[];
  isLoading: boolean;
  onRefresh: () => void;
  onReprintBatch: (batch: PriceTagBatch) => void;
  onDeleteBatch: (batchId: string) => void;
}

export const PriceTagBatchesHistoryModal: React.FC<PriceTagBatchesHistoryModalProps> = ({
  isOpen,
  onClose,
  batches,
  isLoading,
  onRefresh,
  onReprintBatch,
  onDeleteBatch,
}) => {
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (!isOpen) return null;

  const toggleExpand = (id: string) => {
    setExpandedBatchId((prev) => (prev === id ? null : id));
  };

  const handleDelete = async (batchId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Tem certeza que deseja remover este lote do histórico?')) {
      setDeletingId(batchId);
      try {
        await onDeleteBatch(batchId);
      } finally {
        setDeletingId(null);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-gray-950/70 backdrop-blur-xs animate-in fade-in duration-150 print:hidden">
      <div 
        className="bg-white w-full max-w-4xl max-h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-gray-100 animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
      >
        {/* Topbar do Modal */}
        <div className="p-5 sm:p-6 border-b border-gray-100 flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <Clock size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-black text-gray-900 tracking-tight">
                  Histórico & Reimpressão de Lotes
                </h3>
                <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                  TTL 48 Horas
                </span>
              </div>
              <p className="text-xs text-gray-500 font-medium mt-0.5">
                Lotes gerados nas últimas 48h prontos para reimpressão imediata com 1 clique.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="p-2 text-gray-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
              title="Atualizar lista"
            >
              <RefreshCw size={18} className={isLoading ? 'animate-spin text-emerald-600' : ''} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-colors cursor-pointer"
              title="Fechar"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Informação sobre Auto-Limpeza */}
        <div className="bg-emerald-50/70 border-b border-emerald-100/80 px-6 py-2.5 flex items-center justify-between text-xs text-emerald-800 font-medium shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-emerald-600 shrink-0" />
            <span>
              Limpeza automática: registros com mais de <strong>48 horas</strong> são descartados sem sobrecarregar o banco.
            </span>
          </div>
          <span className="font-bold text-[11px] bg-white px-2 py-0.5 rounded-md border border-emerald-200 text-emerald-700">
            {batches.length} lote(s) ativo(s)
          </span>
        </div>

        {/* Corpo com a Lista de Lotes */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-gray-50/60 custom-scrollbar space-y-3">
          {isLoading && batches.length === 0 ? (
            <div className="py-16 text-center">
              <RefreshCw size={32} className="mx-auto text-emerald-600 animate-spin mb-3" />
              <p className="text-sm font-bold text-gray-600">Carregando histórico das últimas 48h...</p>
            </div>
          ) : batches.length === 0 ? (
            <div className="py-16 px-4 text-center border-2 border-dashed border-gray-200 rounded-3xl bg-white">
              <Clock size={42} className="mx-auto text-gray-300 mb-3" />
              <h4 className="text-base font-black text-gray-800">Nenhum lote registrado nas últimas 48 horas</h4>
              <p className="text-xs text-gray-500 max-w-md mx-auto mt-1.5 leading-relaxed">
                Ao imprimir ou gerar folhas de etiquetas, um snapshot é automaticamente gravado aqui para que você possa reimprimir rapidamente em caso de perda ou falha de impressora.
              </p>
            </div>
          ) : (
            batches.map((batch) => {
              const badgeInfo = getModelBadgeInfo(batch.model);
              const timeRemaining = formatTimeRemaining(batch.created_at);
              const isExpanded = expandedBatchId === batch.id;
              const isDeleting = deletingId === batch.id;
              const distinctProductsCount = batch.items ? batch.items.length : 0;

              return (
                <div
                  key={batch.id}
                  className="bg-white rounded-2xl border border-gray-200/90 shadow-2xs hover:border-emerald-300 transition-all overflow-hidden"
                >
                  <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    {/* Metadados do Lote */}
                    <div className="space-y-2 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-[11px] font-black uppercase px-2.5 py-0.5 rounded-lg border ${badgeInfo.colorClass}`}>
                          {badgeInfo.label}
                        </span>
                        
                        <span className="text-xs font-bold text-gray-700 flex items-center gap-1">
                          <Calendar size={13} className="text-gray-400" />
                          {formatBatchDateTime(batch.created_at)}
                        </span>

                        <span
                          className={`text-[11px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 ${
                            timeRemaining.isUrgent
                              ? 'bg-amber-100 text-amber-800 border border-amber-200 animate-pulse'
                              : 'bg-slate-100 text-slate-700 border border-slate-200'
                          }`}
                        >
                          <Clock size={11} />
                          {timeRemaining.text}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-xs text-gray-600 font-medium">
                        <span>
                          Total de etiquetas:{' '}
                          <strong className="text-gray-900 font-black">{batch.total_tags}</strong>
                        </span>
                        <span>•</span>
                        <span>
                          Produtos distintos:{' '}
                          <strong className="text-gray-900 font-black">{distinctProductsCount}</strong>
                        </span>
                      </div>

                      {/* Mini preview dos primeiros produtos */}
                      {batch.items && batch.items.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          {batch.items.slice(0, 3).map((item, idx) => (
                            <span
                              key={`${batch.id}-item-${idx}`}
                              className="text-[11px] bg-gray-50 border border-gray-200 text-gray-700 px-2 py-0.5 rounded-md max-w-[200px] truncate"
                              title={item.productName}
                            >
                              {item.productName}
                            </span>
                          ))}
                          {batch.items.length > 3 && (
                            <span className="text-[10px] text-gray-400 font-bold">
                              +{batch.items.length - 3} outros
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Ações do Lote */}
                    <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-100">
                      <button
                        type="button"
                        onClick={() => toggleExpand(batch.id)}
                        className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-colors cursor-pointer text-xs font-bold flex items-center gap-1"
                        title="Ver produtos deste lote"
                      >
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        <span className="hidden sm:inline">Detalhes</span>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => handleDelete(batch.id, e)}
                        disabled={isDeleting}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                        title="Excluir este lote do histórico"
                      >
                        <Trash2 size={16} />
                      </button>

                      <button
                        type="button"
                        onClick={() => onReprintBatch(batch)}
                        className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition-all active:scale-95 cursor-pointer"
                      >
                        <RotateCcw size={14} />
                        <span>Reimprimir</span>
                      </button>
                    </div>
                  </div>

                  {/* Detalhes Expandidos com lista completa */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 bg-gray-50/70 p-4 sm:p-5">
                      <h5 className="text-xs font-black text-gray-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <FileText size={14} className="text-emerald-600" />
                        Itens Gravados no Lote ({batch.items.length})
                      </h5>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
                        {batch.items.map((item, idx) => (
                          <div
                            key={`detail-${batch.id}-${idx}`}
                            className="bg-white p-2.5 rounded-xl border border-gray-200/80 flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="font-bold text-gray-900 truncate">{item.productName}</p>
                              <div className="flex items-center gap-2 text-[10px] text-gray-400">
                                {item.barcode && <span>EAN: {item.barcode}</span>}
                                {item.badgeText && (
                                  <span className="text-amber-700 font-bold uppercase bg-amber-50 px-1 rounded-xs">
                                    {item.badgeText}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="font-black text-emerald-700">
                                R$ {Number(item.promotionalPrice || item.originalPrice || 0).toFixed(2).replace('.', ',')}
                              </p>
                              <p className="text-[10px] text-gray-400 font-bold">
                                {item.quantity} cópia(s)
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Rodapé do Modal */}
        <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between shrink-0">
          <span className="text-xs text-gray-500">
            A reimpressão carrega o snapshot exato dos preços, chamadas e layout definidos na época.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold text-gray-700 bg-white border border-gray-200 hover:bg-gray-100 transition-colors cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
