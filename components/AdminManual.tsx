
import React, { useState } from 'react';
import { 
  BookOpen, ShoppingBag, FileSpreadsheet, Palette, Trash2, 
  Plus, Edit3, Wand2, FileText, Printer, FileImage, 
  Store, MessageCircle, ArrowRight, Layers, RefreshCw, 
  Settings, Sparkles, Star, Zap, BrainCircuit, Search, Bell,
  ChevronDown, ChevronUp, LayoutDashboard, Tag, Activity
} from 'lucide-react';

const AccordionItem = ({ title, icon, children, isOpen, onToggle }: { title: string, icon: React.ReactNode, children: React.ReactNode, isOpen: boolean, onToggle: () => void }) => {
  return (
    <div className={`bg-white rounded-[2rem] border transition-all duration-300 ${isOpen ? 'border-emerald-200 shadow-xl' : 'border-gray-100 shadow-sm hover:border-emerald-100'}`}>
      <button 
        onClick={onToggle}
        className="w-full flex items-center justify-between p-6 md:p-8 text-left focus:outline-none"
      >
        <div className="flex items-center gap-4">
          <div className={`p-3 rounded-2xl transition-colors ${isOpen ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-50 text-gray-500'}`}>
            {icon}
          </div>
          <h3 className={`text-xl md:text-2xl font-black ${isOpen ? 'text-gray-900' : 'text-gray-700'}`}>
            {title}
          </h3>
        </div>
        <div className={`p-2 rounded-full transition-colors ${isOpen ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-50 text-gray-400'}`}>
          {isOpen ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
        </div>
      </button>
      <div 
        className={`overflow-hidden transition-all duration-500 ease-in-out ${isOpen ? 'max-h-[5000px] opacity-100' : 'max-h-0 opacity-0'}`}
      >
        <div className="p-6 md:p-8 pt-0 border-t border-gray-50">
          {children}
        </div>
      </div>
    </div>
  );
};

export const AdminManual: React.FC = () => {
  const [openSection, setOpenSection] = useState<number>(0);

  return (
    <div className="space-y-8 animate-in fade-in duration-700 pb-20 w-full">
      <div className="bg-white p-8 md:p-12 rounded-[3rem] border border-gray-100 shadow-sm">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-[1.5rem] flex items-center justify-center shrink-0">
            <BookOpen size={32} />
          </div>
          <div>
            <h2 className="text-3xl font-black text-gray-900 tracking-tight">Manual Operacional do FarmaFlow AI</h2>
            <p className="text-gray-500 font-medium mt-1">O guia completo, definitivo e aprofundado para operação e gestão de vendas da sua drogaria digital.</p>
          </div>
        </div>

        <div className="space-y-6 lg:mx-8">
          <AccordionItem 
            title="1. Dashboard (Painel Geral)" 
            icon={<LayoutDashboard size={24} />} 
            isOpen={openSection === 0} 
            onToggle={() => setOpenSection(openSection === 0 ? -1 : 0)}
          >
            <div className="space-y-8">
              <p className="text-gray-600 font-medium leading-relaxed">
                O Dashboard é a sua torre de controle. Ele fornece uma visão imediata e em tempo real da saúde do seu negócio. O objetivo desta tela é permitir que você acompanhe o fluxo de vendas sem precisar abrir relatórios complexos.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-gray-50 p-6 rounded-3xl">
                  <div className="flex items-center gap-2 mb-4">
                    <Activity className="text-blue-500" size={20} />
                    <h4 className="font-bold text-gray-900">Métricas de Desempenho</h4>
                  </div>
                  <ul className="space-y-3 text-sm text-gray-600">
                    <li><strong className="text-gray-800">Vendas Hoje:</strong> O faturamento bruto diário originado pela plataforma online.</li>
                    <li><strong className="text-gray-800">Pendentes:</strong> Número de pedidos que entraram no sistema e ainda não foram processados pela equipe ou confirmados.</li>
                    <li><strong className="text-gray-800">Ticket Médio:</strong> Valor médio que cada cliente tem gasto por pedido na farmácia. Fundamental para medir engajamento com upsell.</li>
                    <li><strong className="text-gray-800">Novos Clientes:</strong> Cadastros inéditos realizados na loja nos últimos períodos, essencial para medir a atração de público.</li>
                  </ul>
                </div>

                <div className="bg-gray-50 p-6 rounded-3xl">
                  <div className="flex items-center gap-2 mb-4">
                    <FileSpreadsheet className="text-emerald-500" size={20} />
                    <h4 className="font-bold text-gray-900">Gráficos e Relatórios</h4>
                  </div>
                  <ul className="space-y-3 text-sm text-gray-600">
                    <li><strong className="text-gray-800">Faturamento Semanal:</strong> Gráfico de barras demonstrando o ritmo financeiro dos últimos 7 dias.</li>
                    <li><strong className="text-gray-800">Desempenho de Promoções:</strong> Ranking das ofertas que mais atraíram cliques e conversões na vitrine.</li>
                    <li><strong className="text-gray-800">Desempenho de Cupons:</strong> Acompanhamento de quais códigos de desconto estão realmente motivando o fechamento de carrinhos.</li>
                  </ul>
                </div>

                <div className="bg-gray-50 p-6 rounded-3xl">
                  <div className="flex items-center gap-2 mb-4">
                    <Zap className="text-amber-500" size={20} />
                    <h4 className="font-bold text-gray-900">Ações Rápidas</h4>
                  </div>
                  <ul className="space-y-3 text-sm text-gray-600">
                    <li><strong className="text-gray-800">Novo Pedido Balcão:</strong> Inicia rapidamente uma venda presencial utilizando a base de produtos online.</li>
                    <li><strong className="text-gray-800">Cadastrar Produto:</strong> Atalho direto para inclusão de novas mercadorias no catálogo.</li>
                    <li><strong className="text-gray-800">Ver Loja Online:</strong> Abre a vitrine exatamente da forma como o cliente final visualiza.</li>
                  </ul>
                </div>

                <div className="bg-gray-50 p-6 rounded-3xl">
                  <div className="flex items-center gap-2 mb-4">
                    <Bell className="text-purple-500" size={20} />
                    <h4 className="font-bold text-gray-900">Alertas e Monitoramento</h4>
                  </div>
                  <ul className="space-y-3 text-sm text-gray-600">
                    <li><strong className="text-gray-800">Últimos Pedidos:</strong> Uma fila espelhada e ao vivo dos carrinhos recentemente concluídos.</li>
                    <li><strong className="text-gray-800">Últimos Alertas:</strong> Avisos cruciais automáticos do sistema (como estoque crítico ou itens expirando).</li>
                  </ul>
                </div>
              </div>
            </div>
          </AccordionItem>

          <AccordionItem 
            title="2. Pedidos (Gerenciamento de Vendas)" 
            icon={<ShoppingBag size={24} />} 
            isOpen={openSection === 1} 
            onToggle={() => setOpenSection(openSection === 1 ? -1 : 1)}
          >
            <div className="space-y-8">
              <p className="text-gray-600 font-medium leading-relaxed">
                Este módulo é o coração operacional de atendimento. Nele, sua equipe de expedição vai tratar cada compra, desde a entrada até a saída para entrega.
              </p>

              <div className="grid grid-cols-1 gap-6">
                <div className="border border-gray-100 p-6 rounded-3xl">
                  <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <RefreshCw className="text-sky-500" size={20} /> 
                    Fluxo de Status do Pedido
                  </h4>
                  <div className="flex flex-wrap gap-3 mb-4">
                    <span className="px-3 py-1 bg-amber-100 text-amber-800 font-bold text-xs rounded-full">Pendente</span>
                    <ArrowRight size={16} className="text-gray-300 mt-1" />
                    <span className="px-3 py-1 bg-blue-100 text-blue-800 font-bold text-xs rounded-full">Confirmado</span>
                    <ArrowRight size={16} className="text-gray-300 mt-1" />
                    <span className="px-3 py-1 bg-emerald-100 text-emerald-800 font-bold text-xs rounded-full">Enviado</span>
                    <ArrowRight size={16} className="text-gray-300 mt-1" />
                    <span className="px-3 py-1 bg-red-100 text-red-800 font-bold text-xs rounded-full">Cancelado</span>
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Todo pedido nasce como <strong className="text-gray-800">Pendente</strong>, disparando o alerta sonoro na loja. Após conferir se o pagamento foi realizado (ou se será na entrega), o atendente separa a medicação fisicamente e altera o status para <strong className="text-gray-800">Confirmado</strong>. Assim que o entregador sair da farmácia, altera-se para <strong className="text-gray-800">Enviado</strong>. Se houver ruptura de estoque ou falha na receita retida, utiliza-se <strong className="text-gray-800">Cancelado</strong>.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="border border-gray-100 p-6 rounded-3xl">
                    <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                      <MessageCircle className="text-green-500" size={20} />
                      Ações de Recuperação
                    </h4>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      Sempre que um cliente tiver um problema (falta de produto, divergência no valor ou atraso no PIX), o botão estratégico <strong className="text-gray-800">"Recuperar Venda (WhatsApp)"</strong> abrirá automaticamente o WhatsApp web/app já com o número do cliente pré-preenchido com os detalhes da compra para negociar a manutenção da venda.
                    </p>
                  </div>
                  <div className="border border-gray-100 p-6 rounded-3xl">
                    <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                      <Search className="text-purple-500" size={20} />
                      Filtros e Impressão
                    </h4>
                    <p className="text-sm text-gray-600 leading-relaxed mb-4">
                      Utilize a barra de pesquisa rápida para localizar clientes exatos ou referências de ID fornecidos no balcão. Através das abas de status rápidas (Ex: "Apenas Pendentes"), a tela não precisará ser recarregada.
                    </p>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      Clicando no pedido, você pode acessar <strong className="text-gray-800">"Ver Detalhes"</strong> e imprimir o espelho da compra (comprovante limpo, ideal para anexar na sacola do motoboy).
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </AccordionItem>

          <AccordionItem 
            title="3. Produtos (Catálogo Farmacêutico)" 
            icon={<Layers size={24} />} 
            isOpen={openSection === 2} 
            onToggle={() => setOpenSection(openSection === 2 ? -1 : 2)}
          >
            <div className="space-y-8">
              <p className="text-gray-600 font-medium leading-relaxed">
                Um catálogo organizado vende por si só. Esta seção gerencia cada SKU, interage com a busca inteligente do cliente e fornece ferramentas de marketing visual direto da prateleira virtual.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-gray-50 p-6 rounded-3xl">
                  <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <Search size={18} className="text-blue-500"/> Buscas e Filtros Rápidos
                  </h4>
                  <ul className="space-y-3 text-sm text-gray-600">
                    <li><strong className="text-gray-800">Estoque Zerado:</strong> Lista todos os produtos indisponíveis para reposição imediata.</li>
                    <li><strong className="text-gray-800">Sem Foto:</strong> Exige atenção, pois usuários raramente compram itens sem visualização do rótulo/caixa.</li>
                    <li><strong className="text-gray-800">Destaques:</strong> Filtra os produtos fixados com estrelas que dominam a landing page inicial da loja.</li>
                    <li><strong className="text-gray-800">Múltiplos Níveis:</strong> O cruzamento dinâmico permite que você filtre por Departamento &gt; Subcategoria &gt; Fabricante e então pesquise uma palavra-chave.</li>
                  </ul>
                </div>

                <div className="bg-gray-50 p-6 rounded-3xl">
                  <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <Palette size={18} className="text-pink-500"/> Marketing Impresso Digital
                  </h4>
                  <p className="text-sm text-gray-600 leading-relaxed mb-3">
                    A ferramenta exclusiva <strong className="text-gray-800">"Gerar Encarte"</strong> acaba com o custo de design:
                  </p>
                  <ol className="list-decimal pl-4 space-y-2 text-sm text-gray-600 font-medium">
                    <li>Marque os produtos desejados na checkbox esquerdas da tabela.</li>
                    <li>Clique no botão roxo de Gerar Encarte.</li>
                    <li>O sistema diagramará um folheto visual JPG ou PDF, renderizando os rótulos, preços "De/Por" com a mesma paleta de cores da identidade da sua loja.</li>
                    <li>Pronto para envio imediato nos grupos VIPs do WhatsApp.</li>
                  </ol>
                </div>

                <div className="bg-gray-50 p-6 rounded-3xl">
                  <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <FileSpreadsheet size={18} className="text-emerald-500"/> Integrações Lote a Lote
                  </h4>
                  <ul className="space-y-3 text-sm text-gray-600">
                    <li><strong className="text-gray-800">Exportar Faltas:</strong> Gera um relatório CSV dos itens zerados para envio ao fornecedor.</li>
                    <li><strong className="text-gray-800">Atualizar via Planilha:</strong> Interface que recebe listas Excel do seu ERP gerencial para conciliação em massa do preço e estoque sem digitação manual.</li>
                    <li><strong className="text-gray-800">Gerenciar Departamentos:</strong> Local para adicionar novas prateleiras lógicas ou deletar categorias inúteis (possui trava de segurança se houver produtos vinculados).</li>
                  </ul>
                </div>

                <div className="bg-gray-50 p-6 rounded-3xl">
                  <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <Plus size={18} className="text-amber-500"/> Cadastro Avançado de Itens
                  </h4>
                  <ul className="space-y-3 text-sm text-gray-600">
                    <li><strong className="text-gray-800">Variações Perfeitas:</strong> Usado para itens da mesma linha (Ex: "Fralda P", "Fralda M", "Fralda G"), impedindo a criação de dezenas de anúncios dispersos. Na tela do cliente, ele verá caixas elegantes para alternar os tamanhos.</li>
                    <li><strong className="text-gray-800">Retenção de Receita:</strong> Configuração indispensável em tarjas vermelhas/pretas; força e instrui o cliente final a realizar upload da receita médica durante o checkout online, garantindo documentação sanitária prévia.</li>
                  </ul>
                </div>
              </div>
            </div>
          </AccordionItem>

          <AccordionItem 
            title="4. Promoções e Cupons (Marketing Dinâmico)" 
            icon={<Sparkles size={24} />} 
            isOpen={openSection === 3} 
            onToggle={() => setOpenSection(openSection === 3 ? -1 : 3)}
          >
            <div className="space-y-8">
              <p className="text-gray-600 font-medium leading-relaxed">
                Este módulo vai além do desconto simples. Ele orquestra os chamariscos de venda (Topbars, Combos, Códigos) com controle fino de validade e regras arquitetadas para aumentar o ticket médio.
              </p>

              <div className="space-y-6">
                <div className="border border-gray-100 p-6 rounded-3xl">
                  <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <Zap size={18} className="text-amber-500"/> Tipos Funcionais de Promoções
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                      <div className="mb-2"><span className="px-3 py-1 bg-blue-100 text-blue-700 text-[10px] font-black uppercase rounded-full tracking-wider">Oferta Relâmpago</span></div>
                      <p className="text-sm text-gray-600">
                        Ativa um card visível generalizado com um <strong>Desconto Percentual Direto (Ex: 20% OFF)</strong> nos produtos vinculados. Excelente para picos de queima de estoque como "Black Friday" nos finais de semana.
                      </p>
                    </div>
                    <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                      <div className="mb-2"><span className="px-3 py-1 bg-purple-100 text-purple-700 text-[10px] font-black uppercase rounded-full tracking-wider">Combo (Leve X Pague Y)</span></div>
                      <p className="text-sm text-gray-600">
                        Força o aumento de itens por cesta. O cliente obrigatoriamente adiciona quantidades e o carrinho <strong>cancela automaticamente o custo excedente</strong> na sacola quando a regra é satisfeita.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="border border-gray-100 p-6 rounded-3xl">
                    <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                      <Tag size={18} className="text-emerald-500"/> Gestão Lógica de Cupons
                    </h4>
                    <p className="text-sm text-gray-600 mb-3 leading-relaxed">
                      Cupons servem para aquisição restrita (redes sociais sociais ou influenciadores). O filtro da tela os separa entre <strong className="text-gray-800 text-emerald-600">ATIVOS</strong> e <strong className="text-gray-800 text-red-500">EXPIRADOS</strong>.
                    </p>
                    <p className="text-sm text-gray-600 leading-relaxed border-l-2 border-emerald-500 pl-3">
                      Ao criar ou editar um cupom, você pode <strong>limitar o número máximo de usos</strong> de forma universal, travar um <strong>valor de pedido mínimo</strong> (para não esmagar a margem de lucro), e escolher se é Valor Fixo (R$) ou Porcentagem (%).
                    </p>
                  </div>
                  
                  <div className="border border-gray-100 p-6 rounded-3xl">
                    <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                      <Settings size={18} className="text-gray-500"/> Motor de Agendamento
                    </h4>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      Nunca perca o timing de remover uma liquidação. Ao editar uma promoção ou cupom, preencha <strong className="text-gray-800">Datas de Início e Fim</strong>. Para ofertas pontuais, escolha os <strong>Dias da Semana Específicos</strong> (Ex: Somente nas Terças da Saúde) e ative horários específicos de restrição. O relógio do sistema ativará e desativará bloqueios automaticamente às 23:59:59 da sua configuração.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </AccordionItem>

          <AccordionItem 
            title="5. Histórico & Configurações de Loja" 
            icon={<Settings size={24} />} 
            isOpen={openSection === 4} 
            onToggle={() => setOpenSection(openSection === 4 ? -1 : 4)}
          >
            <div className="space-y-8">
              <p className="text-gray-600 font-medium leading-relaxed">
                Aqui são parametrizadas as leis do seu negócio no ambiente online. Do visual ao comportamento, e também a trilha de auditoria geral (anti-fraude operacional).
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="bg-gray-50 p-6 rounded-3xl">
                  <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <Activity size={18} className="text-red-500"/> Histórico de Auditoria 24h
                  </h4>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Localizado na aba Histórico do painel lateral. Este é um registro de <strong className="text-gray-800">Write-Ahead</strong>. Mantém e acopla logs irreversíveis (das últimas 24 horas) toda vez que as configurações da loja ou pedidos são alterados. Permite que o franqueado ou gestor apure quem/quando o sistema foi alterado indevidamente.
                  </p>
                </div>

                <div className="bg-gray-50 p-6 rounded-3xl">
                  <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <Palette size={18} className="text-pink-500"/> Identidade Visual (Branding)
                  </h4>
                  <ul className="space-y-3 text-sm text-gray-600">
                    <li><strong className="text-gray-800">Informações Institucionais:</strong> O Nome da Drogaria e Descrições inseridas aqui assinam todo o frontend.</li>
                    <li><strong className="text-gray-800">Logotipo:</strong> Um upload simples garante o rosto do seu negócio no site e na nota digital.</li>
                    <li><strong className="text-gray-800">Paleta Hexadecimal:</strong> Definir as cores Primária (botão principal), Secundária (Fundo) e Destaque transforma arquitetonicamente os botões e os cartões para a sua marca proprietária instantaneamente (Live Refresh).</li>
                  </ul>
                </div>

                <div className="bg-gray-50 p-6 rounded-3xl">
                  <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <BrainCircuit size={18} className="text-emerald-500"/> Regras e Fluxos
                  </h4>
                  <ul className="space-y-3 text-sm text-gray-600">
                    <li><strong className="text-gray-800">Ponto de Contato (WhatsApp):</strong> Preencha o número oficial da expedição (ex: 55 DDD NÚMERO). É para esta exata chave que a automação apontará o checkout do cliente com o ID.</li>
                    <li><strong className="text-gray-800">Ticket e Logística:</strong> Cadastre rigorosamente o "Pedido Mínimo de Entrega" (R$) para evitar entregas deficitárias, além de poder embutir a Taxa de Entrega padrão.</li>
                    <li><strong className="text-gray-800">Som de Alerta:</strong> A escolha do som no banco ou upload próprio para garantir a perfuração de ruído no salão de loja a cada pedido.</li>
                  </ul>
                </div>
              </div>
            </div>
          </AccordionItem>

          <AccordionItem 
            title="6. Gerenciamento de Equipe e Funcionários" 
            icon={<Store size={24} />} 
            isOpen={openSection === 5} 
            onToggle={() => setOpenSection(openSection === 5 ? -1 : 5)}
          >
            <div className="space-y-8">
              <p className="text-gray-600 font-medium leading-relaxed">
                Para garantir o controle e a organização das operações da sua farmácia, você tem total autonomia para gerenciar os acessos da sua equipe de trabalho diretamente pelo sistema, com segurança e muita praticidade.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-gray-50 p-6 rounded-3xl">
                  <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <Plus size={18} className="text-blue-500"/> Como Cadastrar Novos Membros
                  </h4>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    O Proprietário tem total liberdade para criar contas para seus colaboradores a qualquer momento, até mesmo pelo próprio celular! Você pode definir níveis de acesso conforme a necessidade da sua farmácia: <strong className="text-gray-800">Administradores, Gerentes ou Operadores</strong>. Basta abrir o gerenciamento da equipe, selecionar para adicionar um novo funcionário e preencher os dados de cadastro e a função exercida no estabelecimento.
                  </p>
                </div>

                <div className="bg-gray-50 p-6 rounded-3xl">
                  <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <LayoutDashboard size={18} className="text-emerald-500"/> Nova Experiência Mobile
                  </h4>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Sabemos que a gestão da sua farmácia acontece não apenas no computador, mas na palma da mão. Por isso, nossa tela de cadastro e edição de funcionários é agora <strong className="text-gray-800">100% otimizada para celulares</strong>, permitindo visualizar erros de digitação e os botões de ação perfeitamente, sem travar a tela.
                  </p>
                </div>

                <div className="bg-gray-50 p-6 rounded-3xl">
                  <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <Trash2 size={18} className="text-red-500"/> Exclusão Definitiva
                  </h4>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Ao clicar para excluir um funcionário, o sistema pedirá uma confirmação e removerá o acesso dele imediatamente e de forma definitiva do banco de dados. Seu nome some da lista na hora, garantindo máxima segurança para sua loja.
                  </p>
                </div>
              </div>
            </div>
          </AccordionItem>
        </div>

        <div className="mt-16 p-8 bg-emerald-600 rounded-[2.5rem] text-white flex flex-col lg:flex-row items-center justify-between gap-8 shadow-2xl shadow-emerald-200">
          <div className="flex items-center gap-5 w-full">
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-md shrink-0">
              <MessageCircle size={32} />
            </div>
            <div>
              <h4 className="text-xl md:text-2xl font-black leading-tight">Precisa de ajuda com operações avançadas?</h4>
              <p className="text-emerald-100 font-medium text-sm md:text-base mt-2">Nossa equipe de suporte técnico especializada está à sua completa disposição para integrações e dúvidas emergenciais.</p>
            </div>
          </div>
          <a 
            href="https://wa.me/5522981552881" 
            target="_blank" 
            rel="noreferrer"
            className="w-full lg:w-auto bg-white text-emerald-600 px-8 py-5 rounded-2xl font-black uppercase text-sm flex items-center justify-center gap-2 hover:scale-105 hover:bg-emerald-50 transition-all shadow-xl whitespace-nowrap"
          >
            Falar com Especialista <ArrowRight size={18} />
          </a>
        </div>
      </div>
    </div>
  );
};

