import React, { useMemo, useRef, useState } from 'react';
import {
  X,
  Upload,
  FileSpreadsheet,
  Database,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Loader2,
  ShieldCheck,
  Copy,
  Check,
  RotateCcw,
} from 'lucide-react';

export interface AnvisaCmedStats {
  totalCount: number;
  lastUpdatedAt: string | null;
  schemaReady: boolean;
  schemaMessage?: string;
}

interface ParsedCmedRow {
  principio_ativo: string;
  laboratorio: string;
  registro_anvisa: string;
  ean: string;
  ean2: string;
  ean3: string;
  nome_comercial: string;
  apresentacao: string;
  classe_terapeutica: string;
  tipo_produto: string;
  tarja: string | null;
}

interface SuperAdminCmedModalProps {
  isOpen: boolean;
  onClose: () => void;
  stats: AnvisaCmedStats | null;
  onStatsRefresh: () => Promise<void>;
  getAuthHeaders: () => Promise<Record<string, string>>;
}

type ModalStage = 'idle' | 'ready' | 'uploading' | 'done';

const BATCH_SIZE = 500;

export const ANVISA_CMED_MIGRATION_SQL = `ALTER TABLE public.anvisa_medicamentos
  ADD COLUMN IF NOT EXISTS ean text,
  ADD COLUMN IF NOT EXISTS ean2 text,
  ADD COLUMN IF NOT EXISTS ean3 text,
  ADD COLUMN IF NOT EXISTS laboratorio text,
  ADD COLUMN IF NOT EXISTS classe_terapeutica text,
  ADD COLUMN IF NOT EXISTS tipo_produto text,
  ADD COLUMN IF NOT EXISTS tarja text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

UPDATE public.anvisa_medicamentos SET ean = NULL WHERE ean = '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_anvisa_medicamentos_ean
  ON public.anvisa_medicamentos (ean);

CREATE INDEX IF NOT EXISTS idx_anvisa_medicamentos_ean2
  ON public.anvisa_medicamentos (ean2);

CREATE INDEX IF NOT EXISTS idx_anvisa_medicamentos_ean3
  ON public.anvisa_medicamentos (ean3);

CREATE INDEX IF NOT EXISTS idx_anvisa_medicamentos_reg_apres
  ON public.anvisa_medicamentos (registro_anvisa, apresentacao);`;

