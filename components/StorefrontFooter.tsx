import React, { useState, useEffect } from "react";
import {
  ShieldCheck,
  FileText,
  Clock,
  MapPin,
  Phone,
  UserCheck,
  X,
  Lock,
  Scale,
  CheckCircle2,
  AlertTriangle,
  Building2,
  ExternalLink,
} from "lucide-react";
import { PharmacyConfig } from "../types";
import { getStoreOperatingStatus } from "../utils/operatingHours";

interface StorefrontFooterProps {
  tenant: PharmacyConfig;
}

export const StorefrontFooter: React.FC<StorefrontFooterProps> = ({ tenant }) => {
  const [activeModal, setActiveModal] = useState<"privacy" | "terms" | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  // Fechar modal ao pressionar ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveModal(null);
      }
    };
    if (activeModal) {
      window.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [activeModal]);

  const store = tenant;

  // Formatação do Endereço Completo (estruturado com fallbacks)
  const formatAddress = (): string => {
    const logradouro = store.logradouro || store.street;
    const numero = store.numero || store.address_number;
    const complemento = store.complemento || store.complement;
    const bairro = store.bairro || store.neighborhood;
    const cidade = store.cidade || store.city;
    const uf = store.uf || store.state;
    const cep = store.cep;

    if (logradouro || cidade || bairro) {
      let addr = `${logradouro || ''}`;
      if (numero) addr += `, ${numero}`;
      if (complemento) addr += ` (${complemento})`;
      if (bairro) addr += `, ${bairro}`;
      if (cidade) addr += ` - ${cidade}`;
      if (uf) addr += `/${uf}`;
      if (cep) addr += ` | CEP: ${cep}`;
      return addr.replace(/^,\s*/, '').trim();
    }

    if (store.fullAddress && store.fullAddress.trim()) {
      return store.fullAddress.trim();
    }
    if (store.full_address && store.full_address.trim()) {
      return store.full_address.trim();
    }

    return "Consulte nosso endereço";
  };

  const razaoSocial =
    store.razao_social ||
    store.razaoSocial ||
    (store as any).nome_loja ||
    store.name ||
    "Drogaria Online";
  const cnpjDisplay =
    store.cnpj && store.cnpj.trim() ? store.cnpj : "Cadastrado no sistema";
  const enderecoCompleto = formatAddress();
  const farmaceuticoResp =
    store.farmaceutico_responsavel ||
    store.farmaceuticoResponsavel ||
    "Consulte em loja";
  const crfDisplay = store.crf || "Consulte em loja";
  const operatingStatus = getStoreOperatingStatus(store, now);
  const horarioFuncionamento =
    store.horario_funcionamento ||
    store.horarioFuncionamento ||
    operatingStatus.scheduleSummary ||
    "Segunda a Sábado";
  const telefoneContato =
    store.telefone_contato || store.whatsapp || store.phone || "Consulte em loja";

  return (
    <>
      <footer className="w-full bg-[#0b1b4f] text-slate-300 border-t border-slate-800/80 mt-16 text-xs transition-colors">
        <div className="max-w-6xl mx-auto px-4 py-12 pb-32 sm:pb-24 space-y-8">
          
          {/* Status de Funcionamento */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <div
              className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold shadow-sm backdrop-blur-xs border transition-colors ${
                operatingStatus.isOpen
                  ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
                  : "bg-red-500/15 border-red-500/30 text-red-300"
              }`}
            >
              <span className="relative flex h-2 w-2">
                {operatingStatus.isOpen && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                )}
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${
                    operatingStatus.isOpen ? "bg-emerald-500" : "bg-red-500"
                  }`}
                ></span>
              </span>
              <Clock
                size={13}
                className={`shrink-0 ${
                  operatingStatus.isOpen ? "text-emerald-400" : "text-red-400"
                }`}
              />
              <span>{operatingStatus.badgeText}</span>
            </div>
            
            <div className="inline-flex items-center gap-1.5 bg-slate-800/60 border border-slate-700/50 text-slate-300 px-3.5 py-1.5 rounded-full text-[11px] font-medium">
              <Building2 size={13} className="text-blue-400 shrink-0" />
              <span>{tenant.name || "Drogaria"}</span>
            </div>
          </div>

          {/* Seção A: Bloco Institucional e Avisos Regulatórios da Anvisa */}
          <div className="bg-slate-950/40 border border-slate-800/80 rounded-2xl p-5 sm:p-6 text-center space-y-4 shadow-inner">
            <div className="flex items-center justify-center gap-2 text-amber-400/90 text-xs font-bold uppercase tracking-wider">
              <AlertTriangle size={15} className="shrink-0" />
              <span>Avisos Regulatórios & Uso Racional de Medicamentos (Anvisa RDC 44/2009)</span>
            </div>

            <p className="text-slate-300/90 text-[11px] sm:text-xs leading-relaxed max-w-4xl mx-auto">
              As informações contidas neste site, como promoções e ofertas de remédios e medicamentos, não devem ser usadas para automedicação e não substituem em hipótese alguma a medicação prescrita pelo profissional da área médica. Somente o médico está em condições de diagnosticar qualquer problema de saúde e prescrever o tratamento adequado. As fotos contidas em nosso site são meramente ilustrativas. Se persistirem os sintomas, procure o médico e o farmacêutico. Leia a bula.
            </p>

            <div className="pt-2 border-t border-slate-800/60">
              <p className="text-slate-400 text-[10px] sm:text-[11px] leading-relaxed">
                Preços e disponibilidade sujeitos a alterações no decorrer do dia | Ofertas válidas enquanto durarem os estoques | Vendas sujeitas a análise e confirmação de dados pela empresa.
              </p>
            </div>
          </div>

          {/* Dados Cadastrais e Regulatórios da Farmácia */}
          <div className="text-slate-300 text-xs space-y-1 text-center max-w-4xl mx-auto">
            <p className="font-semibold text-white">
              {razaoSocial} | CNPJ: {cnpjDisplay} - {enderecoCompleto}
            </p>
            <p>
              Farmacêutico Responsável: <span className="text-white font-medium">{farmaceuticoResp}</span> | CRF: <span className="text-white font-medium">{crfDisplay}</span>
            </p>
            <p>
              Horário de Funcionamento: {horarioFuncionamento} | Telefone: {telefoneContato}
            </p>
          </div>

          {/* Seção D: Links Legais (Política de Privacidade e Termos de Uso) */}
          <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 pt-2">
            <button
              type="button"
              onClick={() => setActiveModal("privacy")}
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white underline underline-offset-4 transition-colors font-medium cursor-pointer"
            >
              <Lock size={12} className="text-blue-400" />
              Política de privacidade
            </button>
            <span className="text-slate-600 hidden sm:inline">•</span>
            <button
              type="button"
              onClick={() => setActiveModal("terms")}
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white underline underline-offset-4 transition-colors font-medium cursor-pointer"
            >
              <Scale size={12} className="text-blue-400" />
              Termos e condições
            </button>
          </div>

          {/* Seção E: Assinatura de Desenvolvimento */}
          <div className="pt-4 border-t border-slate-800/80 text-center">
            <p className="text-[11px] font-medium text-slate-500 tracking-wider">
              Desenvolvido por: <span className="text-slate-400 font-semibold">FarmaFlow</span> © 2026
            </p>
          </div>

        </div>
      </footer>

      {/* MODAIS LEGAIS */}
      {activeModal && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200">
          {/* Overlay Backdrop */}
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-xs transition-opacity"
            onClick={() => setActiveModal(null)}
          />

          {/* Modal Card */}
          <div className="relative w-full max-w-2xl bg-white text-gray-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200 border border-gray-100">
            
            {/* Modal Header */}
            <div className="px-6 py-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                  {activeModal === "privacy" ? <Lock size={20} /> : <Scale size={20} />}
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-black tracking-tight text-white">
                    {activeModal === "privacy" ? "Política de Privacidade" : "Termos e Condições"}
                  </h3>
                  <p className="text-[11px] text-slate-400 font-medium">
                    {tenant.name || "Drogaria"} • Em conformidade com a LGPD e Anvisa
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="w-9 h-9 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Content com Rolagem Interna */}
            <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-6 text-sm text-gray-600 leading-relaxed">
              {activeModal === "privacy" ? (
                <>
                  <div className="bg-blue-50/70 border border-blue-100 rounded-2xl p-4 text-blue-900 text-xs flex items-start gap-3">
                    <ShieldCheck size={20} className="text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold block mb-1">Compromisso com a sua Privacidade (LGPD - Lei nº 13.709/2018)</span>
                      Garantimos a total segurança, sigilo e transparência no tratamento dos seus dados cadastrais e de entrega.
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h4 className="font-black text-gray-900 text-sm uppercase tracking-wide flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center text-xs text-gray-700">1</span>
                      Coleta e Utilização Exclusiva para Entrega
                    </h4>
                    <p>
                      Os dados pessoais informados pelo cliente (tais como <strong>nome completo, telefone/WhatsApp e endereço de entrega</strong>) são coletados exclusivamente para a operacionalização dos pedidos de compras e viabilização da entrega em domicílio (delivery).
                    </p>
                  </div>

                  <div className="space-y-3">
                    <h4 className="font-black text-gray-900 text-sm uppercase tracking-wide flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center text-xs text-gray-700">2</span>
                      Não Compartilhamento com Terceiros
                    </h4>
                    <p>
                      A <strong>{razaoSocial}</strong> não comercializa, não aluga e não compartilha seus dados pessoais com terceiros para fins de marketing ou publicidade. As informações são restritas à equipe de atendimento e aos entregadores designados exclusivamente para a rota do seu pedido.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <h4 className="font-black text-gray-900 text-sm uppercase tracking-wide flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center text-xs text-gray-700">3</span>
                      Segurança e Armazenamento
                    </h4>
                    <p>
                      Utilizamos protocolos rígidos de segurança e criptografia para resguardar a integridade das suas informações. Nenhum dado bancário de cartão de crédito é armazenado em nossos servidores locais; as transações eletrônicas são processadas por gateways de pagamento homologados e seguros.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <h4 className="font-black text-gray-900 text-sm uppercase tracking-wide flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center text-xs text-gray-700">4</span>
                      Direitos do Titular de Dados
                    </h4>
                    <p>
                      Em consonância com o Artigo 18 da LGPD, você possui o direito de confirmar a existência de tratamento, solicitar a correção de dados incompletos ou a exclusão definitiva do seu cadastro a qualquer momento, mediante solicitação aos nossos canais oficiais de atendimento.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="bg-amber-50/70 border border-amber-200/70 rounded-2xl p-4 text-amber-900 text-xs flex items-start gap-3">
                    <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold block mb-1">Normas Regulatórias Farmacêuticas</span>
                      Transações realizadas sob a fiscalização dos órgãos sanitários competentes e da Anvisa (RDC nº 44/2009).
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h4 className="font-black text-gray-900 text-sm uppercase tracking-wide flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center text-xs text-gray-700">1</span>
                      Medicamentos sob Controle Especial e Receituário
                    </h4>
                    <p>
                      Em estrito cumprimento à <strong>Portaria SVS/MS nº 344/1998 e RDC Anvisa nº 44/2009</strong>, medicamentos sob controle especial (tarja preta e antibióticos sujeitos a retenção de receita) não podem ter a venda concluída de forma 100% remota sem a verificação presencial do receituário.
                    </p>
                    <p className="text-xs bg-gray-50 p-3 rounded-xl border border-gray-100 text-gray-600">
                      • A entrega desses produtos está condicionada à apresentação e recolhimento da via original da receita médica válida no momento da entrega pelo entregador habilitado ou retirada em balcão.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <h4 className="font-black text-gray-900 text-sm uppercase tracking-wide flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center text-xs text-gray-700">2</span>
                      Entrega Local e Conferência no Recebimento
                    </h4>
                    <p>
                      O cliente compromete-se a conferir a integridade dos itens, lacres de segurança e quantidade no ato da entrega física. Havendo qualquer divergência ou violação de embalagem, o cliente deve recusar o recebimento imediatamente comunicando a farmácia.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <h4 className="font-black text-gray-900 text-sm uppercase tracking-wide flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center text-xs text-gray-700">3</span>
                      Prazos de Validade e Condições de Armazenamento
                    </h4>
                    <p>
                      Garantimos que todos os medicamentos e produtos cosméticos expedidos possuem prazo de validade regular e foram armazenados sob rigoroso controle de temperatura e umidade, conforme exigido pela legislação sanitária nacional.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <h4 className="font-black text-gray-900 text-sm uppercase tracking-wide flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center text-xs text-gray-700">4</span>
                      Preços, Estoques e Confirmação de Pedidos
                    </h4>
                    <p>
                      Todas as compras estão sujeitas à confirmação de disponibilidade de estoque e validação dos dados cadastrais pela drogaria antes do envio. Em caso de falta momentânea de algum item, nossa equipe entrará em contato para sugerir substituição equivalente ou estorno.
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md active:scale-95 cursor-pointer"
              >
                Compreendi e Concordo
              </button>
            </div>

          </div>
        </div>
      )}
    </>
  );
};
