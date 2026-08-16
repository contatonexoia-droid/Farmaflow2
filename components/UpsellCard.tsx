import React from 'react';
import { Sparkles, ShieldCheck } from 'lucide-react';

interface UpsellCardProps {
  title: string;
  description: string;
  icon: React.ElementType;
  features: Array<{
    title: string;
    description: string;
    icon: React.ElementType;
    iconColor: string;
  }>;
}

export const UpsellCard: React.FC<UpsellCardProps> = ({ title, description, icon: Icon, features }) => {
  return (
    <div className="space-y-8 animate-in fade-in p-6">
      <div className="bg-gradient-to-br from-purple-900 via-indigo-900 to-gray-950 text-white p-10 md:p-14 rounded-[3rem] shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-12 opacity-10 pointer-events-none">
          <Icon size={240} />
        </div>
        <div className="max-w-2xl relative z-10 space-y-6">
          <div className="inline-flex items-center gap-2 bg-purple-500/20 text-purple-300 border border-purple-500/30 px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-wider">
            <Sparkles size={14} /> Recurso Especial / Plano Upgrade
          </div>
          <h3 className="text-3xl md:text-4xl font-black tracking-tight leading-tight">
            {title}
          </h3>
          <p className="text-purple-200/90 text-sm md:text-base leading-relaxed">
            {description}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
            {features.map((feature, idx) => {
              const FeatureIcon = feature.icon;
              return (
                <div key={idx} className="bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/10 flex items-start gap-3">
                  <FeatureIcon className={`${feature.iconColor} shrink-0 mt-0.5`} size={20} />
                  <div>
                    <h5 className="font-bold text-sm text-white">{feature.title}</h5>
                    <p className="text-xs text-purple-200">{feature.description}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-purple-950/80 border border-purple-400/30 p-5 rounded-2xl flex items-center justify-between gap-4 mt-6">
            <div className="flex items-center gap-3">
              <ShieldCheck className="text-purple-300 shrink-0" size={24} />
              <div>
                <p className="text-xs font-bold text-purple-100">Disponível mediante liberação do Plano Master</p>
                <p className="text-[11px] text-purple-300">Entre em contato com o suporte ou administrador do sistema para habilitar o módulo para esta farmácia.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
