# Manual do Lojista - FarmaFlow

## Novidades desta Versão

Bem-vindo à versão mais recente do FarmaFlow! Implementamos melhorias significativas no sistema de promoções para proteger a margem de lucro da sua drogaria e melhorar a experiência de compra do cliente.

- **Sincronização Global de Ofertas:** Quando o cronômetro da oferta relâmpago expira, a oferta é removida automaticamente da **Home**, da **Página do Produto** e do **Carrinho**. 
- **Filtro Inteligente de Oferta Relâmpago:** O banner da **Oferta Relâmpago** na **Topbar** agora atua como um filtro, isolando visualmente apenas os produtos que pertencem à promoção ativa, facilitando a navegação.
- **Visualização de Desconto Real:** Exibição consistente do preço **De/Por** em todas as telas, validando os valores em tempo real para evitar vendas com preços expirados.

---

## 1. Gestão de Ofertas e Promoções

A nova gestão de promoções utiliza **Validação em Tempo Real** para garantir que os valores promocionais sejam justos e estejam de acordo com a vigência definida por você.

### 1.1 Criando uma Oferta Relâmpago
1. Acesse o menu **DASHBOARD**, e acesse as opções de gerenciamento de promoções.
2. Selecione a opção **NOVA PROMOÇÃO**.
3. Selecione o tipo **Apenas Oferta Relâmpago**.
4. Defina o **Desconto (%)** e a **Data e Hora de Início e Término**.
5. Clique em **SALVAR PROMOÇÃO**.

> ⚠️ Atenção
> A data e hora de expiração da oferta deve ser informada com total precisão. Uma vez encerrado o tempo da oferta, todos os carrinhos de clientes contendo itens sob aquela promoção sofrerão o recálculo para o preço normal. O desconto de 15% (ou a porcentagem definida) é calculado sempre sobre o preço base cadastrado!

*Benefício para sua farmácia:* **Isso evita reclamações de clientes por preços expirados** e blinda o seu estoque contra fraudes temporais no carrinho de compras.

### 1.2 O Filtro Inteligente de Oferta Relâmpago
Quando uma **Oferta Relâmpago** estiver ativa, os clientes verão o banner destacado na página inicial.
- Em vez de buscar o produto em uma lista imensa, os clientes podem clicar em **VER OFERTA** no banner.
- Nossa inteligência de roteamento aplicará o filtro, ocultando todos os produtos comuns e mostrando apenas os itens com desconto aplicado. 
- *Benefício para sua farmácia:* Aumenta a taxa de conversão (itens ao carrinho) pois diminui significativamente o atrito da jornada de compra do cliente.

---

## 2. A Nova Sincronização Global e o Carrinho de Compras

Agora o FarmaFlow integra o processo de validação em camadas!

1. **Na Vitrine:** O badge vermelho expira em tempo real assim que o cronômetro bate as zero horas.
2. **Na Página do Produto:** Ao abrir os detalhes, a **Validação em Tempo Real** reconecta e verifica se a oferta ainda é válida, atualizando o preço.
3. **No Carrinho:** Existe um guardião assíncrono analisando o total. 
    - Se a oferta expirar enquanto o usuário decide finalizar a compra, o sistema dispara:
      *“Atenção: A oferta relâmpago expirou e o preço dos itens foi atualizado“* 
      E reconstrói o total da cobrança automaticamente.

> ⚠️ Atenção
> O cliente NUNCA levará a vantagem da precificação de cupom expirado. Quando ocorre a mudança do cálculo em tempo real, o cliente é instantaneamente notificado sobre o recálculo do carrinho, sendo impedido de concluir a etapa de pagamento com o preço obsoleto!

---

## Glossário de Status de Produtos

Para melhor gerir sua prateleira virtual, note de que forma o sistema rotula os itens e as condições atreladas:

