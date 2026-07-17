import React, { useState } from 'react';
import { DeliverySettingsConfig, DeliveryFeeRange } from '../types';
import { Truck, DollarSign, Award, Info, MapPin, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { SmartNumberInput } from './SmartNumberInput';

interface DeliverySettingsProps {
  settings: DeliverySettingsConfig;
  onChange: (settings: DeliverySettingsConfig) => void;
}

export const DeliverySettings: React.FC<DeliverySettingsProps> = ({ settings, onChange }) => {
  const [error, setError] = useState<string | null>(null);

  const handleToggle = () => {
    onChange({
      ...settings,
      enabled: !settings.enabled
    });
  };

  const handleTypeChange = (type: 'fixed' | 'dynamic') => {
    onChange({
      ...settings,
      type,
      ranges: type === 'dynamic' && !settings.ranges ? [] : settings.ranges
    });
  };

  const handleFeeChange = (value: number | null) => {
    onChange({
      ...settings,
      fee: value || 0
    });
  };

  const handleMinOrderChange = (value: number | null) => {
    onChange({
      ...settings,
      minOrderForFreeDelivery: value || 0
    });
  };

  const validateRanges = (ranges: DeliveryFeeRange[]) => {
    // Check for overlaps
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        const r1 = ranges[i];
        const r2 = ranges[j];
        if (Math.max(r1.minKm, r2.minKm) < Math.min(r1.maxKm, r2.maxKm)) {
          setError('As faixas de distância se sobrepõem. Verifique os valores de KM.');
          return false;
        }
      }
    }
    setError(null);
    return true;
  };

  const addRange = () => {
    const newRanges = [...(settings.ranges || []), {
      id: crypto.randomUUID(),
      minKm: 0,
      maxKm: 5,
      fee: 5
    }];
    if (validateRanges(newRanges)) {
      onChange({ ...settings, ranges: newRanges });
    } else {
      onChange({ ...settings, ranges: newRanges }); // Allow invalid state so user can fix it, but error is shown
    }
  };

  const updateRange = (id: string, field: keyof DeliveryFeeRange, value: number | null) => {
    const newRanges = (settings.ranges || []).map(r => 
      r.id === id ? { ...r, [field]: value || 0 } : r
    );
    validateRanges(newRanges);
    onChange({ ...settings, ranges: newRanges });
  };

  const removeRange = (id: string) => {
    const newRanges = (settings.ranges || []).filter(r => r.id !== id);
    validateRanges(newRanges);
    onChange({ ...settings, ranges: newRanges });
  };

  return (
    <div className="space-y-8 animate-in fade-in">
      <div className="bg-gray-50/50 rounded-[2.5rem] p-6 md:p-8 border border-gray-100">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-gray-100">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center shrink-0">
              <Truck size={24} />
            </div>
            <div>
              <h3 className="text-lg font-black text-gray-900">Taxa de Entrega</h3>
              <p className="text-sm text-gray-500 mt-0.5">Defina se sua farmácia cobra taxa de entrega e quais os valores.</p>
            </div>
          </div>
          <div className="flex items-center gap-3 self-start md:self-auto">
            <span className={`text-sm font-black uppercase tracking-wider ${settings.enabled ? 'text-emerald-600' : 'text-gray-400'}`}>
              {settings.enabled ? 'Ativa' : 'Inativa'}
            </span>
            <button
              type="button"
              onClick={handleToggle}
              className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                settings.enabled ? 'bg-emerald-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                  settings.enabled ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {settings.enabled ? (
          <div className="pt-8 animate-in slide-in-from-top-4 duration-300">
            
            <div className="flex gap-4 mb-8">
              <button 
                onClick={() => handleTypeChange('fixed')}
                className={`flex-1 py-4 px-6 rounded-2xl border-2 font-bold transition-all ${
                  (!settings.type || settings.type === 'fixed') 
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-700' 
                    : 'border-gray-200 bg-white text-gray-500 hover:border-emerald-200'
                }`}
              >
                Taxa Fixa Única
              </button>
              <button 
                onClick={() => handleTypeChange('dynamic')}
                className={`flex-1 py-4 px-6 rounded-2xl border-2 font-bold transition-all ${
                  settings.type === 'dynamic' 
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-700' 
                    : 'border-gray-200 bg-white text-gray-500 hover:border-emerald-200'
                }`}
              >
                Taxa Dinâmica por KM
              </button>
            </div>

            {(!settings.type || settings.type === 'fixed') && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                <div className="space-y-2">
                  <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                    <DollarSign size={14} className="text-emerald-600" /> Valor da Taxa de Entrega (R$)
                  </label>
                  <div className="relative">
                    <span className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400 font-bold z-10">R$</span>
                    <SmartNumberInput
                      isFloat={true}
                      className="w-full bg-white border-2 border-gray-100 focus:border-emerald-600 rounded-2xl py-4 pl-14 pr-6 outline-none transition-all font-bold text-black relative z-0 shadow-sm"
                      value={settings.fee}
                      onChangeValue={handleFeeChange}
                      placeholder="0.00"
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 italic px-1">Valor fixo cobrado para realizar a entrega do pedido.</p>
                </div>
              </div>
            )}

            {settings.type === 'dynamic' && (
              <div className="mb-8 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-gray-900">Faixas de Distância</h4>
                    <p className="text-xs text-gray-500">Adicione as regras de frete baseado na distância em KM.</p>
                  </div>
                  <button 
                    onClick={addRange}
                    className="px-4 py-2 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 font-bold text-xs rounded-xl flex items-center gap-2 transition-colors"
                  >
                    <Plus size={14} /> Nova Faixa
                  </button>
                </div>

                {error && (
                  <div className="bg-red-50 text-red-600 p-4 rounded-xl text-xs font-bold flex items-center gap-2">
                    <AlertTriangle size={16} /> {error}
                  </div>
                )}

                <div className="space-y-3">
                  {(settings.ranges || []).length === 0 ? (
                    <div className="text-center py-6 bg-white border-2 border-dashed border-gray-200 rounded-2xl text-gray-400 text-sm font-medium">
                      Nenhuma faixa cadastrada. Clique em "Nova Faixa" para começar.
                    </div>
                  ) : (
                    (settings.ranges || []).map((range) => (
                      <div key={range.id} className="flex flex-col sm:flex-row items-center gap-4 bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
                        <div className="flex-1 flex items-center gap-2">
                          <span className="text-xs font-bold text-gray-500 uppercase">De</span>
                          <div className="relative">
                            <SmartNumberInput 
                              isFloat={true}
                              value={range.minKm}
                              onChangeValue={(val) => updateRange(range.id, 'minKm', val)}
                              className="w-20 sm:w-24 bg-gray-50 border border-gray-200 focus:border-emerald-500 rounded-xl py-2 px-3 outline-none font-bold text-sm text-center"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-[10px] font-bold pointer-events-none">KM</span>
                          </div>
                          
                          <span className="text-xs font-bold text-gray-500 uppercase">Até</span>
                          <div className="relative">
                            <SmartNumberInput 
                              isFloat={true}
                              value={range.maxKm}
                              onChangeValue={(val) => updateRange(range.id, 'maxKm', val)}
                              className="w-20 sm:w-24 bg-gray-50 border border-gray-200 focus:border-emerald-500 rounded-xl py-2 px-3 outline-none font-bold text-sm text-center"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-[10px] font-bold pointer-events-none">KM</span>
                          </div>
                        </div>

                        <div className="flex-1 sm:flex-none flex items-center gap-2 w-full sm:w-auto">
                          <span className="text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Taxa =</span>
                          <div className="relative flex-1 sm:w-32">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm z-10">R$</span>
                            <SmartNumberInput 
                              isFloat={true}
                              value={range.fee}
                              onChangeValue={(val) => updateRange(range.id, 'fee', val)}
                              className="w-full bg-emerald-50 border border-emerald-200 focus:border-emerald-500 rounded-xl py-2 pl-9 pr-3 outline-none font-bold text-emerald-800 text-sm"
                            />
                          </div>
                          <button 
                            onClick={() => removeRange(range.id)}
                            className="p-2.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <p className="text-[10px] text-gray-400 italic">Distâncias maiores que a última faixa cadastrada serão consideradas "Fora da área de entrega".</p>
              </div>
            )}

            {/* Valor Mínimo para Frete Grátis (sempre disponível) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8 border-t border-gray-100 pt-8">
              <div className="space-y-2">
                <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                  <Award size={14} className="text-amber-500" /> Valor mínimo para Frete Grátis (R$)
                </label>
                <div className="relative">
                  <span className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400 font-bold z-10">R$</span>
                  <SmartNumberInput
                    isFloat={true}
                    className="w-full bg-white border-2 border-gray-100 focus:border-emerald-600 rounded-2xl py-4 pl-14 pr-6 outline-none transition-all font-bold text-black relative z-0 shadow-sm"
                    value={settings.minOrderForFreeDelivery || 0}
                    onChangeValue={handleMinOrderChange}
                    placeholder="0.00"
                  />
                </div>
                <p className="text-[10px] text-gray-400 italic px-1">Se o valor dos produtos for maior ou igual a este valor, a taxa de entrega será gratuita. Deixe 0 ou vazio para desativar esta regra.</p>
              </div>
            </div>

            {/* Info box */}
            <div className="bg-emerald-50/50 border border-emerald-100/50 rounded-2xl p-4 flex items-start gap-3 mt-2">
              <Info className="text-emerald-600 shrink-0 mt-0.5" size={16} />
              <div className="text-xs text-emerald-800 leading-relaxed font-medium">
                <strong>Dica de Vendas:</strong> Configurar frete grátis para compras acima de um valor específico é um excelente gatilho de vendas. O cliente adiciona mais itens ao carrinho para obter o frete grátis, aumentando o ticket médio da sua farmácia.
              </div>
            </div>

          </div>
        ) : (
          <div className="text-center py-10 text-gray-400 flex flex-col items-center justify-center gap-2">
            <Truck size={36} className="text-gray-300 stroke-[1.5]" />
            <p className="text-sm font-bold">Taxa de entrega desativada</p>
            <p className="text-xs max-w-xs leading-relaxed">Sua farmácia não está cobrando taxa de entrega no momento. Todos os pedidos serão processados com entrega gratuita.</p>
          </div>
        )}
      </div>
    </div>
  );
};
