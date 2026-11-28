import React, { useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  X,
  CheckCircle2,
  AlertTriangle,
  Database,
  Loader2,
  PauseCircle,
  Play,
  SlidersHorizontal,
  PackageCheck,
  ShieldCheck,
  AlertCircle,
  Zap,
  RotateCcw,
} from 'lucide-react';
import { Product } from '../types';
import { OFFICIAL_DEPARTMENTS } from '../lib/departments';
import {
  ALL_ENRICHABLE_FIELDS,
  ENRICHABLE_FIELD_LABELS,
  EnrichableFieldKey,
  getCatalogCompletenessStats,
  getMissingEnrichableFields,
  isMedicationProduct,
  isProductIncomplete,
  resolveProductOfficialDepartment,
} from '../utils/productCompleteness';
import {
  CatalogMiniBatchOutcome,
  enrichCatalogMiniBatch,
} from '../services/gemini';
import { patchCachedProductsForTenant } from '../services/storage';

interface CatalogAiEnrichmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  products: Product[];
  selectedProductIds: Set<string>;
  onProductsMerged: (updatedProducts: Product[]) => void;
}

type EnrichmentScope = 'incomplete' | 'selected' | 'all';
type ModalStage = 'config' | 'running' | 'report';

const QUANTITY_PRESETS = [20, 50, 100, 250, 500];
const MINI_BATCH_SIZE = 5;