* **Em Oferta:** O produto está sob uma regra promocional ativa ou atrelado a um cupom de desconto em vigência, refletindo a faixa promocional "Por X".
* **Oferta Válida (Cronômetro Ativo):** Exibe o ícone animado do cronometro ao cliente. Exclusivo das ofertas relâmpago atreladas ao relógio de encerramento diário ou programado.
* **Oferta Expirada:** Momento exato em que o servidor inativa a promoção. O "Badge" de desconto desaparece, as cores e fontes de preço vermelho somem, e o preço reverte ao **Estoque Normal**.
* **Estoque Normal:** O valor integral (original) cadastrado em seu Backoffice, destituído de cupons e/ou campanhas de desconto vigentes. 
* **Ativado Por Cupom:** Itens do estoque normal que tiveram abatimentos no valor total em virtude da ativação voluntária pelo cliente usando um código de checkout válido.

## 3. Limpeza do Catálogo: Como Remover Categorias Duplicadas ou Obsoletas

Manter o catálogo organizado é essencial para uma boa experiência do cliente. Se a sua loja acumulou departamentos vazios ou subcategorias duplicadas, agora você pode removê-los com segurança.

### Excluindo uma Subcategoria
1. Acesse o painel de **Departamentos e Categorias**.
2. Na seção **Mapeamento em Massa**, localize a subcategoria que deseja apagar.
3. Clique no ícone de lixeira (🗑️) ao lado do nome.
4. **Trava de Segurança:** O sistema não permite excluir subcategorias que tenham produtos vinculados. Caso tente, ele exibirá um alerta informando a quantidade de produtos vinculados.
   - *Solução:* Vá até a Gestão de Produtos, filtre por essa subcategoria e altere a categoria desses produtos para uma nova. Depois, você poderá excluir a subcategoria obsoleta.

### Excluindo um Departamento
1. Acesse o painel de **Departamentos e Categorias**.
2. Na seção **Departamentos Ativos**, clique no ícone de lixeira (🗑️) no departamento desejado.
3. Se o departamento estiver vazio, ele será excluído prontamente.
4. **Trava de Segurança e Reatribuição:** Se o departamento tiver subcategorias mapeadas ou produtos ativos, um modal de alerta surgirá.
   - Neste momento, o sistema oferecerá a vantagem de **mover automaticamente** todas as subcategorias mapeadas para um outro Departamento de sua escolha antes de a exclusão ser definitiva.
   - Isso garante que nenhum item do seu catálogo fique "órfo" e perca o acesso visual na vitrine da loja.
   - A exclusão reflete instantaneamente na loja, atualizando o menu de navegação do cliente sem necessidade de limpar cachê manual.

---

## 4. Gerenciamento de Equipe e Funcionários

Para garantir o controle e a organização das operações da sua farmácia, você tem total autonomia para gerenciar os acessos da sua equipe de trabalho diretamente pelo sistema, com segurança e muita praticidade.

### 4.1 Como Cadastrar Novos Membros
O Proprietário tem total liberdade para criar contas para seus colaboradores a qualquer momento, até mesmo pelo próprio celular! 
Você pode definir níveis de acesso conforme a necessidade da sua farmácia: **Administradores, Gerentes ou Operadores**. Basta abrir o gerenciamento da equipe, selecionar para adicionar um novo funcionário e preencher os dados de cadastro e a função exercida no estabelcimento.

### 4.2 Nova Experiência Mobile (Para Celulares)
Sabemos que a gestão da sua farmácia acontece não apenas no computador, mas na palma da mão. Por isso, nossa tela de cadastro e edição de funcionários é agora 100% otimizada para aparelhos celulares. 
Toda a navegação acontece de maneira fluida. Caso você esbarre em uma regra de digitação e o formulário mostre um alerta, o espaço de trabalho se ajusta automaticamente. Sem travamentos e sem botões "escondidos" para fora da tela. Você sempre consegue visualizar o botão de prosseguir com total clareza.

### 4.3 Exclusão Rápida e Definitiva
Caso um colaborador não faça mais parte do quadro de funcionários, o corte de acesso é imediato. Ao clicar para excluir um funcionário listado, o sistema apenas solicitará sua confirmação como medida de segurança. 
Uma vez confirmado, os dados de autorização de rede e a conta do ex-funcionário são rompidos e removidos **definitivamente** do banco de dados na mesma hora! O nome desaparecerá da sua listagem no mesmo segundo, bloqueando qualquer tipo de acesso indevido.

---

*Manual atualizado para reforçar a segurança operacional da sua farmácia. Boas Vendas!*