export const SuperAdminCmedModal: React.FC<SuperAdminCmedModalProps> = ({
  isOpen,
  onClose,
  stats,
  onStatsRefresh,
  getAuthHeaders,
}) => {
  const [stage, setStage] = useState<ModalStage>('idle');
  const [fileName, setFileName] = useState<string>('');
  const [detectedSheetName, setDetectedSheetName] = useState<string>('');
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [totalReadRows, setTotalReadRows] = useState<number>(0);
  const [ignoredNoEanCount, setIgnoredNoEanCount] = useState<number>(0);
  const [parsedRows, setParsedRows] = useState<ParsedCmedRow[]>([]);

  // Upload state
  const [sentCount, setSentCount] = useState<number>(0);
  const [savedCount, setSavedCount] = useState<number>(0);
  const [duplicatesCount, setDuplicatesCount] = useState<number>(0);
  const [backendIgnoredCount, setBackendIgnoredCount] = useState<number>(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [wasCancelled, setWasCancelled] = useState<boolean>(false);
  const [copiedSql, setCopiedSql] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelFlagRef = useRef<boolean>(false);

  const formattedLastUpdate = useMemo(() => {
    if (!stats?.lastUpdatedAt) return 'Ainda não importada';
    try {
      return new Date(stats.lastUpdatedAt).toLocaleString('pt-BR');
    } catch (_) {
      return stats.lastUpdatedAt;
    }
  }, [stats?.lastUpdatedAt]);

  if (!isOpen) return null;

  const resetModal = () => {
    setStage('idle');
    setFileName('');
    setDetectedSheetName('');
    setParseError(null);
    setTotalReadRows(0);
    setIgnoredNoEanCount(0);
    setParsedRows([]);
    setSentCount(0);
    setSavedCount(0);
    setDuplicatesCount(0);
    setBackendIgnoredCount(0);
    setUploadError(null);
    setWasCancelled(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCopySql = () => {
    navigator.clipboard.writeText(ANVISA_CMED_MIGRATION_SQL);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2500);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsParsing(true);
    setParseError(null);
    setFileName(file.name);
    setDetectedSheetName('');

    try {
      const lowerName = file.name.toLowerCase().trim();
      const isSupportedExt = /\.(xlsx|xls|csv)(\.(xlsx|xls|csv))*$/i.test(lowerName);
      if (!isSupportedExt) {
        throw new Error(
          'Formato de arquivo não suportado. Selecione uma planilha oficial CMED (.xlsx, .xls ou .csv).'
        );
      }

      const authHeaders = await getAuthHeaders();
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/super-admin/anvisa-cmed/parse', {
        method: 'POST',
        headers: authHeaders,
        body: formData,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data?.error || `Falha HTTP ${res.status} ao processar a planilha da CMED.`
        );
      }

      const rows = Array.isArray(data?.rows) ? (data.rows as ParsedCmedRow[]) : [];
      if (rows.length === 0) {
        throw new Error(
          'Nenhum medicamento com EAN válido foi encontrado na planilha enviada.'
        );
      }

      setDetectedSheetName(String(data?.sheetName || 'Lista CMED'));
      setTotalReadRows(Number(data?.totalReadRows || rows.length));
      setIgnoredNoEanCount(Number(data?.ignoredNoEanCount || 0));
      setParsedRows(rows);
      setStage('ready');
    } catch (err: any) {
      setParseError(err?.message || 'Não foi possível ler o arquivo da CMED.');
      setStage('idle');
    } finally {
      setIsParsing(false);
    }
  };

  const handleStartUpload = async () => {
    if (parsedRows.length === 0) return;

    cancelFlagRef.current = false;
    abortRef.current = new AbortController();

    setStage('uploading');
    setSentCount(0);
    setSavedCount(0);
    setDuplicatesCount(0);
    setBackendIgnoredCount(0);
    setUploadError(null);
    setWasCancelled(false);

    let accSaved = 0;
    let accDup = 0;
    let accIgnored = 0;

    try {
      const authHeaders = await getAuthHeaders();
      const headers: Record<string, string> = {
        ...authHeaders,
        'Content-Type': 'application/json',
      };

      for (let i = 0; i < parsedRows.length; i += BATCH_SIZE) {
        if (cancelFlagRef.current) {
          setWasCancelled(true);
          break;
        }

        const chunk = parsedRows.slice(i, i + BATCH_SIZE);
        const res = await fetch('/api/super-admin/anvisa-cmed/import', {
          method: 'POST',
          headers,
          signal: abortRef.current.signal,
          body: JSON.stringify({ rows: chunk }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || `Falha HTTP ${res.status} ao importar lote CMED.`);
        }

        accSaved += Number(data?.savedCount || 0);
        accDup += Number(data?.duplicatesInBatch || 0);
        accIgnored += Number(data?.ignoredNoEan || 0);

        setSentCount(Math.min(i + chunk.length, parsedRows.length));
        setSavedCount(accSaved);
        setDuplicatesCount(accDup);
        setBackendIgnoredCount(accIgnored);
      }

      await onStatsRefresh();
    } catch (err: any) {
      if (err?.name === 'AbortError' || cancelFlagRef.current) {
        setWasCancelled(true);
      } else {
        setUploadError(err?.message || 'Erro durante o envio da planilha CMED.');
      }
    } finally {
      abortRef.current = null;
      setStage('done');
    }
  };

  const handleCancelUpload = () => {
    cancelFlagRef.current = true;
    abortRef.current?.abort();
  };

  const handleSafeClose = () => {
    if (stage === 'uploading') {
      handleCancelUpload();
    }
    resetModal();
    onClose();
  };

  const progressPct =
    parsedRows.length > 0
      ? Math.min(100, Math.round((sentCount / parsedRows.length) * 100))
      : 0;

  return (
    <div className="fixed inset-0 z-[150] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-3xl rounded-[2.5rem] shadow-2xl border border-gray-100 overflow-hidden my-auto animate-in zoom-in-95">
        {/* Header */}
        <div className="px-8 py-6 bg-gradient-to-r from-emerald-700 via-teal-700 to-cyan-700 text-white flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
              <Database size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-black tracking-tight">
                Base Oficial ANVISA / CMED
              </h2>
              <p className="text-xs font-bold text-white/80 uppercase tracking-widest mt-0.5">
                Alimentação Oficial da Camada 1 do Enriquecimento com IA
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
          {/* Status atual da tabela */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-gray-50 p-5 rounded-3xl border border-gray-200/80">
            <div>
              <span className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                Medicamentos na Base (`anvisa_medicamentos`)
              </span>
              <span className="text-2xl font-black text-gray-900">
                {(stats?.totalCount ?? 0).toLocaleString('pt-BR')}
              </span>
            </div>
            <div>
              <span className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                Última Atualização CMED
              </span>
              <span className="text-sm font-black text-emerald-700 mt-1 block">
                {formattedLastUpdate}
              </span>
            </div>
          </div>

          {/* Alerta se schema SQL ainda não foi executado */}
          {stats && !stats.schemaReady && (
            <div className="bg-amber-50 border-2 border-amber-200 rounded-3xl p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-black text-amber-950">
                      Atualização de Schema SQL Pendente no Supabase
                    </h4>
                    <p className="text-xs font-medium text-amber-800 mt-0.5">
                      {stats.schemaMessage ||
                        'Execute o SQL abaixo no Supabase SQL Editor antes de importar a planilha CMED.'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCopySql}
                  className="px-3.5 py-2 rounded-xl bg-amber-600 text-white text-xs font-black flex items-center gap-1.5 shrink-0 hover:bg-amber-700 transition-all"
                >
                  {copiedSql ? <Check size={14} /> : <Copy size={14} />}
                  {copiedSql ? 'Copiado!' : 'Copiar SQL'}
                </button>
              </div>
              <pre className="text-[11px] bg-white/90 border border-amber-200 rounded-2xl p-3 overflow-x-auto text-gray-800 font-mono">
                {ANVISA_CMED_MIGRATION_SQL}
              </pre>
            </div>
          )}

          {stage === 'idle' && (
            <div className="space-y-4">
              <label className="flex flex-col items-center justify-center gap-3 p-10 border-2 border-dashed border-emerald-300 bg-emerald-50/40 hover:bg-emerald-50 rounded-3xl cursor-pointer transition-all text-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
                {isParsing ? (
                  <>
                    <Loader2 size={36} className="animate-spin text-emerald-600" />
                    <span className="text-sm font-black text-emerald-900">
                      Varrendo abas da planilha CMED e extraindo colunas oficiais...
                    </span>
                  </>
                ) : (
                  <>
                    <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                      <Upload size={26} />
                    </div>
                    <div>
                      <p className="text-base font-black text-gray-900">
                        Clique para selecionar a Planilha Oficial CMED (.xlsx, .xls ou .csv)
                      </p>
                      <p className="text-xs font-medium text-gray-500 mt-1">
                        Envie o arquivo oficial da ANVISA direto como foi baixado — não é necessário apagar abas nem colunas de preços.
                      </p>
                    </div>
                  </>
                )}
              </label>

              {parseError && (
                <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold flex items-start gap-2.5">
                  <AlertCircle size={18} className="shrink-0 mt-0.5" />
                  <span>{parseError}</span>
                </div>
              )}

              <div className="flex items-start gap-3 p-4 rounded-2xl bg-gray-50 border border-gray-200 text-xs text-gray-600 font-medium">
                <ShieldCheck size={18} className="text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  Ao encontrar um código de barras na base CMED, a IA trava automaticamente o{' '}
                  <strong className="text-gray-900">Princípio Ativo (DCB)</strong>,{' '}
                  <strong className="text-gray-900">Tipo Legal</strong> e{' '}
                  <strong className="text-gray-900">Exigência de Receita (Tarja)</strong>, gerando descrição, indicações e modo de uso 100% fiéis ao medicamento oficial.
                </span>
              </div>
            </div>
          )}

          {stage === 'ready' && (
            <div className="space-y-5">
              <div className="bg-emerald-50 border border-emerald-200 rounded-3xl p-5 flex items-center gap-4">
                <FileSpreadsheet size={28} className="text-emerald-700 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-emerald-950 truncate">{fileName}</p>
                  <p className="text-xs font-bold text-emerald-800 mt-0.5">
                    Aba detectada: <span className="underline">{detectedSheetName}</span> —{' '}
                    {totalReadRows.toLocaleString('pt-BR')} registros lidos (pronto para envio em lotes de {BATCH_SIZE}).
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200">
                  <span className="block text-[10px] font-black uppercase text-gray-400">
                    Total Lido na Planilha
                  </span>
                  <span className="text-2xl font-black text-gray-900">
                    {totalReadRows.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-200">
                  <span className="block text-[10px] font-black uppercase text-emerald-700">
                    Prontos com EAN Válido
                  </span>
                  <span className="text-2xl font-black text-emerald-900">
                    {parsedRows.length.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="bg-amber-50 p-4 rounded-2xl border border-amber-200">
                  <span className="block text-[10px] font-black uppercase text-amber-700">
                    Ignorados sem EAN
                  </span>
                  <span className="text-2xl font-black text-amber-900">
                    {ignoredNoEanCount.toLocaleString('pt-BR')}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={resetModal}
                  className="px-5 py-3.5 rounded-2xl font-black text-xs uppercase tracking-wide bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all"
                >
                  Trocar Arquivo
                </button>
                <button
                  type="button"
                  onClick={handleStartUpload}
                  className="px-7 py-3.5 rounded-2xl font-black text-xs uppercase tracking-wide bg-emerald-600 text-white shadow-lg hover:bg-emerald-700 transition-all flex items-center gap-2"
                >
                  <Database size={16} />
                  Importar para Base ANVISA ({parsedRows.length.toLocaleString('pt-BR')})
                </button>
              </div>
            </div>
          )}

          {stage === 'uploading' && (
            <div className="space-y-5 py-2">
              <div className="bg-emerald-50 border border-emerald-200 rounded-3xl p-6 space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <Loader2 size={24} className="animate-spin text-emerald-700" />
                    <div>
                      <h4 className="text-base font-black text-gray-900">
                        Importando Tabela CMED para o Supabase...
                      </h4>
                      <p className="text-xs font-bold text-emerald-800">
                        {sentCount.toLocaleString('pt-BR')} de{' '}
                        {parsedRows.length.toLocaleString('pt-BR')} registros enviados ({progressPct}%)
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCancelUpload}
                    className="px-4 py-2.5 rounded-xl bg-red-600 text-white text-xs font-black uppercase tracking-wide hover:bg-red-700 transition-all"
                  >
                    Cancelar Envio
                  </button>
                </div>

                <progress
                  value={progressPct}
                  max={100}
                  className="w-full h-3 rounded-full overflow-hidden [&::-webkit-progress-bar]:bg-emerald-100 [&::-webkit-progress-value]:bg-emerald-600"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-200">
                  <span className="block text-[10px] font-black uppercase text-emerald-700">
                    Salvos / Atualizados
                  </span>
                  <span className="text-2xl font-black text-emerald-900">
                    {savedCount.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="bg-blue-50 p-4 rounded-2xl border border-blue-200">
                  <span className="block text-[10px] font-black uppercase text-blue-700">
                    Consolidados por EAN
                  </span>
                  <span className="text-2xl font-black text-blue-900">
                    {duplicatesCount.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="bg-amber-50 p-4 rounded-2xl border border-amber-200">
                  <span className="block text-[10px] font-black uppercase text-amber-700">
                    Ignorados sem EAN
                  </span>
                  <span className="text-2xl font-black text-amber-900">
                    {(ignoredNoEanCount + backendIgnoredCount).toLocaleString('pt-BR')}
                  </span>
                </div>
              </div>
            </div>
          )}

          {stage === 'done' && (
            <div className="space-y-5">
              <div
                className={`p-5 rounded-3xl border flex items-start gap-3 ${
                  uploadError
                    ? 'bg-red-50 border-red-200 text-red-800'
                    : wasCancelled
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                }`}
              >
                {uploadError ? (
                  <AlertCircle size={22} className="shrink-0 mt-0.5 text-red-600" />
                ) : wasCancelled ? (
                  <AlertTriangle size={22} className="shrink-0 mt-0.5 text-amber-600" />
                ) : (
                  <CheckCircle2 size={22} className="shrink-0 mt-0.5 text-emerald-600" />
                )}
                <div>
                  <h4 className="font-black text-base">
                    {uploadError
                      ? 'Falha na Importação da CMED'
                      : wasCancelled
                      ? 'Importação Cancelada'
                      : 'Base Oficial ANVISA / CMED Atualizada!'}
                  </h4>
                  <p className="text-xs font-medium mt-0.5">
                    {uploadError ||
                      `${detectedSheetName ? `Aba detectada: ${detectedSheetName} — ` : ''}Todos os lotes enviados já estão disponíveis na Camada 1 do Enriquecimento com IA.`}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200">
                  <span className="block text-[10px] font-black uppercase text-gray-400">
                    Total Lido
                  </span>
                  <span className="text-2xl font-black text-gray-900">
                    {totalReadRows.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-200">
                  <span className="block text-[10px] font-black uppercase text-emerald-700">
                    Salvos / Atualizados
                  </span>
                  <span className="text-2xl font-black text-emerald-900">
                    {savedCount.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="bg-blue-50 p-4 rounded-2xl border border-blue-200">
                  <span className="block text-[10px] font-black uppercase text-blue-700">
                    Duplicados no Lote
                  </span>
                  <span className="text-2xl font-black text-blue-900">
                    {duplicatesCount.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="bg-amber-50 p-4 rounded-2xl border border-amber-200">
                  <span className="block text-[10px] font-black uppercase text-amber-700">
                    Ignorados sem EAN
                  </span>
                  <span className="text-2xl font-black text-amber-900">
                    {(ignoredNoEanCount + backendIgnoredCount).toLocaleString('pt-BR')}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={resetModal}
                  className="px-5 py-3.5 rounded-2xl font-black text-xs uppercase tracking-wide bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-all flex items-center gap-2"
                >
                  <RotateCcw size={15} />
                  Importar Outra Planilha
                </button>
                <button
                  type="button"
                  onClick={handleSafeClose}
                  className="px-7 py-3.5 rounded-2xl font-black text-xs uppercase tracking-wide bg-gray-900 text-white hover:bg-gray-800 transition-all"
                >
                  Fechar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