export const CatalogAiEnrichmentModal: React.FC<CatalogAiEnrichmentModalProps> = ({
  isOpen,
  onClose,
  tenantId,
  products,
  selectedProductIds,
  onProductsMerged,
}) => {
  const [stage, setStage] = useState<ModalStage>('config');
  const [scope, setScope] = useState<EnrichmentScope>('incomplete');
  const [departmentFilter, setDepartmentFilter] = useState<string>('Todos');
  const [prioritizeInStock, setPrioritizeInStock] = useState<boolean>(true);
  const [overwriteExisting, setOverwriteExisting] = useState<boolean>(false);
  const [targetFields, setTargetFields] = useState<EnrichableFieldKey[]>([
    ...ALL_ENRICHABLE_FIELDS,
  ]);
  const [quantityLimit, setQuantityLimit] = useState<number>(50);

  // Runtime state
  const [totalQueued, setTotalQueued] = useState<number>(0);
  const [processedCount, setProcessedCount] = useState<number>(0);
  const [currentBatchNames, setCurrentBatchNames] = useState<string[]>([]);
  const [outcomes, setOutcomes] = useState<CatalogMiniBatchOutcome[]>([]);
  const [wasCancelled, setWasCancelled] = useState<boolean>(false);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const cancelledFlagRef = useRef<boolean>(false);

  const stats = useMemo(() => getCatalogCompletenessStats(products), [products]);

  const eligibleProducts = useMemo(() => {
    const selectedTargetFields =
      targetFields.length > 0 ? targetFields : ALL_ENRICHABLE_FIELDS;

    let pool = products.filter((p) => {
      if (!p || !p.id || !p.name || !p.name.trim()) return false;

      if (scope === 'selected' && !selectedProductIds.has(p.id)) {
        return false;
      }

      if (departmentFilter !== 'Todos') {
        const dept = resolveProductOfficialDepartment(p);
        if (dept !== departmentFilter) return false;
      }

      if (scope === 'incomplete') {
        if (overwriteExisting) {
          return isProductIncomplete(p, selectedTargetFields);
        }
        return getMissingEnrichableFields(p, selectedTargetFields).length > 0;
      }

      // Em 'selected' ou 'all': se overwriteExisting=false, ainda exige pelo menos 1 campo faltante ou não bloqueia se usuário selecionou explicitamente quando overwrite=true
      if (!overwriteExisting) {
        return getMissingEnrichableFields(p, selectedTargetFields).length > 0;
      }

      // Se overwriteExisting=true e selecionou apenas activePrinciple, não incluir não-medicamentos sem necessidade
      if (
        selectedTargetFields.length === 1 &&
        selectedTargetFields[0] === 'activePrinciple' &&
        !isMedicationProduct(p)
      ) {
        return false;
      }

      return true;
    });

    if (prioritizeInStock) {
      pool = [...pool].sort((a, b) => {
        const aInStock = Number(a.stock) > 0 ? 1 : 0;
        const bInStock = Number(b.stock) > 0 ? 1 : 0;
        if (aInStock !== bInStock) return bInStock - aInStock;
        return Number(b.stock || 0) - Number(a.stock || 0);
      });
    }

    return pool;
  }, [
    products,
    scope,
    selectedProductIds,
    departmentFilter,
    targetFields,
    overwriteExisting,
    prioritizeInStock,
  ]);

  const eligibleInStockCount = useMemo(
    () => eligibleProducts.filter((p) => Number(p.stock) > 0).length,
    [eligibleProducts]
  );

  const queueToRun = useMemo(() => {
    const safeLimit = Math.max(1, Math.min(Number(quantityLimit) || 1, eligibleProducts.length));
    return eligibleProducts.slice(0, safeLimit);
  }, [eligibleProducts, quantityLimit]);

  const summary = useMemo(() => {
    let updated = 0;
    let reusedCache = 0;
    let skippedLow = 0;
    let errors = 0;
    let anvisaHits = 0;

    for (const o of outcomes) {
      if (o.anvisaMatched) anvisaHits++;
      if (o.status === 'updated') updated++;
      else if (o.status === 'reused_cache') reusedCache++;
      else if (o.status === 'skipped_low_confidence') skippedLow++;
      else if (o.status === 'error') errors++;
    }

    return { updated, reusedCache, skippedLow, errors, anvisaHits };
  }, [outcomes]);

  const reviewableOutcomes = useMemo(
    () =>
      outcomes.filter(
        (o) => o.status === 'skipped_low_confidence' || o.status === 'error'
      ),
    [outcomes]
  );

  if (!isOpen) return null;

  const toggleTargetField = (field: EnrichableFieldKey) => {
    setTargetFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    );
  };

  const handleStartEnrichment = async () => {
    if (targetFields.length === 0 || queueToRun.length === 0) return;

    const batchList = [...queueToRun];
    cancelledFlagRef.current = false;
    abortControllerRef.current = new AbortController();

    setStage('running');
    setTotalQueued(batchList.length);
    setProcessedCount(0);
    setOutcomes([]);
    setWasCancelled(false);
    setFatalError(null);

    const productById = new Map<string, Product>();
    batchList.forEach((p) => productById.set(p.id, p));

    try {
      for (let i = 0; i < batchList.length; i += MINI_BATCH_SIZE) {
        if (cancelledFlagRef.current) {
          setWasCancelled(true);
          break;
        }

        const slice = batchList.slice(i, i + MINI_BATCH_SIZE);
        setCurrentBatchNames(slice.map((p) => p.name));

        const payload = slice.map((p) => ({
          id: p.id,
          name: p.name,
          missingFields: overwriteExisting
            ? targetFields
            : getMissingEnrichableFields(p, targetFields),
          barcode: p.barcode || '',
          manufacturer: p.manufacturer || '',
          category: p.category || '',
          department: resolveProductOfficialDepartment(p),
          presentation: p.presentation || '',
          activePrinciple: p.activePrinciple || '',
          drugType: p.drugType || '',
          description: p.description || '',
          indications: p.indications || '',
          usage: p.usage || '',
          requires_prescription: Boolean(p.requires_prescription),
          isAiEnriched: Boolean(p.isAiEnriched),
        }));

        const response = await enrichCatalogMiniBatch({
          tenantId,
          products: payload,
          targetFields,
          overwriteExisting,
          persist: true,
          signal: abortControllerRef.current?.signal,
        });

        const batchOutcomes = response.outcomes || [];
        setOutcomes((prev) => [...prev, ...batchOutcomes]);

        // Sincroniza estado React + localforage imediatamente após cada mini-lote de 5
        const mergedForState: Product[] = [];
        batchOutcomes.forEach((outcome) => {
          if (outcome.status !== 'updated' && outcome.status !== 'reused_cache') return;
          const orig = productById.get(outcome.id);
          if (!orig) return;
          const patch = outcome.patch || {};
          mergedForState.push({
            ...orig,
            ...(patch.description !== undefined ? { description: patch.description } : {}),
            ...(patch.activePrinciple !== undefined
              ? { activePrinciple: patch.activePrinciple }
              : {}),
            ...(patch.presentation !== undefined
              ? { presentation: patch.presentation }
              : {}),
            ...(patch.indications !== undefined
              ? { indications: patch.indications }
              : {}),
            ...(patch.usage !== undefined ? { usage: patch.usage } : {}),
            ...(patch.drugType !== undefined ? { drugType: patch.drugType } : {}),
            ...(patch.category !== undefined ? { category: patch.category } : {}),
            ...(patch.manufacturer !== undefined
              ? { manufacturer: patch.manufacturer }
              : {}),
            requires_prescription: Boolean(
              orig.requires_prescription || patch.requires_prescription
            ),
            isAiEnriched: true,
          });
        });

        if (mergedForState.length > 0) {
          onProductsMerged(mergedForState);
          await patchCachedProductsForTenant(tenantId, mergedForState);
        }

        setProcessedCount(Math.min(i + slice.length, batchList.length));

        if (i + MINI_BATCH_SIZE < batchList.length && !cancelledFlagRef.current) {
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || cancelledFlagRef.current) {
        setWasCancelled(true);
      } else {
        const msg =
          err?.message === 'LIMITE_IA_ATINGIDO'
            ? 'Limite temporário da API de IA atingido. Os lotes anteriores já foram salvos com segurança.'
            : err?.message || 'Erro durante o processamento em lote com IA.';
        setFatalError(msg);
      }
    } finally {
      setCurrentBatchNames([]);
      abortControllerRef.current = null;
      setStage('report');
    }
  };

  const handlePauseOrCancel = () => {
    cancelledFlagRef.current = true;
    abortControllerRef.current?.abort();
  };

  const handleSafeClose = () => {
    if (stage === 'running') {
      handlePauseOrCancel();
    }
    setStage('config');
    onClose();
  };

  const progressPercent =
    totalQueued > 0 ? Math.min(100, Math.round((processedCount / totalQueued) * 100)) : 0;

  return (
    <div className="fixed inset-0 z-[160] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-4xl rounded-[2.5rem] shadow-2xl border border-gray-100 overflow-hidden my-auto animate-in zoom-in-95">
        {/* Header */}
        <div className="px-8 py-6 bg-gradient-to-r from-indigo-600 via-purple-600 to-fuchsia-600 text-white flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center shrink-0">
              <Sparkles size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-black tracking-tight">
                Enriquecimento Inteligente do Catálogo (IA)
              </h2>
              <p className="text-xs font-bold text-white/80 uppercase tracking-widest mt-0.5">
                Conversão, Bula, Modo de Uso e Padronização DCB Anti-Erro
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSafeClose}
            className="p-2.5 rounded-2xl bg-white/15 hover:bg-white/25 text-white transition-all"
            title="Fechar"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 md:p-8 max-h-[82vh] overflow-y-auto space-y-6">
          {/* Diagnóstico em Tempo Real */}
          <div className="bg-gray-50 rounded-3xl p-5 border border-gray-100 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-xs font-black uppercase tracking-widest text-gray-500 flex items-center gap-2">
                <Database size={15} className="text-indigo-600" />
                Diagnóstico Real do Catálogo ({stats.total} produtos)
              </h3>
              <span className="text-xs font-black px-3 py-1 rounded-xl bg-amber-100 text-amber-800">
                {stats.incomplete} incompletos no momento
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
              <div className="bg-white p-3 rounded-2xl border border-gray-200/80">
                <span className="block text-[10px] font-black uppercase text-gray-400">
                  Incompletos
                </span>
                <span className="text-lg font-black text-amber-600">{stats.incomplete}</span>
              </div>
              <div className="bg-white p-3 rounded-2xl border border-gray-200/80">
                <span className="block text-[10px] font-black uppercase text-gray-400">
                  Sem Descrição
                </span>
                <span className="text-lg font-black text-gray-900">
                  {stats.missingDescription}
                </span>
              </div>
              <div className="bg-white p-3 rounded-2xl border border-gray-200/80">
                <span className="block text-[10px] font-black uppercase text-gray-400">
                  Sem Ativo (Med)
                </span>
                <span className="text-lg font-black text-gray-900">
                  {stats.missingActivePrinciple}
                </span>
              </div>
              <div className="bg-white p-3 rounded-2xl border border-gray-200/80">
                <span className="block text-[10px] font-black uppercase text-gray-400">
                  Sem Apresentação
                </span>
                <span className="text-lg font-black text-gray-900">
                  {stats.missingPresentation}
                </span>
              </div>
              <div className="bg-white p-3 rounded-2xl border border-gray-200/80">
                <span className="block text-[10px] font-black uppercase text-gray-400">
                  Sem Indicações
                </span>
                <span className="text-lg font-black text-gray-900">
                  {stats.missingIndications}
                </span>
              </div>
              <div className="bg-white p-3 rounded-2xl border border-gray-200/80">
                <span className="block text-[10px] font-black uppercase text-gray-400">
                  Sem Modo de Uso
                </span>
                <span className="text-lg font-black text-gray-900">{stats.missingUsage}</span>
              </div>
            </div>
          </div>

          {stage === 'config' && (
            <>
              {/* Escopo + Departamento */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-3">
                  <label className="block text-xs font-black uppercase tracking-widest text-gray-500">
                    1. Escopo de Produtos
                  </label>
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setScope('incomplete')}
                      className={`w-full text-left p-3.5 rounded-2xl border-2 transition-all flex items-center justify-between ${
                        scope === 'incomplete'
                          ? 'border-purple-600 bg-purple-50/70'
                          : 'border-gray-200 bg-white hover:border-purple-200'
                      }`}
                    >
                      <div>
                        <p className="text-sm font-black text-gray-900">
                          Somente Produtos Incompletos
                        </p>
                        <p className="text-xs font-medium text-gray-500">
                          Preenche apenas o que está vazio segundo os campos selecionados
                        </p>
                      </div>
                      <span className="text-xs font-black px-2.5 py-1 rounded-lg bg-purple-100 text-purple-700">
                        {stats.incomplete}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setScope('selected')}
                      className={`w-full text-left p-3.5 rounded-2xl border-2 transition-all flex items-center justify-between ${
                        scope === 'selected'
                          ? 'border-purple-600 bg-purple-50/70'
                          : 'border-gray-200 bg-white hover:border-purple-200'
                      }`}
                    >
                      <div>
                        <p className="text-sm font-black text-gray-900">
                          Somente Selecionados na Lista
                        </p>
                        <p className="text-xs font-medium text-gray-500">
                          Processa os itens marcados na tabela de produtos
                        </p>
                      </div>
                      <span className="text-xs font-black px-2.5 py-1 rounded-lg bg-gray-100 text-gray-700">
                        {selectedProductIds.size}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setScope('all')}
                      className={`w-full text-left p-3.5 rounded-2xl border-2 transition-all flex items-center justify-between ${
                        scope === 'all'
                          ? 'border-purple-600 bg-purple-50/70'
                          : 'border-gray-200 bg-white hover:border-purple-200'
                      }`}
                    >
                      <div>
                        <p className="text-sm font-black text-gray-900">
                          Todo o Catálogo Elegível
                        </p>
                        <p className="text-xs font-medium text-gray-500">
                          Ideal junto com a opção de sobrescrever ou filtrar por departamento
                        </p>
                      </div>
                      <span className="text-xs font-black px-2.5 py-1 rounded-lg bg-gray-100 text-gray-700">
                        {products.length}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Filtros e Toggles */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="block text-xs font-black uppercase tracking-widest text-gray-500">
                      2. Departamento & Prioridades
                    </label>
                    <select
                      value={departmentFilter}
                      onChange={(e) => setDepartmentFilter(e.target.value)}
                      className="w-full bg-gray-50 border-2 border-gray-200 rounded-2xl px-4 py-3 text-sm font-bold text-gray-900 focus:border-purple-600 focus:bg-white outline-none"
                    >
                      <option value="Todos">Todos os Departamentos</option>
                      {OFFICIAL_DEPARTMENTS.map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                    </select>
                  </div>

                  <label className="flex items-start gap-3 p-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={prioritizeInStock}
                      onChange={(e) => setPrioritizeInStock(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-emerald-600 rounded"
                    />
                    <div>
                      <span className="block text-sm font-black text-emerald-950">
                        Priorizar produtos com estoque &gt; 0
                      </span>
                      <span className="block text-xs font-medium text-emerald-700">
                        Enriquece primeiro os itens disponíveis para venda na loja online ({eligibleInStockCount} com estoque).
                      </span>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 p-3.5 rounded-2xl bg-amber-50/70 border border-amber-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={overwriteExisting}
                      onChange={(e) => setOverwriteExisting(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-amber-600 rounded"
                    />
                    <div>
                      <span className="block text-sm font-black text-amber-950">
                        Sobrescrever campos já preenchidos
                      </span>
                      <span className="block text-xs font-medium text-amber-800">
                        Desativado por padrão. Marcações manuais de receita controlada nunca são removidas.
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Campos alvo */}
              <div className="space-y-2.5">
                <label className="block text-xs font-black uppercase tracking-widest text-gray-500">
                  3. Campos a Preencher / Otimizar
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
                  {ALL_ENRICHABLE_FIELDS.map((field) => {
                    const active = targetFields.includes(field);
                    return (
                      <button
                        key={field}
                        type="button"
                        onClick={() => toggleTargetField(field)}
                        className={`px-3.5 py-3 rounded-2xl border-2 text-xs font-black transition-all flex items-center justify-center gap-2 ${
                          active
                            ? 'border-indigo-600 bg-indigo-50 text-indigo-800'
                            : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300'
                        }`}
                      >
                        <CheckCircle2
                          size={14}
                          className={active ? 'text-indigo-600' : 'text-gray-300'}
                        />
                        {ENRICHABLE_FIELD_LABELS[field]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Controle de Quantidade */}
              <div className="bg-indigo-50/60 border border-indigo-100 rounded-3xl p-5 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <label className="text-xs font-black uppercase tracking-widest text-indigo-900 flex items-center gap-2">
                    <SlidersHorizontal size={15} className="text-indigo-600" />
                    4. Quantidade Máxima neste Lote
                  </label>
                  <span className="text-xs font-black text-indigo-700">
                    {eligibleProducts.length} elegíveis • serão processados {queueToRun.length} produtos
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  {QUANTITY_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setQuantityLimit(preset)}
                      className={`px-4 py-2.5 rounded-xl text-xs font-black border-2 transition-all ${
                        quantityLimit === preset
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                          : 'bg-white text-gray-700 border-gray-200 hover:border-indigo-300'
                      }`}
                    >
                      {preset} itens
                    </button>
                  ))}

                  <div className="flex items-center gap-2 ml-auto bg-white border-2 border-indigo-200 rounded-xl px-3 py-1.5">
                    <span className="text-[11px] font-black uppercase text-gray-400">
                      Personalizado:
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={Math.max(1, eligibleProducts.length)}
                      value={quantityLimit}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setQuantityLimit(Number.isFinite(val) && val > 0 ? val : 1);
                      }}
                      className="w-20 text-sm font-black text-gray-900 outline-none text-right"
                    />
                  </div>
                </div>
              </div>

              {/* Aviso anti-erro */}
              <div className="flex items-start gap-3 p-4 rounded-2xl bg-gray-50 border border-gray-200 text-xs text-gray-600 font-medium">
                <ShieldCheck size={18} className="text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  <strong className="text-gray-900">Proteção Anti-Erro em 5 Camadas:</strong>{' '}
                  cruzamento por EAN na base ANVISA e cache validado (0 tokens), verificação rígida de ID e nome por mini-lote de 5 itens, bloqueio automático de confiança baixa e preservação de dados manuais.
                </span>
              </div>

              {/* Ações */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleSafeClose}
                  className="px-6 py-3.5 rounded-2xl font-black text-xs uppercase tracking-wide bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={queueToRun.length === 0 || targetFields.length === 0}
                  onClick={handleStartEnrichment}
                  className="px-7 py-3.5 rounded-2xl font-black text-xs uppercase tracking-wide bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg hover:opacity-95 disabled:opacity-40 transition-all flex items-center gap-2"
                >
                  <Play size={16} />
                  Iniciar Enriquecimento ({queueToRun.length})
                </button>
              </div>
            </>
          )}

          {stage === 'running' && (
            <div className="space-y-6 py-2">
              <div className="bg-purple-50 border border-purple-200 rounded-3xl p-6 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <Loader2 size={24} className="animate-spin text-purple-600" />
                    <div>
                      <h4 className="text-base font-black text-gray-900">
                        Processando Mini-Lotes Seguros (5 por vez)
                      </h4>
                      <p className="text-xs font-bold text-purple-700">
                        {processedCount} de {totalQueued} produtos analisados ({progressPercent}%)
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handlePauseOrCancel}
                    className="px-4 py-2.5 rounded-xl bg-red-600 text-white text-xs font-black uppercase tracking-wide hover:bg-red-700 transition-all flex items-center gap-2"
                  >
                    <PauseCircle size={16} />
                    Pausar / Cancelar
                  </button>
                </div>

                <progress
                  value={progressPercent}
                  max={100}
                  className="w-full h-3 rounded-full overflow-hidden [&::-webkit-progress-bar]:bg-purple-100 [&::-webkit-progress-value]:bg-purple-600"
                />

                {currentBatchNames.length > 0 && (
                  <div className="text-xs font-medium text-gray-600 bg-white/80 p-3 rounded-2xl border border-purple-100">
                    <span className="font-black text-purple-800 uppercase text-[10px] block mb-1">
                      Lote Atual:
                    </span>
                    {currentBatchNames.join(' • ')}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-200">
                  <span className="block text-[10px] font-black uppercase text-emerald-700">
                    Enriquecidos IA
                  </span>
                  <span className="text-2xl font-black text-emerald-900">
                    {summary.updated}
                  </span>
                </div>
                <div className="bg-blue-50 p-4 rounded-2xl border border-blue-200">
                  <span className="block text-[10px] font-black uppercase text-blue-700">
                    Cache EAN (0 Tokens)
                  </span>
                  <span className="text-2xl font-black text-blue-900">
                    {summary.reusedCache}
                  </span>
                </div>
                <div className="bg-amber-50 p-4 rounded-2xl border border-amber-200">
                  <span className="block text-[10px] font-black uppercase text-amber-700">
                    Bloqueados (Baixa Conf.)
                  </span>
                  <span className="text-2xl font-black text-amber-900">
                    {summary.skippedLow}
                  </span>
                </div>
                <div className="bg-red-50 p-4 rounded-2xl border border-red-200">
                  <span className="block text-[10px] font-black uppercase text-red-700">
                    Erros
                  </span>
                  <span className="text-2xl font-black text-red-900">{summary.errors}</span>
                </div>
              </div>
            </div>
          )}

          {stage === 'report' && (
            <div className="space-y-5">
              <div
                className={`p-5 rounded-3xl border flex items-start gap-3 ${
                  fatalError
                    ? 'bg-red-50 border-red-200 text-red-800'
                    : wasCancelled
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                }`}
              >
                {fatalError ? (
                  <AlertCircle size={22} className="shrink-0 mt-0.5 text-red-600" />
                ) : wasCancelled ? (
                  <AlertTriangle size={22} className="shrink-0 mt-0.5 text-amber-600" />
                ) : (
                  <PackageCheck size={22} className="shrink-0 mt-0.5 text-emerald-600" />
                )}
                <div>
                  <h4 className="font-black text-base">
                    {fatalError
                      ? 'Processamento Interrompido'
                      : wasCancelled
                      ? 'Processamento Pausado pelo Usuário'
                      : 'Enriquecimento Concluído e Salvo no Catálogo'}
                  </h4>
                  <p className="text-xs font-medium mt-0.5">
                    {fatalError ||
                      `${processedCount} de ${totalQueued} itens avaliados (${summary.anvisaHits} validados diretamente por EAN na base ANVISA). Todos os mini-lotes concluídos foram salvos no banco.`}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-200">
                  <span className="block text-[10px] font-black uppercase text-emerald-700">
                    Atualizados via IA
                  </span>
                  <span className="text-2xl font-black text-emerald-900">
                    {summary.updated}
                  </span>
                </div>
                <div className="bg-blue-50 p-4 rounded-2xl border border-blue-200 flex flex-col justify-between">
                  <span className="text-[10px] font-black uppercase text-blue-700 flex items-center gap-1">
                    <Zap size={11} /> Cache EAN (0 Tokens)
                  </span>
                  <span className="text-2xl font-black text-blue-900">
                    {summary.reusedCache}
                  </span>
                </div>
                <div className="bg-amber-50 p-4 rounded-2xl border border-amber-200">
                  <span className="block text-[10px] font-black uppercase text-amber-700">
                    Revisão Manual (Ignorados)
                  </span>
                  <span className="text-2xl font-black text-amber-900">
                    {summary.skippedLow}
                  </span>
                </div>
                <div className="bg-red-50 p-4 rounded-2xl border border-red-200">
                  <span className="block text-[10px] font-black uppercase text-red-700">
                    Erros
                  </span>
                  <span className="text-2xl font-black text-red-900">{summary.errors}</span>
                </div>
              </div>

              {reviewableOutcomes.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-black uppercase tracking-widest text-gray-500">
                    Itens Ignorados por Confiança Baixa ou Erro (Revisão Manual Recomendada)
                  </h4>
                  <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-2xl">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50 text-[10px] font-black uppercase text-gray-400 sticky top-0">
                        <tr>
                          <th className="p-3">Produto</th>
                          <th className="p-3">EAN</th>
                          <th className="p-3">Status</th>
                          <th className="p-3">Motivo da Proteção</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {reviewableOutcomes.map((o, idx) => (
                          <tr key={`${o.id}_${idx}`} className="bg-white">
                            <td className="p-3 font-bold text-gray-900">{o.name}</td>
                            <td className="p-3 font-mono text-gray-500">
                              {o.barcode || '—'}
                            </td>
                            <td className="p-3">
                              <span
                                className={`px-2 py-1 rounded-md text-[10px] font-black uppercase ${
                                  o.status === 'error'
                                    ? 'bg-red-50 text-red-700'
                                    : 'bg-amber-50 text-amber-700'
                                }`}
                              >
                                {o.status === 'error' ? 'Erro' : 'Bloqueado'}
                              </span>
                            </td>
                            <td className="p-3 text-gray-600">
                              {o.error || o.confidenceReason}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setStage('config')}
                  className="px-5 py-3.5 rounded-2xl font-black text-xs uppercase tracking-wide bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-all flex items-center gap-2"
                >
                  <RotateCcw size={15} />
                  Processar Mais Itens
                </button>
                <button
                  type="button"
                  onClick={handleSafeClose}
                  className="px-7 py-3.5 rounded-2xl font-black text-xs uppercase tracking-wide bg-gray-900 text-white hover:bg-gray-800 transition-all"
                >
                  Concluir e Fechar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
