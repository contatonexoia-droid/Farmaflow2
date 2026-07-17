import React, { useState } from 'react';
import { migrateControlledProducts } from '../services/storage';
import { ShieldAlert, Loader2, CheckCircle2 } from 'lucide-react';

interface ControlledProductsMigrationToolProps {
  tenantId: string;
}

export const ControlledProductsMigrationTool: React.FC<ControlledProductsMigrationToolProps> = ({ tenantId }) => {
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<{ success: boolean; count?: number; error?: string } | null>(null);

  const handleMigration = async () => {
    if (!confirm("Esta ação irá analisar todos os produtos e marcar automaticamente como 'Retenção de Receita' aqueles que contêm palavras-chave como 'Tarja Preta', 'Controlado', etc. Deseja continuar?")) {
      return;
    }

    setIsMigrating(true);
    setMigrationResult(null);

    try {
      const count = await migrateControlledProducts(tenantId);
      setMigrationResult({ success: true, count });
    } catch (error: any) {
      setMigrationResult({ success: false, error: error.message || "Erro desconhecido" });
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-amber-100 mt-8">
      <div className="flex items-start gap-6">
        <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-500 shrink-0 shadow-sm">
          <ShieldAlert size={32} />
        </div>
        <div className="flex-1 space-y-4">
          <div>
            <h3 className="text-xl font-black text-gray-900 tracking-tight">Migração de Medicamentos Controlados</h3>
            <p className="text-sm font-medium text-gray-500 mt-2 leading-relaxed">
              Esta ferramenta analisa seu catálogo atual e marca automaticamente produtos que exigem retenção de receita, baseando-se em palavras-chave (ex: "Tarja Preta", "Psicotrópico", "Controlado") presentes no nome, descrição ou categoria.
            </p>
          </div>

          {migrationResult && (
            <div className={`p-4 rounded-2xl border flex items-center gap-3 ${migrationResult.success ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-red-50 border-red-100 text-red-800'}`}>
              {migrationResult.success ? (
                <>
                  <CheckCircle2 size={20} className="text-emerald-500" />
                  <span className="text-sm font-bold">
                    Migração concluída! {migrationResult.count} produtos foram atualizados.
                  </span>
                </>
              ) : (
                <>
                  <ShieldAlert size={20} className="text-red-500" />
                  <span className="text-sm font-bold">
                    Erro na migração: {migrationResult.error}
                  </span>
                </>
              )}
            </div>
          )}

          <button
            onClick={handleMigration}
            disabled={isMigrating}
            className="px-6 py-3 bg-amber-500 text-white rounded-xl font-black text-sm hover:bg-amber-600 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {isMigrating ? <Loader2 className="animate-spin" size={18} /> : <ShieldAlert size={18} />}
            {isMigrating ? 'Analisando e Migrando...' : 'Iniciar Migração'}
          </button>
        </div>
      </div>
    </div>
  );
};
