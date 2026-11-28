import React, { useMemo, useRef, useState } from 'react';
import {
  Wand2,
  X,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Loader2,
  PauseCircle,
  Play,
  SlidersHorizontal,
  ShieldCheck,
  ArrowRight,
  RotateCcw,
  FolderTree,
  Zap,
} from 'lucide-react';
import { DepartmentConfig, Product } from '../types';
import {
  OFFICIAL_DEPARTMENTS,
  OFFICIAL_TAXONOMY,
  getDepartmentForCategory,
  normalizeTaxonomyText,
} from '../lib/departments';
import {
  CatalogCategorizeOutcome,
  categorizeCatalogMiniBatch,
} from '../services/gemini';
import { patchCachedProductsForTenant } from '../services/storage';

interface CatalogAiCategorizeModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  departments?: DepartmentConfig[];
  products: Product[];
  selectedProductIds: Set<string>;
  onProductsMerged: (updatedProducts: Product[]) => void;
}

type CategorizeScope = 'suspects' | 'uncategorized' | 'selected' | 'department' | 'all';
type ModalStage = 'config' | 'running' | 'report';

const QUANTITY_PRESETS = [20, 50, 100, 250, 500];
const MINI_BATCH_SIZE = 20;

const PERFUMERY_SUSPECT_REGEX =
  /\b(?:SAB|SABONETE|SHAMPOO|SHAMP|CONDICIONADOR|DESOD|DESODORANTE|AEROSSOL|ANTITRANSPIRANTE|PO FACIAL|BATOM|ESMALTE|TINTURA|FRALDA|FRALDAS|LENCO UMED|PROTETOR SOLAR|FILTRO SOLAR|HIDRATANTE|CREME DENTAL|ESCOVA|ABSORVENTE|PRESERVATIVO|PERFUME|COLONIA|SPRAY FIXADOR|GEL CAPILAR|MAQUIAGEM|BARBEADOR|ALGODAO|COTONETE|BODY SPLASH)\b/i;

const NASAL_OR_INHALER_EXCEPTION_REGEX =
  /\b(?:NASAL|INALATORIO|OTOLOGICO|OFTALMICO|AEROLIN|SALBUTAMOL|BECLOMETASONA|BUDESONIDA|FLUTICASONA|CLENIL|SERETIDE|SYMBICORT|ATROVENT|BEROTEC)\b/i;

const NON_MED_DRUG_TYPES = new Set([
  'cosmetico',
  'higiene',
  'perfumaria',
  'correlato',
  'alimento',
]);

const MED_DRUG_TYPES = new Set([
  'referencia',
  'generico',
  'similar',
  'fitoterapico',
  'biologico',
  'especifico',
  'controlado',
]);

