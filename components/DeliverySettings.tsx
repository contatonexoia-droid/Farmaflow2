import React, { useState } from 'react';
import { DeliverySettingsConfig, DeliveryFeeRange, DeliveryNeighborhood } from '../types';
import { Truck, DollarSign, Award, Info, MapPin, Plus, Trash2, AlertTriangle, Clock, Search, Power, Check, Building2 } from 'lucide-react';
import { SmartNumberInput } from './SmartNumberInput';

interface DeliverySettingsProps {
  settings: DeliverySettingsConfig;
  onChange: (settings: DeliverySettingsConfig) => void;
}

export const DeliverySettings: React.FC<DeliverySettingsProps> = ({ settings, onChange }) => {
  const [error, setError] = useState<string | null>(null);

  // Estados para Gerenciador de Bairros
  const [isAddingNeigh, setIsAddingNeigh] = useState(false);
  const [newNeighName, setNewNeighName] = useState('');
  const [newNeighFee, setNewNeighFee] = useState<number>(5);
  const [newNeighTime, setNewNeighTime] = useState('');
  const [neighSearch, setNeighSearch] = useState('');
  const [neighError, setNeighError] = useState<string | null>(null);

  const handleToggle = () => {
    onChange({
      ...settings,
      enabled: !settings.enabled
    });
  };

  const isNeighborhood = settings.type === 'neighborhood' || settings.delivery_fee_type === 'neighborhood';
  const isDistance = (settings.type === 'dynamic' || settings.type === 'distance' || settings.delivery_fee_type === 'distance') && !isNeighborhood;
  const isFixed = !isNeighborhood && !isDistance;

  const handleTypeChange = (selectedMode: 'fixed' | 'distance' | 'neighborhood') => {
    if (selectedMode === 'fixed') {
      onChange({
        ...settings,
        type: 'fixed',
        delivery_fee_type: 'fixed'
      });
    } else if (selectedMode === 'distance') {
      onChange({
        ...settings,
        type: 'dynamic',
        delivery_fee_type: 'distance',
        ranges: (!settings.ranges || settings.ranges.length === 0) ? [] : settings.ranges
      });
    } else if (selectedMode === 'neighborhood') {
      onChange({
        ...settings,
        type: 'neighborhood',
        delivery_fee_type: 'neighborhood',
        neighborhoods: (!settings.neighborhoods) ? [] : settings.neighborhoods
      });
    }
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

  const handleDefaultNeighborhoodFeeChange = (value: number | null) => {
    onChange({
      ...settings,
      defaultNeighborhoodFee: value || 0
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
      onChange({ ...settings, ranges: newRanges });
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

  // Funções do Gerenciador de Bairros
  const handleAddNeighborhood = () => {
    const trimmedName = newNeighName.trim();
    if (!trimmedName) {
      setNeighError('Informe o nome do bairro.');
      return;
    }

    const currentList = settings.neighborhoods || [];
    const exists = currentList.some(
      n => n.name.trim().toLowerCase() === trimmedName.toLowerCase()
    );

    if (exists) {
      setNeighError(`O bairro "${trimmedName}" já está cadastrado.`);
      return;
    }

    const newNeighborhood: DeliveryNeighborhood = {
      id: crypto.randomUUID(),
      name: trimmedName,
      fee: newNeighFee !== null ? Number(newNeighFee) : 0,
      estimated_time: newNeighTime.trim() || undefined,
      active: true
    };

    const updated = [...currentList, newNeighborhood];
    onChange({
      ...settings,
      neighborhoods: updated
    });

    setNewNeighName('');
    setNewNeighFee(5);
    setNewNeighTime('');
    setNeighError(null);
    setIsAddingNeigh(false);
  };

  const toggleNeighborhoodActive = (id: string) => {
    const updated = (settings.neighborhoods || []).map(n => {
      if (n.id === id) {
        const currentActive = n.active !== false;
        return { ...n, active: !currentActive };
      }
      return n;
    });
    onChange({ ...settings, neighborhoods: updated });
  };

  const updateNeighborhoodFee = (id: string, feeVal: number | null) => {
    const updated = (settings.neighborhoods || []).map(n => {
      if (n.id === id) {
        return { ...n, fee: feeVal || 0 };
      }
      return n;
    });
    onChange({ ...settings, neighborhoods: updated });
  };

  const updateNeighborhoodTime = (id: string, timeVal: string) => {
    const updated = (settings.neighborhoods || []).map(n => {
      if (n.id === id) {
        return { ...n, estimated_time: timeVal };
      }
      return n;
    });
    onChange({ ...settings, neighborhoods: updated });
  };

  const removeNeighborhood = (id: string) => {
    const updated = (settings.neighborhoods || []).filter(n => n.id !== id);
    onChange({ ...settings, neighborhoods: updated });
  };

  const neighborhoodsList = settings.neighborhoods || [];
  const filteredNeighborhoods = neighborhoodsList.filter(n =>
    n.name.toLowerCase().includes(neighSearch.toLowerCase().trim())
  );
  const activeCount = neighborhoodsList.filter(n => n.active !== false).length;

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
              <p className="text-sm text-gray-500 mt-0.5">Defina a modalidade de cobrança de taxa de entrega da sua farmácia.</p>
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
            
            {/* Modalidades de Taxa: Fixa, Por KM e Por Bairro */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <button 
                type="button"
                onClick={() => handleTypeChange('fixed')}
                className={`py-4 px-6 rounded-2xl border-2 font-bold transition-all text-center ${
                  isFixed 
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-700 shadow-sm' 
                    : 'border-gray-200 bg-white text-gray-500 hover:border-emerald-200'
                }`}
              >
                Taxa Fixa Única
              </button>
              <button 
                type="button"
                onClick={() => handleTypeChange('distance')}
                className={`py-4 px-6 rounded-2xl border-2 font-bold transition-all text-center ${
                  isDistance 
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-700 shadow-sm' 
                    : 'border-gray-200 bg-white text-gray-500 hover:border-emerald-200'
                }`}
              >
                Taxa por Quilômetro
              </button>
              <button 
                type="button"
                onClick={() => handleTypeChange('neighborhood')}
                className={`py-4 px-6 rounded-2xl border-2 font-bold transition-all text-center ${
                  isNeighborhood 
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-700 shadow-sm' 
                    : 'border-gray-200 bg-white text-gray-500 hover:border-emerald-200'
                }`}
              >
                Taxa por Bairro
              </button>
            </div>

            {/* 1. MODALIDADE TAXA FIXA */}
            {isFixed && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8 animate-in fade-in">
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
                  <p className="text-[10px] text-gray-400 italic px-1">Valor fixo cobrado para realizar a entrega de qualquer pedido.</p>
                </div>
              </div>
            )}

            {/* 2. MODALIDADE TAXA DINÂMICA POR KM / DISTÂNCIA */}
            {isDistance && (
              <div className="mb-8 space-y-4 animate-in fade-in">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-gray-900">Faixas de Distância</h4>
                    <p className="text-xs text-gray-500">Adicione as regras de frete baseado na distância em KM.</p>
                  </div>
                  <button 
                    type="button"
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
                            type="button"
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

            {/* 3. MODALIDADE TAXA POR BAIRRO */}
            {isNeighborhood && (
              <div className="mb-8 space-y-6 animate-in fade-in">
                {/* Cabeçalho do Gerenciador de Bairros */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-gray-100">
                  <div>
                    <div className="flex items-center gap-2">
                      <Building2 size={18} className="text-emerald-600" />
                      <h4 className="text-sm font-bold text-gray-900">Gerenciador de Bairros Atendidos</h4>
                      <span className="text-[11px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                        {activeCount} de {neighborhoodsList.length} ativos
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Configure o valor do frete e o tempo estimado para cada bairro.</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddingNeigh(!isAddingNeigh);
                        setNeighError(null);
                      }}
                      className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center gap-2 shadow-sm transition-all"
                    >
                      <Plus size={15} /> Adicionar Bairro
                    </button>
                  </div>
                </div>

                {/* Formulário para Adicionar Novo Bairro */}
                {isAddingNeigh && (
                  <div className="bg-white p-5 rounded-2xl border-2 border-emerald-500/30 shadow-md space-y-4 animate-in slide-in-from-top-2">
                    <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                      <span className="text-xs font-black text-emerald-800 uppercase tracking-wider flex items-center gap-1.5">
                        <Plus size={14} /> Novo Bairro de Entrega
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddingNeigh(false);
                          setNeighError(null);
                        }}
                        className="text-xs text-gray-400 hover:text-gray-600 font-bold"
                      >
                        Cancelar
                      </button>
                    </div>

                    {neighError && (
                      <div className="bg-red-50 text-red-600 p-3 rounded-xl text-xs font-bold flex items-center gap-2">
                        <AlertTriangle size={15} /> {neighError}
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {/* Nome do Bairro */}
                      <div className="space-y-1 sm:col-span-1">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-wider">
                          Nome do Bairro *
                        </label>
                        <input
                          type="text"
                          value={newNeighName}
                          onChange={(e) => setNewNeighName(e.target.value)}
                          placeholder="Ex: Centro, Barra, Bela Vista"
                          className="w-full bg-gray-50 border border-gray-200 focus:border-emerald-500 rounded-xl py-2.5 px-3.5 outline-none font-bold text-sm text-gray-800"
                        />
                      </div>

                      {/* Taxa de Entrega */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-wider">
                          Taxa de Entrega (R$) *
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-xs z-10">R$</span>
                          <SmartNumberInput
                            isFloat={true}
                            value={newNeighFee}
                            onChangeValue={(val) => setNewNeighFee(val || 0)}
                            placeholder="0.00"
                            className="w-full bg-gray-50 border border-gray-200 focus:border-emerald-500 rounded-xl py-2.5 pl-9 pr-3 outline-none font-bold text-sm text-emerald-800"
                          />
                        </div>
                      </div>

                      {/* Tempo Estimado */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-wider">
                          Tempo Estimado (opcional)
                        </label>
                        <div className="relative">
                          <Clock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input
                            type="text"
                            value={newNeighTime}
                            onChange={(e) => setNewNeighTime(e.target.value)}
                            placeholder="Ex: 30-50 min"
                            className="w-full bg-gray-50 border border-gray-200 focus:border-emerald-500 rounded-xl py-2.5 pl-9 pr-3 outline-none font-bold text-sm text-gray-700"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={handleAddNeighborhood}
                        className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all"
                      >
                        Salvar Bairro
                      </button>
                    </div>
                  </div>
                )}

                {/* Barra de Busca de Bairros (quando há mais de 3 cadastrados) */}
                {neighborhoodsList.length > 3 && (
                  <div className="relative">
                    <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={neighSearch}
                      onChange={(e) => setNeighSearch(e.target.value)}
                      placeholder="Buscar bairro cadastrado..."
                      className="w-full bg-white border border-gray-200 focus:border-emerald-500 rounded-xl py-2.5 pl-10 pr-4 text-xs font-bold text-gray-700 outline-none"
                    />
                  </div>
                )}

                {/* Tabela / Lista de Bairros */}
                <div className="space-y-2.5">
                  {neighborhoodsList.length === 0 ? (
                    <div className="text-center py-10 bg-white border-2 border-dashed border-gray-200 rounded-2xl p-6 text-gray-400">
                      <Building2 size={32} className="mx-auto text-gray-300 stroke-[1.5] mb-2" />
                      <p className="text-sm font-bold text-gray-700">Nenhum bairro cadastrado ainda</p>
                      <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                        Clique em <strong>+ Adicionar Bairro</strong> acima para cadastrar as regiões atendidas pela sua tele-entrega.
                      </p>
                    </div>
                  ) : filteredNeighborhoods.length === 0 ? (
                    <div className="text-center py-6 bg-white border border-gray-100 rounded-2xl text-xs text-gray-400">
                      Nenhum bairro encontrado para a busca "{neighSearch}".
                    </div>
                  ) : (
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                      {/* Cabeçalho da Tabela (Desktop) */}
                      <div className="hidden sm:grid sm:grid-cols-12 gap-3 px-4 py-3 bg-gray-50/80 border-b border-gray-200 text-[10px] font-black text-gray-400 uppercase tracking-wider">
                        <div className="col-span-4">Bairro</div>
                        <div className="col-span-3">Tempo Estimado</div>
                        <div className="col-span-3">Taxa (R$)</div>
                        <div className="col-span-2 text-right">Ações</div>
                      </div>

                      {/* Linhas */}
                      <div className="divide-y divide-gray-100">
                        {filteredNeighborhoods.map((neighborhood) => {
                          const isActive = neighborhood.active !== false;
                          return (
                            <div
                              key={neighborhood.id}
                              className={`p-3.5 sm:px-4 sm:py-3 transition-colors ${
                                isActive ? 'bg-white hover:bg-gray-50/50' : 'bg-gray-50/60 opacity-75'
                              }`}
                            >
                              <div className="flex flex-col sm:grid sm:grid-cols-12 sm:items-center gap-3">
                                {/* Nome do Bairro & Status */}
                                <div className="sm:col-span-4 flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => toggleNeighborhoodActive(neighborhood.id)}
                                    title={isActive ? "Pausar entrega neste bairro" : "Ativar entrega neste bairro"}
                                    className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                                      isActive 
                                        ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' 
                                        : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                                    }`}
                                  >
                                    <Power size={13} />
                                  </button>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className={`text-sm font-bold truncate ${isActive ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
                                        {neighborhood.name}
                                      </span>
                                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider ${
                                        isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                                      }`}>
                                        {isActive ? 'Ativo' : 'Pausado'}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                {/* Tempo Estimado */}
                                <div className="sm:col-span-3">
                                  <div className="flex items-center gap-1.5 text-xs text-gray-600 font-medium">
                                    <Clock size={13} className="text-gray-400 shrink-0" />
                                    <input
                                      type="text"
                                      value={neighborhood.estimated_time || ''}
                                      onChange={(e) => updateNeighborhoodTime(neighborhood.id, e.target.value)}
                                      placeholder="Ex: 30-50 min"
                                      className="w-full bg-transparent border-b border-transparent hover:border-gray-300 focus:border-emerald-500 px-1 py-0.5 text-xs font-semibold text-gray-700 outline-none transition-colors"
                                    />
                                  </div>
                                </div>

                                {/* Valor da Taxa */}
                                <div className="sm:col-span-3">
                                  <div className="relative max-w-[140px]">
                                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-xs z-10">R$</span>
                                    <SmartNumberInput
                                      isFloat={true}
                                      value={neighborhood.fee}
                                      onChangeValue={(val) => updateNeighborhoodFee(neighborhood.id, val)}
                                      className={`w-full border rounded-xl py-1.5 pl-8 pr-2.5 outline-none font-bold text-xs transition-colors ${
                                        isActive 
                                          ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800 focus:border-emerald-500' 
                                          : 'bg-gray-100 border-gray-200 text-gray-500'
                                      }`}
                                    />
                                  </div>
                                </div>

                                {/* Ações Rápidas */}
                                <div className="sm:col-span-2 flex items-center justify-between sm:justify-end gap-2 pt-2 sm:pt-0 border-t sm:border-0 border-gray-100">
                                  <button
                                    type="button"
                                    onClick={() => toggleNeighborhoodActive(neighborhood.id)}
                                    className={`text-[11px] font-bold px-2 py-1 rounded-lg transition-colors ${
                                      isActive 
                                        ? 'text-amber-700 hover:bg-amber-50' 
                                        : 'text-emerald-700 hover:bg-emerald-50'
                                    }`}
                                  >
                                    {isActive ? 'Pausar' : 'Ativar'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeNeighborhood(neighborhood.id)}
                                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                    title="Excluir bairro"
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Taxa Padrão para Bairros Não Listados (Fallback) */}
                <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-2 mt-4">
                  <div className="flex items-center gap-2">
                    <DollarSign size={16} className="text-emerald-600" />
                    <h5 className="text-xs font-black text-gray-800 uppercase tracking-wider">
                      Taxa Padrão para Bairros Não Listados (Fallback)
                    </h5>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                    <div className="relative max-w-xs">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm z-10">R$</span>
                      <SmartNumberInput
                        isFloat={true}
                        value={settings.defaultNeighborhoodFee || 0}
                        onChangeValue={handleDefaultNeighborhoodFeeChange}
                        placeholder="0.00"
                        className="w-full bg-gray-50 border border-gray-200 focus:border-emerald-500 rounded-xl py-3 pl-11 pr-4 outline-none font-bold text-sm text-gray-800"
                      />
                    </div>
                    <p className="text-[11px] text-gray-500 leading-relaxed">
                      Caso o cliente informe um bairro que <strong>não consta</strong> na lista acima, esta taxa será cobrada. Se deixar <strong>0</strong> ou vazio, a entrega não será permitida para bairros fora da lista.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Valor Mínimo para Frete Grátis (sempre disponível em todas as modalidades) */}
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

      {/* Retirada em Loja Config */}
      <div className="bg-gray-50/50 rounded-[2.5rem] p-6 md:p-8 border border-gray-100">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center shrink-0">
              <MapPin size={24} />
            </div>
            <div>
              <h3 className="text-lg font-black text-gray-900">Retirada na Loja</h3>
              <p className="text-sm text-gray-500 mt-0.5">Permitir que os clientes retirem os pedidos no balcão da farmácia.</p>
            </div>
          </div>
          <div className="flex items-center gap-3 self-start md:self-auto">
            <span className={`text-sm font-black uppercase tracking-wider ${settings.storePickupEnabled ? 'text-blue-600' : 'text-gray-400'}`}>
              {settings.storePickupEnabled ? 'Ativa' : 'Inativa'}
            </span>
            <button
              type="button"
              onClick={() => onChange({ ...settings, storePickupEnabled: !settings.storePickupEnabled })}
              className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                settings.storePickupEnabled ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                  settings.storePickupEnabled ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
        {settings.storePickupEnabled && (
          <div className="mt-6 bg-blue-50/50 border border-blue-100/50 rounded-2xl p-4 flex items-start gap-3">
            <Info className="text-blue-600 shrink-0 mt-0.5" size={16} />
            <div className="text-xs text-blue-800 leading-relaxed font-medium">
              A opção de "Retirar na Loja" será exibida no carrinho. Se o cliente escolher essa opção, os campos de endereço de entrega serão ocultados durante o checkout.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
