import React from "react";
import { FlashDealsScheduleConfig } from "../types";
import { Clock, Calendar, Repeat } from "lucide-react";

export const ScheduleEditor = ({
  config,
  onChange,
}: {
  config?: FlashDealsScheduleConfig;
  onChange: (c: FlashDealsScheduleConfig | undefined) => void;
}) => {
  const act =
    config ||
    ({
      frequency: "DAILY",
      startTime: "00:00",
      endTime: "23:59",
    } as FlashDealsScheduleConfig);

  const daysOfWeek = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  return (
    <div className="space-y-4 p-5 bg-orange-50/50 border border-orange-100 rounded-2xl relative">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-orange-600">
          <Repeat size={16} />
          <span className="text-[11px] font-black uppercase tracking-widest">
            Agendamento Recorrente (Opcional)
          </span>
        </div>
        {config && (
          <button
            onClick={() => onChange(undefined)}
            className="text-xs text-orange-500 hover:text-red-500 underline font-bold"
          >
            Remover Agendamento
          </button>
        )}
      </div>

      {!config && (
        <button
          onClick={() => onChange(act)}
          className="px-4 py-2 bg-orange-100 text-orange-700 rounded-lg text-xs font-bold hover:bg-orange-200 transition-colors"
        >
          + Adicionar Regra de Agendamento
        </button>
      )}

      {config && (
        <div className="space-y-4 animate-in fade-in">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-orange-500/70 tracking-widest ml-1">
                Frequência
              </label>
              <select
                value={act.frequency}
                onChange={(e) =>
                  onChange({ ...act, frequency: e.target.value as any })
                }
                className="w-full px-3 py-2 rounded-xl border border-orange-200 text-sm font-medium focus:border-orange-500 focus:ring-0 bg-white"
              >
                <option value="DAILY">Diária</option>
                <option value="WEEKLY">Semanal</option>
                <option value="MONTHLY">Mensal</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-orange-500/70 tracking-widest ml-1">
                Hora de Início
              </label>
              <input
                type="time"
                value={act.startTime || "00:00"}
                onChange={(e) =>
                  onChange({ ...act, startTime: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-orange-200 text-sm font-medium focus:border-orange-500 focus:ring-0 bg-white"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-orange-500/70 tracking-widest ml-1">
                Hora de Término
              </label>
              <input
                type="time"
                value={act.endTime || "23:59"}
                onChange={(e) => onChange({ ...act, endTime: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-orange-200 text-sm font-medium focus:border-orange-500 focus:ring-0 bg-white"
              />
            </div>
          </div>

          {act.frequency === "WEEKLY" && (
            <div className="space-y-2 pt-2 border-t border-orange-100">
              <label className="text-[10px] font-black uppercase text-orange-500/70 tracking-widest ml-1">
                Dias da Semana
              </label>
              <div className="flex gap-2 flex-wrap">
                {daysOfWeek.map((day, idx) => {
                  const isSelected = act.daysOfWeek?.includes(idx);
                  return (
                    <button
                      key={idx}
                      onClick={() => {
                        const cur = act.daysOfWeek || [];
                        const next = isSelected
                          ? cur.filter((d) => d !== idx)
                          : [...cur, idx];
                        onChange({ ...act, daysOfWeek: next });
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${isSelected ? "bg-orange-500 text-white shadow-md shadow-orange-500/20" : "bg-white border border-orange-200 text-orange-500 hover:bg-orange-50"}`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {act.frequency === "MONTHLY" && (
            <div className="space-y-2 pt-2 border-t border-orange-100">
              <label className="text-[10px] font-black uppercase text-orange-500/70 tracking-widest ml-1">
                Dias do Mês (1-31, separe por vírgula)
              </label>
              <input
                type="text"
                placeholder="Ex: 5, 10, 20"
                value={act.daysOfMonth?.join(", ") || ""}
                onChange={(e) => {
                  const str = e.target.value;
                  const days = str
                    .split(",")
                    .map((s) => parseInt(s.trim()))
                    .filter((n) => !isNaN(n) && n >= 1 && n <= 31);
                  onChange({ ...act, daysOfMonth: days });
                }}
                className="w-full px-3 py-2 rounded-xl border border-orange-200 text-sm font-medium focus:border-orange-500 focus:ring-0 bg-white"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