function normalizeText(val?: string | null): string {
  return String(val || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGenericCategory(cat?: string | null): boolean {
  const norm = normalizeText(cat);
  return (
    !norm ||
    norm === 'geral' ||
    norm === 'outros' ||
    norm === 'outros medicamentos' ||
    norm === 'sem categoria' ||
    norm === 'snacks' ||
    norm === 'produtos para o dia a dia'
  );
}

function hasValidNumericBarcode(barcode?: string | null): boolean {
  const digits = String(barcode || '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 14 && !/^0+$/.test(digits);
}

export const CatalogAiCategorizeModal: React.FC<CatalogAiCategorizeModalProps> = ({
  isOpen,
  onClose,
  tenantId,
  departments,
  products,
  selectedProductIds,
  onProductsMerged,
}) => {
  const [stage, setStage] = useState<ModalStage>('config');
  const [scope, setScope] = useState<CategorizeScope>('suspects');
  const [targetDepartment, setTargetDepartment] = useState<string>(OFFICIAL_DEPARTMENTS[0]);
  const [prioritizeInStock, setPrioritizeInStock] = useState<boolean>(true);
  const [quantityLimit, setQuantityLimit] = useState<number>(100);

  // Runtime state
  const [totalQueued, setTotalQueued] = useState<number>(0);
  const [processedCount, setProcessedCount] = useState<number>(0);
  const [resolvedWithoutAiCount, setResolvedWithoutAiCount] = useState<number>(0);
  const [currentBatchNames, setCurrentBatchNames] = useState<string[]>([]);
  const [outcomes, setOutcomes] = useState<CatalogCategorizeOutcome[]>([]);
  const [wasCancelled, setWasCancelled] = useState<boolean>(false);
  const [fatalError, setFatalError] = useState<string | null>(null);

  // Armazena IDs já processados / confirmados nesta sessão para avançar sem reprocessar
  const [confirmedCorrectIds, setConfirmedCorrectIds] = useState<Set<string>>(() => new Set());

  const abortControllerRef = useRef<AbortController | null>(null);
  const cancelledFlagRef = useRef<boolean>(false);

  const effectiveStoreDepartments = useMemo<DepartmentConfig[]>(() => {
    if (Array.isArray(departments) && departments.length > 0) {
      return departments;
    }
    return OFFICIAL_DEPARTMENTS.map((name, idx) => ({
      id: `default_${idx}`,
      name,
      iconName: 'Package',
      priority: idx,
      categories: OFFICIAL_TAXONOMY[name] || [],
    }));
  }, [departments]);

  const knownSubcategoriesSet = useMemo(() => {
    const set = new Set<string>();
    effectiveStoreDepartments.forEach((d) => {
      (d.categories || []).forEach((c) => set.add(normalizeTaxonomyText(c)));
    });
    return set;
  }, [effectiveStoreDepartments]);

  // Critérios rigorosos de suspeição (a, b, c)
  const isSuspectProduct = (p: Product): boolean => {
    const dept = getDepartmentForCategory(p.category || '', effectiveStoreDepartments);
    const deptNorm = normalizeText(dept);
    const catNorm = normalizeText(p.category);
    const drugNorm = normalizeText(p.drugType);
    const nameClean = String(p.name || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    // a) Está em Geral, Outros, Outros Medicamentos ou sem categoria válida na árvore da loja
    if (isGenericCategory(p.category) || !knownSubcategoriesSet.has(normalizeTaxonomyText(p.category || ''))) {
      return true;
    }

    // b) Está no departamento Medicamentos, mas possui termos claros de perfumaria/higiene/cosmético no nome (exceto inalatório/nasal)
    if (deptNorm.includes('medicamento')) {
      const hasPerfumeryTerms = PERFUMERY_SUSPECT_REGEX.test(nameClean) && !NASAL_OR_INHALER_EXCEPTION_REGEX.test(nameClean);
      if (hasPerfumeryTerms || catNorm === 'outros medicamentos') {
        return true;
      }
    }

    // c) Está fora de Medicamentos, mas possui EAN válido (candidato CMED), requires_prescription === true ou drugType medicamentoso
    if (!deptNorm.includes('medicamento')) {
      if (
        p.requires_prescription ||
        MED_DRUG_TYPES.has(drugNorm) ||
        hasValidNumericBarcode(p.barcode)
      ) {
        return true;
      }
    }

    return false;
  };

  const scopeCounts = useMemo(() => {
    let suspects = 0;
    let uncategorized = 0;

    for (const p of products) {
      if (!p || !p.id || !p.name?.trim()) continue;
      if (confirmedCorrectIds.has(p.id)) continue;
      if (isSuspectProduct(p)) suspects++;
      if (isGenericCategory(p.category) || !knownSubcategoriesSet.has(normalizeTaxonomyText(p.category || ''))) {
        uncategorized++;
      }
    }

    return { suspects, uncategorized, total: products.length };
  }, [products, effectiveStoreDepartments, knownSubcategoriesSet, confirmedCorrectIds]);

  const eligibleProducts = useMemo(() => {
    let pool = products.filter((p) => {
      if (!p || !p.id || !p.name || !p.name.trim()) return false;
      if (confirmedCorrectIds.has(p.id)) return false;

      if (scope === 'selected') {
        return selectedProductIds.has(p.id);
      }

      if (scope === 'uncategorized') {
        return (
          isGenericCategory(p.category) ||
          !knownSubcategoriesSet.has(normalizeTaxonomyText(p.category || ''))
        );
      }

      if (scope === 'department') {
        const dept = getDepartmentForCategory(p.category || '', effectiveStoreDepartments);
        return normalizeTaxonomyText(dept) === normalizeTaxonomyText(targetDepartment);
      }

      if (scope === 'suspects') {
        return isSuspectProduct(p);
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
    targetDepartment,
    prioritizeInStock,
    effectiveStoreDepartments,
    knownSubcategoriesSet,
    confirmedCorrectIds,
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
    let unchanged = 0;
    let skippedLow = 0;
    let errors = 0;
    let anvisaHits = 0;

    for (const o of outcomes) {
      if (o.anvisaMatched) anvisaHits++;
      if (o.status === 'updated') updated++;
      else if (o.status === 'unchanged') unchanged++;
      else if (o.status === 'skipped_low_confidence') skippedLow++;
      else if (o.status === 'error') errors++;
    }

    return { updated, unchanged, skippedLow, errors, anvisaHits };
  }, [outcomes]);

  const movedOutcomes = useMemo(
    () => outcomes.filter((o) => o.status === 'updated'),
    [outcomes]
  );

  const reviewableOutcomes = useMemo(
    () =>
      outcomes.filter(
        (o) => o.status === 'skipped_low_confidence' || o.status === 'error'
      ),
    [outcomes]
  );

  if (!isOpen) return null;

  const runCategorizationExecution = async (isQuickCleanOnly = false, startIndex = 0) => {
    const activeQueue = queueToRun;
    if (activeQueue.length === 0) return;

    cancelledFlagRef.current = false;
    abortControllerRef.current = new AbortController();

    if (startIndex === 0) {
      setStage('running');
      setTotalQueued(activeQueue.length);
      setProcessedCount(0);
      setResolvedWithoutAiCount(0);
      setCurrentBatchNames([]);
      setOutcomes([]);
      setWasCancelled(false);
      setFatalError(null);
    } else {
      setStage('running');
    }

    const accumulatedOutcomes: CatalogCategorizeOutcome[] = [...outcomes];
    const productsById = new Map<string, Product>(products.map((p) => [p.id, p]));
    const newConfirmed = new Set<string>(confirmedCorrectIds);
    let totalResolvedNoAi = resolvedWithoutAiCount;

    try {
      for (let i = startIndex; i < activeQueue.length; i += MINI_BATCH_SIZE) {
        if (cancelledFlagRef.current) {
          setWasCancelled(true);
          break;
        }

        const chunk = activeQueue.slice(i, i + MINI_BATCH_SIZE);
        setCurrentBatchNames(chunk.map((p) => p.name));

        const batchInput = chunk.map((p) => ({
          id: p.id,
          name: p.name,
          barcode: p.barcode,
          manufacturer: p.manufacturer,
          category: p.category,
          department: getDepartmentForCategory(p.category || '', effectiveStoreDepartments),
          activePrinciple: p.activePrinciple,
          drugType: p.drugType,
          description: p.description,
          requires_prescription: p.requires_prescription,
        }));

        // Se for modo limpeza rápida grátis, passamos persist=true mas o backend processa regras 0A/0B/0C.
        // Podemos também instruir ou pausar se necessário.
        const res = await categorizeCatalogMiniBatch({
          tenantId,
          products: batchInput,
          departments: effectiveStoreDepartments,
          persist: true,
          signal: abortControllerRef.current.signal,
        });

        const chunkOutcomes = res.outcomes;
        totalResolvedNoAi += res.resolvedWithoutAi || 0;
        setResolvedWithoutAiCount(totalResolvedNoAi);

        const mergedChunkProducts: Product[] = [];
        for (const outcome of chunkOutcomes) {
          accumulatedOutcomes.push(outcome);
          newConfirmed.add(outcome.id);
          if (outcome.status === 'updated' && outcome.patch && Object.keys(outcome.patch).length > 0) {
            const orig = productsById.get(outcome.id);
            if (orig) {
              const updatedProd: Product = {
                ...orig,
                ...outcome.patch,
              };
              productsById.set(outcome.id, updatedProd);
              mergedChunkProducts.push(updatedProd);
            }
          }
        }

        if (mergedChunkProducts.length > 0) {
          onProductsMerged(mergedChunkProducts);
          await patchCachedProductsForTenant(tenantId, mergedChunkProducts);
        }

        setOutcomes([...accumulatedOutcomes]);
        setConfirmedCorrectIds(newConfirmed);
        const currentDone = Math.min(i + chunk.length, activeQueue.length);
        setProcessedCount(currentDone);

        // Cadência de 2 segundos entre mini-lotes para proteger contra rate limits (429)
        if (i + MINI_BATCH_SIZE < activeQueue.length && !cancelledFlagRef.current && !isQuickCleanOnly) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || cancelledFlagRef.current) {
        setWasCancelled(true);
      } else if (err?.message === 'LIMITE_IA_ATINGIDO') {
        setFatalError(
          'Limite temporário de requisições à IA atingido (429). Os mini-lotes já concluídos foram salvos no banco. Você pode clicar em "Continuar de onde parou".'
        );
      } else {
        setFatalError(err?.message || 'Erro durante a organização de categorias.');
      }
    } finally {
      setCurrentBatchNames([]);
      abortControllerRef.current = null;
      setStage('report');
    }
  };

  const handleStart = async () => {
    if (queueToRun.length === 0) return;
    await runCategorizationExecution(false, 0);
  };

  const handleQuickCleanOnly = async () => {
    if (queueToRun.length === 0) return;
    await runCategorizationExecution(true, 0);
  };

  const handleResume = async () => {
    if (processedCount >= totalQueued) return;
    await runCategorizationExecution(false, processedCount);
  };

  const handleCancel = () => {
    cancelledFlagRef.current = true;
    abortControllerRef.current?.abort();
  };

  const handleResetToConfig = () => {
    setStage('config');
    setOutcomes([]);
    setProcessedCount(0);
    setResolvedWithoutAiCount(0);
    setTotalQueued(0);
    setFatalError(null);
    setWasCancelled(false);
  };

  const handleSafeClose = () => {
    if (stage === 'running') {
      handleCancel();
    }
    handleResetToConfig();
    onClose();
  };

  const progressPercent =
    totalQueued > 0 ? Math.min(100, Math.round((processedCount / totalQueued) * 100)) : 0;

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-4xl rounded-[2.5rem] shadow-2xl border border-gray-100 overflow-hidden my-auto animate-in zoom-in-95">
        {/* Header */}
        <div className="px-8 py-6 bg-gradient-to-r from-indigo-700 via-blue-700 to-teal-700 text-white flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
              <Wand2 size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-black tracking-tight">
                Organizar Categorias com IA + CMED
              </h2>
              <p className="text-xs font-bold text-white/80 uppercase tracking-widest mt-0.5">
                3 Camadas Anti-Mistura • ANVISA/CMED por EAN + Árvore da Loja
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSafeClose}
            className="p-2.5 rounded-2xl bg-white/15 hover:bg-white/25 text-white transition-all cursor-pointer"
            title="Fechar"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 md:p-8 max-h-[82vh] overflow-y-auto space-y-6">
          {/* Resumo do Catálogo */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-gray-50 p-5 rounded-3xl border border-gray-200/80">
            <div>
              <span className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                Catálogo Total
              </span>
              <span className="text-2xl font-black text-gray-900">
                {scopeCounts.total.toLocaleString('pt-BR')}
              </span>
            </div>
            <div>
              <span className="block text-[10px] font-black uppercase tracking-widest text-amber-600">
                Suspeitos / Auditáveis
              </span>
              <span className="text-2xl font-black text-amber-700">
                {scopeCounts.suspects.toLocaleString('pt-BR')}
              </span>
            </div>
            <div>
              <span className="block text-[10px] font-black uppercase tracking-widest text-indigo-600">
                Geral / Outros / Sem Cat.
              </span>
              <span className="text-2xl font-black text-indigo-700">
                {scopeCounts.uncategorized.toLocaleString('pt-BR')}
              </span>
            </div>
          </div>

          {stage === 'config' && (
            <div className="space-y-6">
              {/* Escopo */}
              <div className="space-y-3">
                <label className="text-xs font-black uppercase tracking-widest text-gray-500 flex items-center gap-2">
                  <SlidersHorizontal size={14} /> 1. Escopo da Organização
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setScope('suspects')}
                    className={`p-4 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                      scope === 'suspects'
                        ? 'border-indigo-600 bg-indigo-50/70'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className="font-black text-sm text-gray-900 flex items-center justify-between gap-2">
                      <span>Auditar e corrigir suspeitos</span>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-indigo-100 text-indigo-700">
                        Recomendado
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-500 font-medium mt-1">
                      Itens com inconsistência real de departamento/categoria ({scopeCounts.suspects} itens)
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setScope('uncategorized')}
                    className={`p-4 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                      scope === 'uncategorized'
                        ? 'border-indigo-600 bg-indigo-50/70'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className="font-black text-sm text-gray-900">
                      Apenas sem categoria / Geral / Outros
                    </div>
                    <div className="text-[11px] text-gray-500 font-medium mt-1">
                      Foca apenas em Geral, Outros ou categorias fora da árvore ({scopeCounts.uncategorized} itens)
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setScope('selected')}
                    disabled={selectedProductIds.size === 0}
                    className={`p-4 rounded-2xl border-2 text-left transition-all ${
                      selectedProductIds.size === 0
                        ? 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed'
                        : scope === 'selected'
                        ? 'border-indigo-600 bg-indigo-50/70'
                        : 'border-gray-200 hover:border-gray-300 bg-white cursor-pointer'
                    }`}
                  >
                    <div className="font-black text-sm text-gray-900">
                      Selecionados na lista ({selectedProductIds.size})
                    </div>
                    <div className="text-[11px] text-gray-500 font-medium mt-1">
                      Reavalia apenas os produtos marcados com checkbox
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setScope('department')}
                    className={`p-4 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                      scope === 'department'
                        ? 'border-indigo-600 bg-indigo-50/70'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className="font-black text-sm text-gray-900">
                      Reorganizar departamento específico
                    </div>
                    <div className="text-[11px] text-gray-500 font-medium mt-1">
                      Audita todos os itens atualmente dentro de um departamento
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setScope('all')}
                    className={`p-4 rounded-2xl border-2 text-left transition-all md:col-span-2 cursor-pointer ${
                      scope === 'all'
                        ? 'border-indigo-600 bg-indigo-50/70'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className="font-black text-sm text-gray-900">
                      Todo o catálogo ({products.length.toLocaleString('pt-BR')} itens)
                    </div>
                    <div className="text-[11px] text-gray-500 font-medium mt-1">
                      Audita e reorganiza o catálogo completo respeitando as travas
                    </div>
                  </button>
                </div>
              </div>

              {scope === 'department' && (
                <div className="bg-indigo-50/50 border border-indigo-200 rounded-2xl p-4 space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-indigo-800 flex items-center gap-2">
                    <FolderTree size={14} /> Selecione o Departamento Atual para Auditar
                  </label>
                  <select
                    value={targetDepartment}
                    onChange={(e) => setTargetDepartment(e.target.value)}
                    className="w-full p-3 rounded-xl bg-white border border-indigo-200 font-bold text-sm text-gray-900 outline-none focus:border-indigo-600 cursor-pointer"
                  >
                    {effectiveStoreDepartments.map((d) => (
                      <option key={d.id || d.name} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Quantidade e Estoque */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-gray-500">
                    2. Quantidade de Itens neste Lote
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {QUANTITY_PRESETS.map((qty) => (
                      <button
                        key={qty}
                        type="button"
                        onClick={() => setQuantityLimit(qty)}
                        className={`px-3.5 py-2 rounded-xl text-xs font-black border transition-all cursor-pointer ${
                          quantityLimit === qty
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                            : 'bg-white text-gray-700 border-gray-200 hover:border-indigo-300'
                        }`}
                      >
                        {qty}
                      </button>
                    ))}
                    <input
                      type="number"
                      min={1}
                      max={2000}
                      value={quantityLimit}
                      onChange={(e) => setQuantityLimit(Math.max(1, Number(e.target.value) || 1))}
                      className="w-24 px-3 py-2 rounded-xl border border-gray-200 text-xs font-black text-gray-900 outline-none focus:border-indigo-500"
                      aria-label="Quantidade personalizada"
                    />
                  </div>
                  <p className="text-[11px] font-medium text-gray-500">
                    Elegíveis no filtro atual: <strong>{eligibleProducts.length}</strong> ({eligibleInStockCount} com estoque &gt; 0). Serão processados <strong>{queueToRun.length}</strong>.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-gray-500">
                    3. Priorização e Segurança
                  </label>
                  <label className="flex items-center gap-3 p-3.5 rounded-2xl border border-gray-200 bg-gray-50/70 cursor-pointer hover:bg-gray-100/70 transition-all">
                    <input
                      type="checkbox"
                      checked={prioritizeInStock}
                      onChange={(e) => setPrioritizeInStock(e.target.checked)}
                      className="w-4 h-4 accent-indigo-600 rounded"
                    />
                    <div>
                      <span className="block text-xs font-black text-gray-900">
                        Priorizar produtos com estoque &gt; 0
                      </span>
                      <span className="block text-[11px] text-gray-500 font-medium">
                        Organiza primeiro o que já está disponível na vitrine
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Aviso de travas */}
              <div className="flex items-start gap-3 p-4 rounded-2xl bg-teal-50 border border-teal-200 text-xs text-teal-900 font-medium">
                <ShieldCheck size={18} className="text-teal-700 shrink-0 mt-0.5" />
                <span>
                  <strong>Camadas 0 Token + IA:</strong> Regras determinísticas e cruzamento CMED via EAN resolvem milhares de itens instantaneamente sem gasto de API. Mini-lotes de 20 itens com cadência de 2s e fallback automático para OpenAI em caso de 429.
                </span>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleSafeClose}
                  className="px-5 py-3.5 rounded-2xl font-black text-xs uppercase tracking-wide bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={queueToRun.length === 0}
                  onClick={handleQuickCleanOnly}
                  className="px-5 py-3.5 rounded-2xl font-black text-xs uppercase tracking-wide bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50 transition-all flex items-center gap-2 cursor-pointer"
                  title="Executa apenas a camada determinística CMED e regras (0 tokens / Grátis)"
                >
                  <Zap size={16} className="text-emerald-600" />
                  Limpeza Rápida CMED (0 Tokens)
                </button>
                <button
                  type="button"
                  disabled={queueToRun.length === 0}
                  onClick={handleStart}
                  className="px-7 py-3.5 rounded-2xl font-black text-xs uppercase tracking-wide bg-indigo-600 text-white shadow-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 cursor-pointer"
                >
                  <Play size={16} />
                  Iniciar Auditoria IA ({queueToRun.length} itens)
                </button>
              </div>
            </div>
          )}

          {stage === 'running' && (
            <div className="space-y-5 py-2">
              <div className="bg-indigo-50 border border-indigo-200 rounded-3xl p-6 space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <Loader2 size={24} className="animate-spin text-indigo-700" />
                    <div>
                      <h4 className="text-base font-black text-gray-900">
                        Auditando e Organizando Categorias...
                      </h4>
                      <p className="text-xs font-bold text-indigo-800">
                        {processedCount} de {totalQueued} produtos avaliados ({progressPercent}%) • Resolvidos sem IA: {resolvedWithoutAiCount}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="px-4 py-2.5 rounded-xl bg-red-600 text-white text-xs font-black uppercase tracking-wide hover:bg-red-700 transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <PauseCircle size={15} />
                    Pausar / Cancelar
                  </button>
                </div>

                <progress
                  value={progressPercent}
                  max={100}
                  className="w-full h-3 rounded-full overflow-hidden [&::-webkit-progress-bar]:bg-indigo-100 [&::-webkit-progress-value]:bg-indigo-600"
                />

                {currentBatchNames.length > 0 && (
                  <div className="text-xs font-medium text-gray-600 bg-white/80 p-3 rounded-2xl border border-indigo-100">
                    <span className="font-black text-indigo-800 uppercase text-[10px] block mb-1">
                      Mini-Lote Atual ({currentBatchNames.length} itens):
                    </span>
                    {currentBatchNames.join(' • ')}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-200">
                  <span className="block text-[10px] font-black uppercase text-emerald-700">
                    Movidos (De → Para)
                  </span>
                  <span className="text-2xl font-black text-emerald-900">{summary.updated}</span>
                </div>
                <div className="bg-teal-50 p-4 rounded-2xl border border-teal-200">
                  <span className="block text-[10px] font-black uppercase text-teal-700 flex items-center gap-1">
                    <ShieldCheck size={11} /> Resolvidos 0 Tokens
                  </span>
                  <span className="text-2xl font-black text-teal-900">{resolvedWithoutAiCount}</span>
                </div>
                <div className="bg-blue-50 p-4 rounded-2xl border border-blue-200">
                  <span className="block text-[10px] font-black uppercase text-blue-700">
                    Já Corretos
                  </span>
                  <span className="text-2xl font-black text-blue-900">{summary.unchanged}</span>
                </div>
                <div className="bg-amber-50 p-4 rounded-2xl border border-amber-200">
                  <span className="block text-[10px] font-black uppercase text-amber-700">
                    Revisão Manual
                  </span>
                  <span className="text-2xl font-black text-amber-900">{summary.skippedLow}</span>
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
                  <CheckCircle2 size={22} className="shrink-0 mt-0.5 text-emerald-600" />
                )}
                <div>
                  <h4 className="font-black text-base">
                    {fatalError
                      ? 'Auditoria Interrompida'
                      : wasCancelled
                      ? 'Auditoria Pausada pelo Usuário'
                      : 'Organização de Categorias Concluída!'}
                  </h4>
                  <p className="text-xs font-medium mt-0.5">
                    {fatalError ||
                      `${processedCount} de ${totalQueued} produtos avaliados (${resolvedWithoutAiCount} resolvidos sem IA - 0 tokens).`}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-200">
                  <span className="block text-[10px] font-black uppercase text-emerald-700">
                    Movidos (De → Para)
                  </span>
                  <span className="text-2xl font-black text-emerald-900">{summary.updated}</span>
                </div>
                <div className="bg-teal-50 p-4 rounded-2xl border border-teal-200">
                  <span className="block text-[10px] font-black uppercase text-teal-700 flex items-center gap-1">
                    <ShieldCheck size={11} /> Resolvidos 0 Tokens
                  </span>
                  <span className="text-2xl font-black text-teal-900">{resolvedWithoutAiCount}</span>
                </div>
                <div className="bg-blue-50 p-4 rounded-2xl border border-blue-200">
                  <span className="block text-[10px] font-black uppercase text-blue-700">
                    Já Corretos
                  </span>
                  <span className="text-2xl font-black text-blue-900">{summary.unchanged}</span>
                </div>
                <div className="bg-amber-50 p-4 rounded-2xl border border-amber-200">
                  <span className="block text-[10px] font-black uppercase text-amber-700">
                    Revisão Manual
                  </span>
                  <span className="text-2xl font-black text-amber-900">{summary.skippedLow}</span>
                </div>
                <div className="bg-red-50 p-4 rounded-2xl border border-red-200">
                  <span className="block text-[10px] font-black uppercase text-red-700">
                    Erros
                  </span>
                  <span className="text-2xl font-black text-red-900">{summary.errors}</span>
                </div>
              </div>

              {movedOutcomes.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-black uppercase tracking-widest text-emerald-700">
                    Relatório De → Para ({movedOutcomes.length} produtos movidos / corrigidos)
                  </h4>
                  <div className="max-h-64 overflow-y-auto border border-emerald-200 rounded-2xl">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-emerald-50 text-[10px] font-black uppercase text-emerald-800 sticky top-0">
                        <tr>
                          <th className="p-3">Produto</th>
                          <th className="p-3">De (Atual)</th>
                          <th className="p-3">Para (Novo)</th>
                          <th className="p-3">Motivo / Base</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {movedOutcomes.map((o, idx) => (
                          <tr key={`${o.id}_${idx}`} className="bg-white">
                            <td className="p-3 font-bold text-gray-900">
                              <div>{o.name}</div>
                              {o.anvisaMatched && (
                                <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-md bg-teal-50 border border-teal-200 text-teal-800 text-[9px] font-black uppercase">
                                  <ShieldCheck size={10} /> ANVISA/CMED
                                </span>
                              )}
                            </td>
                            <td className="p-3 text-gray-500">
                              <span className="line-through">
                                {o.oldCategory}
                              </span>
                              <span className="block text-[10px] text-gray-400">
                                {o.oldDepartment}
                              </span>
                            </td>
                            <td className="p-3 font-black text-emerald-800">
                              <span className="inline-flex items-center gap-1">
                                <ArrowRight size={12} className="text-emerald-600 shrink-0" />
                                {o.newCategory}
                              </span>
                              <span className="block text-[10px] font-bold text-emerald-600">
                                {o.newDepartment}
                              </span>
                            </td>
                            <td className="p-3 text-gray-600">{o.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {reviewableOutcomes.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-black uppercase tracking-widest text-gray-500">
                    Itens Mantidos para Revisão Manual ({reviewableOutcomes.length})
                  </h4>
                  <div className="max-h-56 overflow-y-auto border border-gray-200 rounded-2xl">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50 text-[10px] font-black uppercase text-gray-400 sticky top-0">
                        <tr>
                          <th className="p-3">Produto</th>
                          <th className="p-3">Categoria Atual</th>
                          <th className="p-3">Status</th>
                          <th className="p-3">Motivo da Proteção</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {reviewableOutcomes.map((o, idx) => (
                          <tr key={`${o.id}_rev_${idx}`} className="bg-white">
                            <td className="p-3 font-bold text-gray-900">{o.name}</td>
                            <td className="p-3 text-gray-500">{o.oldCategory}</td>
                            <td className="p-3">
                              <span
                                className={`px-2 py-1 rounded-md text-[10px] font-black uppercase ${
                                  o.status === 'error'
                                    ? 'bg-red-50 text-red-700'
                                    : 'bg-amber-50 text-amber-700'
                                }`}
                              >
                                {o.status === 'error' ? 'Erro' : 'Revisão Manual'}
                              </span>
                            </td>
                            <td className="p-3 text-gray-600">{o.error || o.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                {processedCount < totalQueued && (
                  <button
                    type="button"
                    onClick={handleResume}
                    className="px-6 py-3.5 rounded-2xl font-black text-xs uppercase tracking-wide bg-indigo-600 text-white shadow-lg hover:bg-indigo-700 transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <Play size={15} />
                    Continuar de onde parou ({totalQueued - processedCount} restantes)
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleResetToConfig}
                  className="px-5 py-3.5 rounded-2xl font-black text-xs uppercase tracking-wide bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-all flex items-center gap-2 cursor-pointer"
                >
                  <RotateCcw size={15} />
                  Nova Auditoria
                </button>
                <button
                  type="button"
                  onClick={handleSafeClose}
                  className="px-7 py-3.5 rounded-2xl font-black text-xs uppercase tracking-wide bg-gray-900 text-white hover:bg-gray-800 transition-all cursor-pointer"
                >
                  Concluir
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
