import React, { useState, useRef, useEffect, useMemo } from 'react';
import { PharmacyConfig } from '../types';
import { Building2, ChevronDown, Check, Search, Globe, Shield, Store, MapPin, Sparkles, Layers, Lock } from 'lucide-react';

interface TenantSelectorProps {
  tenants: PharmacyConfig[];
  currentTenant: PharmacyConfig | null;
  onSelectTenant: (tenant: PharmacyConfig) => void;
  isMatrixUser?: boolean;
  userRole?: string;
  networkName?: string;
  isConsolidated?: boolean;
  onToggleConsolidated?: (consolidated: boolean) => void;
  className?: string;
}

export const TenantSelector: React.FC<TenantSelectorProps> = ({
  tenants,
  currentTenant,
  onSelectTenant,
  isMatrixUser = false,
  userRole = '',
  networkName = 'Rede FarmaFlow',
  isConsolidated = false,
  onToggleConsolidated,
  className = ''
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const cleanRole = (userRole || '').toLowerCase().trim();
  const isRestrictedRole = useMemo(() => {
    return [
      'operador',
      'balconista',
      'atendente',
      'farmaceutico',
      'caixa',
      'vendedor',
      'entregador',
      'gerente'
    ].includes(cleanRole);
  }, [cleanRole]);

  // Se o usuário tiver papel restrito de operador ou não for da Matriz (ou houver <= 1 loja), o seletor é bloqueado e estático
  const canSwitch = useMemo(() => {
    if (isRestrictedRole) return false;
    return Boolean(isMatrixUser) && Array.isArray(tenants) && tenants.length > 1;
  }, [isRestrictedRole, isMatrixUser, tenants]);

  // Lojas visíveis: se não tiver permissão de matriz, estritamente APENAS a loja atual vinculada
  const visibleTenants = canSwitch ? tenants : (currentTenant ? [currentTenant] : []);

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredTenants = visibleTenants.filter(t => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      (t.name && t.name.toLowerCase().includes(q)) ||
      (t.slug && t.slug.toLowerCase().includes(q)) ||
      (t.cnpj && t.cnpj.includes(q)) ||
      (t.fullAddress && t.fullAddress.toLowerCase().includes(q))
    );
  });

  // Se for operador de filial/loja sem privilégio de Administrador Master, exibe unidade travada (somente leitura)
  if (!canSwitch) {
    const roleLabel = cleanRole === 'balconista' ? 'Balconista' :
                      cleanRole === 'operador' ? 'Operador' :
                      cleanRole === 'gerente' ? 'Gerente' :
                      cleanRole === 'farmaceutico' ? 'Farmacêutico' :
                      cleanRole === 'entregador' ? 'Entregador' :
                      'Unidade Fixa';

    return (
      <div className={`relative inline-block text-left ${className}`}>
        <div 
          title={`Unidade Fixa: ${currentTenant?.name || 'Drogaria'} (Acesso restrito à filial vinculada)`}
          className="w-full flex items-center justify-between gap-2.5 px-3 py-2 bg-gray-50/90 text-gray-800 rounded-xl border border-gray-200/90 shadow-2xs text-xs font-bold select-none cursor-default"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center justify-center shrink-0 font-black">
              <Store size={15} className="text-emerald-700" />
            </div>
            <div className="flex flex-col text-left min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] uppercase font-black tracking-wider text-gray-400 truncate">
                  Unidade Vinculada
                </span>
              </div>
              <span className="text-gray-900 font-extrabold text-xs truncate max-w-[150px] sm:max-w-[210px]">
                {currentTenant?.name || 'Drogaria'}
              </span>
            </div>
          </div>
          <span className="text-[9px] font-bold text-gray-500 bg-gray-200/70 px-2 py-0.5 rounded-md shrink-0 flex items-center gap-1">
            <Lock size={10} className="text-gray-400" />
            {roleLabel}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative inline-block text-left ${className}`} ref={dropdownRef}>
      {/* Botão Gatilho do Seletor de Loja / Rede (Apenas Administradores Master da Rede) */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between gap-2.5 px-3 py-2 bg-white hover:bg-gray-50 text-gray-800 rounded-xl border border-gray-200 hover:border-gray-300 shadow-2xs transition-all text-xs font-bold focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 cursor-pointer"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 font-black">
            {isConsolidated ? (
              <Globe size={15} className="text-emerald-700" />
            ) : (
              <Store size={15} className="text-emerald-700" />
            )}
          </div>

          <div className="flex flex-col text-left min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] uppercase font-black tracking-wider text-gray-400 truncate">
                {isConsolidated ? 'Visão Consolidada' : 'Unidade Selecionada'}
              </span>
              {currentTenant?.isNetworkMaster && !isConsolidated && (
                <span className="bg-purple-100 text-purple-700 text-[8px] font-black px-1.5 py-0.2 rounded-full uppercase shrink-0">
                  Matriz
                </span>
              )}
            </div>
            <span className="text-gray-900 font-extrabold text-xs truncate max-w-[140px] sm:max-w-[200px]">
              {isConsolidated ? `Todas as Unidades (${visibleTenants.length})` : currentTenant?.name || 'Selecione uma loja'}
            </span>
          </div>
        </div>

        <ChevronDown size={14} className={`text-gray-400 shrink-0 ml-1 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Menu Suspenso */}
      {isOpen && (
        <div className="absolute left-0 sm:right-0 sm:left-auto mt-2 w-[calc(100vw-2rem)] sm:w-88 md:w-96 max-w-sm bg-white rounded-2xl shadow-2xl border border-gray-100 py-2 z-50 animate-in fade-in zoom-in-95 duration-150">
          {/* Cabeçalho da Rede */}
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/70 rounded-t-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 size={16} className="text-emerald-600" />
                <span className="text-xs font-black text-gray-900">{networkName}</span>
              </div>
              <span className="text-[10px] font-bold text-gray-500 bg-gray-200/80 px-2 py-0.5 rounded-full">
                {visibleTenants.length} {visibleTenants.length === 1 ? 'Loja' : 'Lojas'}
              </span>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              Alterne entre unidades para visualizar chats, pedidos e estoque em tempo real.
            </p>
          </div>

          {/* Opção de Visão Consolidada (Toda a Rede) */}
          {onToggleConsolidated && (
            <div className="p-2 border-b border-gray-100">
              <button
                type="button"
                onClick={() => {
                  onToggleConsolidated(true);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all ${
                  isConsolidated
                    ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                    : 'hover:bg-gray-50 text-gray-700'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shadow-xs">
                    <Globe size={16} />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-black">Visão Consolidada da Rede</span>
                      <span className="text-[9px] bg-emerald-200 text-emerald-800 font-bold px-1.5 py-0.2 rounded">
                        Tudo
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-500">Métricas agregadas de todas as farmácias da rede</p>
                  </div>
                </div>
                {isConsolidated && <Check size={16} className="text-emerald-600" />}
              </button>
            </div>
          )}

          {/* Campo de Busca de Lojas */}
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar por nome, cidade ou CNPJ..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-medium text-gray-800 placeholder-gray-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
          </div>

          {/* Lista de Unidades */}
          <div className="max-h-64 overflow-y-auto p-2 space-y-1">
            {filteredTenants.length === 0 ? (
              <div className="p-4 text-center text-xs text-gray-400">
                Nenhuma loja encontrada para "{search}".
              </div>
            ) : (
              filteredTenants.map((t) => {
                const isSelected = !isConsolidated && currentTenant?.id === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      if (onToggleConsolidated) onToggleConsolidated(false);
                      onSelectTenant(t);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all ${
                      isSelected
                        ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                        : 'hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs text-white shrink-0 shadow-2xs"
                        style={{ backgroundColor: t.primaryColor || '#059669' }}
                      >
                        {t.name ? t.name.charAt(0).toUpperCase() : 'F'}
                      </div>
                      <div className="truncate">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-gray-900 truncate">{t.name}</span>
                          {t.isNetworkMaster && (
                            <span className="text-[8px] font-black uppercase px-1.5 py-0.2 rounded bg-purple-100 text-purple-700">
                              Matriz
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-400 truncate">
                          {t.fullAddress || t.slug || t.id}
                        </p>
                      </div>
                    </div>

                    {isSelected && <Check size={16} className="text-emerald-600 shrink-0 ml-2" />}
                  </button>
                );
              })
            )}
          </div>

          {/* Rodapé Informativo */}
          <div className="px-4 py-2 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between text-[10px] text-gray-400">
            <span>Perfil: <strong>Administrador Matriz</strong></span>
            <span>RLS Multi-Tenant Ativo</span>
          </div>
        </div>
      )}
    </div>
  );
};

