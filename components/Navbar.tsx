
import React from 'react';
import { ViewMode, PharmacyConfig, AuthSession } from '../types';
import { LogOut, ArrowLeft, Menu, Lock, ShoppingBag, Shield, ShoppingCart } from 'lucide-react';

interface NavbarProps {
  currentView: ViewMode;
  onViewChange: (view: ViewMode) => void;
  cartCount: number;
  config: PharmacyConfig;
  session: AuthSession; 
  onToggleSidebar?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentView, onViewChange, cartCount, config, session, onToggleSidebar }) => {
  const isStoreContext = !!config.id;
  // Agora consideramos tanto o Catálogo quanto o Carrinho como visualizações da "Loja" (Branding da Drogaria)
  const isCatalogView = currentView === ViewMode.CATALOG || currentView === ViewMode.CART;
  const isGuest = session.type === 'GUEST';
  
  // Decidimos ocultar controles administrativos na loja para que o dono veja exatamente o que o cliente vê
  const showAdminControls = !isCatalogView && !isGuest;

  const handleNavigate = (view: ViewMode) => {
    onViewChange(view);
  };

  return (
    <nav className={`backdrop-blur-xl border-b sticky top-0 z-[60] shadow-sm transition-all duration-300 ${isCatalogView ? 'bg-white/95 border-gray-100' : 'bg-white/80 border-gray-200'}`}>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-20 items-center">
          
          {/* Logo Area */}
          <div className="flex items-center gap-4">
            
            {onToggleSidebar && !isCatalogView && (
                 <button onClick={(e) => { e.stopPropagation(); onToggleSidebar(); }} className="md:hidden p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">
                     <Menu size={24} />
                 </button>
            )}

            {isCatalogView && (
                 <button onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('ffToggleStoreDrawer')); }} className="p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">
                     <Menu size={24} />
                 </button>
            )}

            <div className={`w-11 h-11 rounded-xl flex items-center justify-center font-black text-xl overflow-hidden shadow-sm transition-transform ${isCatalogView ? 'bg-transparent border-none' : 'bg-white border border-gray-100 group-hover:scale-105'}`}>
               {config.logo ? (
                 <img src={config.logo} alt={config.name} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
               ) : (
                 <div className={`w-full h-full flex items-center justify-center ${isCatalogView ? 'bg-brand text-brand-contrast rounded-xl' : 'text-brand'}`} style={isCatalogView ? { backgroundColor: config.primaryColor } : {}}>
                    {config.name?.charAt(0) || 'F'}
                 </div>
               )}
            </div>
            
            <div className="flex flex-col">
              {isCatalogView ? (
                  <>
                    <span className="text-lg md:text-xl font-black text-gray-900 leading-none tracking-tight line-clamp-1">
                        {config.name || 'FarmaFlow'}
                    </span>
                    <span className="text-[10px] font-black text-brand uppercase tracking-widest mt-1 flex items-center gap-1" style={{ color: config.primaryColor }}>
                        {currentView === ViewMode.CART ? <ShoppingCart size={10} /> : <ShoppingBag size={10} />} 
                        {currentView === ViewMode.CART ? 'Meu Carrinho' : 'Catálogo Digital'}
                    </span>
                  </>
              ) : (
                  <>
                    <span className="text-xl font-black text-gray-900 leading-none tracking-tight">
                        Farma<span className="text-brand">Flow</span>
                    </span>
                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest mt-1 opacity-80">
                        {session.type === 'SUPER_ADMIN' ? 'Portal Master' : 'Painel Administrativo'}
                    </span>
                  </>
              )}
            </div>
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-3">
             {/* Botão de retorno para o Super Admin quando visualizando uma loja específica */}
             {session.type === 'SUPER_ADMIN' && isStoreContext && isCatalogView && (
                <button 
                    onClick={() => handleNavigate(ViewMode.ADMIN_SUPER)}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-xl text-xs font-bold hover:bg-gray-800 transition-colors shadow-lg"
                >
                    <ArrowLeft size={14} /> <span className="hidden sm:inline">Voltar ao Portal</span>
                </button>
             )}

             {/* Na visão de ADMIN, mostramos botão para ver a loja */}
             {currentView === ViewMode.ADMIN_PHARMACY && (
                 <button 
                    onClick={() => handleNavigate(ViewMode.CATALOG)}
                    className="hidden md:flex items-center gap-2 px-5 py-2.5 bg-brand/10 text-brand rounded-xl text-xs font-black uppercase tracking-wide hover:bg-brand/20 transition-colors"
                    style={{ backgroundColor: `${config.primaryColor}1a`, color: config.primaryColor }}
                 >
                    <ShoppingBag size={14} /> Ver Loja Online
                 </button>
             )}

             {/* Se o dono estiver na loja e quiser voltar para o painel, ele usa o botão "Voltar" (onBack) do Storefront ou este botão discreto */}
             {isCatalogView && !isGuest && session.type === 'PHARMACY_ADMIN' && (
                 <button 
                    onClick={() => handleNavigate(ViewMode.ADMIN_PHARMACY)}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-100 transition-all border border-emerald-100"
                 >
                    <Shield size={12} /> Voltar ao Painel
                 </button>
             )}

             {/* Botão de Sair apenas em telas de administração */}
             {showAdminControls && (
                 <button 
                    onClick={() => handleNavigate(ViewMode.LOGIN)}
                    className="p-2.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                    title="Sair do Painel"
                 >
                    <LogOut size={20} />
                 </button>
             )}

             {isCatalogView && isGuest && (
                <div className="hidden md:flex items-center gap-1 text-[10px] font-bold text-gray-400 uppercase bg-gray-50 px-3 py-1.5 rounded-full border border-gray-100">
                    <Lock size={10} /> Ambiente Seguro
                </div>
             )}

             {isCatalogView && (
                 <button 
                    onClick={() => handleNavigate(ViewMode.CART)}
                    className="flex items-center justify-center p-2 text-gray-600 hover:bg-gray-100 hover:text-red-500 rounded-xl transition-all relative"
                 >
                    <ShoppingCart size={24} />
                    {cartCount > 0 && (
                      <span className="absolute -top-1 -right-1 bg-red-600 text-white w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black shadow-sm">
                        {cartCount}
                      </span>
                    )}
                 </button>
             )}
          </div>
        </div>
      </div>
    </nav>
  );
};
