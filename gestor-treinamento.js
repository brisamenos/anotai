// ═══════════════════════════════════════════════════════
// GESTOR-TREINAMENTO.JS — Central de Treinamento
// ═══════════════════════════════════════════════════════
// Tela "Central de treinamento" do gestor (menu Sistema): os vídeos curtos que
// ensinam cada ferramenta, organizados por área, com reprodução automática.
//   · ao abrir a tela, toca o próximo vídeo que a pessoa ainda não concluiu
//   · quando um vídeo termina, o seguinte começa sozinho (dá para desligar)
//   · passo a passo ao lado do vídeo: o passo em andamento fica marcado e
//     clicar num passo leva o vídeo até ele
//   · "Abrir esta tela" leva direto para a tela que o vídeo ensina
//   · o que já foi concluído fica marcado (guardado neste aparelho)
// Os vídeos e as miniaturas ficam em /assets/tutoriais/<id>.mp4 e .jpg.
// Este arquivo se liga sozinho à navegação: o gestor só precisa ter o item de
// menu (nav('treinamento')) e a <div class="page" id="page-treinamento">.
(function () {
  'use strict';

  var PASTA = '/assets/tutoriais/';
  var SUPORTE = '5588981841517';
  var ESPERA = 5; // segundos entre o fim de um vídeo e o começo do próximo

  // Áreas e vídeos (t = segundo em que o passo começa)
  var AREAS = [
    { id: "montar", nome: "Montar o cardápio", tutoriais: [
      {"id": "cardapio-criar-categoria", "titulo": "Como criar uma categoria", "curto": "Criar categoria", "resumo": "Organize o cardápio em grupos", "dur": 17, "busca": "grupo seção nova categoria", "passos": [{"t": 0.4, "x": "No menu lateral, abra o Gestor de cardápio."}, {"t": 4.9, "x": "Clique em Nova categoria."}, {"t": 7.7, "x": "Digite o nome da categoria."}, {"t": 10.6, "x": "Clique em Criar categoria."}]},
      {"id": "cardapio-cadastrar-produto", "titulo": "Como cadastrar um produto", "curto": "Cadastrar produto", "resumo": "Nome, preço, descrição e foto", "dur": 21, "busca": "item novo adicionar produto lanche prato", "passos": [{"t": 0.4, "x": "No Gestor de cardápio, abra a categoria e clique em Adicionar item."}, {"t": 5.2, "x": "Preencha o nome e a descrição."}, {"t": 8.2, "x": "Informe o preço."}, {"t": 11, "x": "Envie a foto do produto."}, {"t": 14.8, "x": "Clique em Adicionar item."}]},
      {"id": "cardapio-adicionais", "titulo": "Como criar adicionais e complementos", "curto": "Adicionais", "resumo": "Bordas, extras e complementos", "dur": 25, "busca": "adicional complemento opcional borda extra acompanhamento", "passos": [{"t": 0.4, "x": "No Gestor de cardápio, encontre o produto."}, {"t": 3.7, "x": "Clique em Editar, no fim da linha."}, {"t": 6.5, "x": "Em Grupos de customização, dê um nome ao grupo."}, {"t": 11.2, "x": "Escolha 1 para uma opção só. Múltipla para várias."}, {"t": 17.6, "x": "Cadastre cada opção com o valor a mais."}, {"t": 21.6, "x": "Clique em Salvar alterações."}]},
      {"id": "cardapio-pizza-meio-a-meio", "titulo": "Como configurar pizza meio a meio", "curto": "Pizza meio a meio", "resumo": "Sabores, tamanhos e regra do preço", "dur": 25, "busca": "sabores metade meia dois sabores tamanhos", "passos": [{"t": 0.4, "x": "No Gestor de cardápio, encontre a pizza."}, {"t": 3.6, "x": "Clique em Editar, no fim da linha."}, {"t": 6.4, "x": "Em Tipo, escolha Pizza (sabor)."}, {"t": 9.3, "x": "Ligue Permite meio a meio e marque 2 sabores."}, {"t": 13.2, "x": "Informe o preço de cada tamanho."}, {"t": 16, "x": "Escolha como cobrar o meio a meio."}, {"t": 20.9, "x": "Clique em Salvar alterações."}]},
      {"id": "cardapio-promocao", "titulo": "Como colocar um produto em promoção", "curto": "Produto em promoção", "resumo": "Preço antigo riscado e destaque", "dur": 22, "busca": "desconto oferta preço antigo riscado", "passos": [{"t": 0.4, "x": "No Gestor de cardápio, encontre o produto."}, {"t": 3.7, "x": "Clique em Editar, no fim da linha."}, {"t": 6.5, "x": "Em Preço antigo, coloque o valor cheio."}, {"t": 9.5, "x": "Em Preço, coloque o valor da promoção."}, {"t": 12.6, "x": "Ligue o Destaque para aparecer no topo do cardápio."}, {"t": 17.1, "x": "Clique em Salvar alterações."}]},
      {"id": "cardapio-pausar-produto", "titulo": "Como pausar um produto esgotado", "curto": "Pausar produto", "resumo": "Tirar e voltar um item do cardápio", "dur": 22, "busca": "esgotado acabou indisponível desativar tirar do ar", "passos": [{"t": 0.4, "x": "No Gestor de cardápio, encontre o produto que acabou."}, {"t": 4.6, "x": "Clique no botão de disponibilidade, no fim da linha."}, {"t": 8.3, "x": "O produto fica indisponível no cardápio."}, {"t": 13, "x": "Para voltar a vender, clique de novo."}, {"t": 16.5, "x": "Em Ações, você pausa a categoria inteira."}]},
      {"id": "cardapio-fotos", "titulo": "Como trocar as fotos do cardápio", "curto": "Fotos do cardápio", "resumo": "Enviar e trocar as imagens", "dur": 18, "busca": "foto imagem trocar foto", "passos": [{"t": 0.4, "x": "No menu, abra Gestor de cardápio e depois Imagens do cardápio."}, {"t": 5.7, "x": "Clique em Alterar no produto."}, {"t": 9.7, "x": "Replicar usa a mesma foto em outros produtos."}, {"t": 13.5, "x": "Use fotos claras, com o prato inteiro."}]},
      {"id": "cardapio-edicao-em-massa", "titulo": "Como mudar vários preços de uma vez", "curto": "Edição em massa", "resumo": "Preços, dias e disponibilidade", "dur": 22, "busca": "reajuste aumentar preços vários dias disponibilidade", "passos": [{"t": 0.4, "x": "No menu, abra Gestor de cardápio e depois Edição em massa."}, {"t": 6.3, "x": "Digite o novo preço direto na linha."}, {"t": 10.2, "x": "Marque os dias em que o produto é vendido."}, {"t": 14.6, "x": "Clique no status para pausar ou liberar."}, {"t": 18.2, "x": "Clique em Salvar alterações."}]},
      {"id": "cardapio-modelos-prontos", "titulo": "Como usar um cardápio pronto", "curto": "Cardápio pronto", "resumo": "Modelos por tipo de negócio", "dur": 19, "busca": "modelo pronto exemplo importar começar", "passos": [{"t": 0.4, "x": "No Gestor de cardápio, clique em Modelos prontos."}, {"t": 5.3, "x": "Escolha o modelo do seu negócio."}, {"t": 11.2, "x": "Exportar cardápio guarda uma cópia do seu."}]},
      {"id": "cardapio-organizar", "titulo": "Como organizar o cardápio", "curto": "Organizar a ordem", "resumo": "Ordem de categorias e produtos", "dur": 20, "busca": "ordem reordenar duplicar excluir apagar categoria", "passos": [{"t": 0.4, "x": "Arraste pelos pontinhos para mudar a ordem."}, {"t": 5.8, "x": "Duplicar cria uma cópia do produto."}, {"t": 10.5, "x": "Em Ações, edite, duplique ou exclua a categoria."}, {"t": 15.1, "x": "Use a busca para achar um item rápido."}]}
    ] },
    { id: "loja", nome: "Cardápio público e loja", tutoriais: [
      {"id": "loja-link-do-cardapio", "titulo": "Como divulgar o link do cardápio", "curto": "Link do cardápio", "resumo": "Onde pegar e onde divulgar", "dur": 21, "busca": "endereço divulgar instagram compartilhar url", "passos": [{"t": 0.4, "x": "No menu lateral, abra Cardápio público."}, {"t": 4.9, "x": "Clique em Copiar no link do cardápio."}, {"t": 8.1, "x": "Em Abrir, veja como o cliente enxerga."}, {"t": 12, "x": "Cole o link na bio do Instagram, no WhatsApp e nas embalagens."}]},
      {"id": "loja-nome-logo-banner", "titulo": "Como colocar nome, logo e banner", "curto": "Nome, logo e banner", "resumo": "A identidade da sua loja", "dur": 19, "busca": "logotipo logomarca capa imagem nome da loja", "passos": [{"t": 0.4, "x": "Em Cardápio público, preencha nome, descrição e WhatsApp."}, {"t": 5.6, "x": "Clique em Escolher logo e envie a sua marca."}, {"t": 9.5, "x": "Em Adicionar banner, envie a imagem de capa."}, {"t": 15.6, "x": "Clique em Salvar alterações."}]},
      {"id": "loja-horario-de-funcionamento", "titulo": "Como definir o horário de funcionamento", "curto": "Horário da loja", "resumo": "Dias e horas em que a loja abre", "dur": 21, "busca": "abrir fechar aberto fechado horários dias", "passos": [{"t": 0.4, "x": "Em Cardápio público, vá até Horários de funcionamento."}, {"t": 4.4, "x": "Ligue os dias em que a loja abre."}, {"t": 7.5, "x": "Informe a hora de abrir e de fechar."}, {"t": 11.5, "x": "Adicione um segundo horário, como almoço e jantar."}, {"t": 15.7, "x": "Clique em Salvar alterações."}]},
      {"id": "loja-entrega-retirada-minimo", "titulo": "Como configurar entrega, retirada e pedido mínimo", "curto": "Entrega e retirada", "resumo": "Tempo, pedido mínimo e modalidades", "dur": 21, "busca": "delivery retirar no local consumo pedido mínimo tempo", "passos": [{"t": 0.4, "x": "Em Cardápio público, informe o tempo estimado."}, {"t": 4.5, "x": "Defina o pedido mínimo para delivery."}, {"t": 7.9, "x": "Marque o que a loja aceita: delivery, retirada e consumo no local."}, {"t": 13.1, "x": "Em hora de pico, pause o delivery por um tempo."}, {"t": 17.6, "x": "Clique em Salvar alterações."}]},
      {"id": "loja-cores-e-visual", "titulo": "Como mudar as cores e o visual do cardápio", "curto": "Cores e visual", "resumo": "Modelo de layout e cor da marca", "dur": 19, "busca": "cor tema aparência layout", "passos": [{"t": 0.4, "x": "Em Cardápio público, escolha a cor da sua marca."}, {"t": 4.4, "x": "Escolha um dos modelos de visual prontos."}, {"t": 11.8, "x": "Confira na prévia como ficou."}, {"t": 14.7, "x": "Clique em Salvar alterações."}]},
      {"id": "loja-taxa-de-entrega", "titulo": "Como definir a taxa de entrega", "curto": "Taxa de entrega", "resumo": "Taxa fixa, por distância ou por bairro", "dur": 24, "busca": "frete bairro distância km valor da entrega", "passos": [{"t": 0.4, "x": "No menu lateral, abra Entregas."}, {"t": 4.7, "x": "Clique na aba Taxa de entrega."}, {"t": 7.5, "x": "Escolha: taxa fixa, por distância ou por bairro."}, {"t": 12.2, "x": "Por bairro, cadastre cada bairro com o valor."}, {"t": 18.7, "x": "Clique em Salvar taxa."}]},
      {"id": "loja-receber-por-pix", "titulo": "Como receber por Pix", "curto": "Receber por Pix", "resumo": "Cadastrar a chave Pix da loja", "dur": 26, "busca": "chave pix pagamento online", "passos": [{"t": 0.4, "x": "No menu lateral, abra Carteira e saques."}, {"t": 4.6, "x": "Em Chave Pix para recebimento manual, digite a sua chave."}, {"t": 9.2, "x": "Escolha o tipo da chave."}, {"t": 13.9, "x": "Clique em Salvar chave."}, {"t": 20.3, "x": "O Pix online confirma o pagamento sozinho."}]},
      {"id": "loja-como-o-cliente-pede", "titulo": "Como o cliente faz o pedido", "curto": "Como o cliente pede", "resumo": "O caminho do pedido no celular", "dur": 27, "busca": "carrinho finalizar pedido cliente comprar", "passos": [{"t": 0.4, "x": "O cliente abre o link e escolhe o produto."}, {"t": 6.6, "x": "Escolhe a quantidade e toca em Adicionar."}, {"t": 11.8, "x": "Depois, toca em Ver carrinho."}, {"t": 14.6, "x": "Escolhe entrega, retirada ou consumo no local."}, {"t": 19.7, "x": "Escolhe a forma de pagamento."}, {"t": 22.5, "x": "E envia. O pedido cai no seu painel na hora."}]}
    ] },
    { id: "operacao", nome: "Pedidos e operação", tutoriais: [
      {"id": "operacao-acompanhar-pedidos", "titulo": "Como acompanhar os pedidos", "curto": "Acompanhar pedidos", "resumo": "Do pedido novo até a entrega", "dur": 27, "busca": "aceitar pedido status preparo saiu para entrega painel", "passos": [{"t": 0.4, "x": "O pedido novo chega em Meus pedidos, na coluna Em análise."}, {"t": 5.8, "x": "Clique em Confirmar para aceitar o pedido."}, {"t": 10, "x": "Quando ficar pronto, clique em Pronto."}, {"t": 13.2, "x": "Na saída, clique em Saiu para entrega."}, {"t": 20.8, "x": "Se preferir, ligue o aceite automático."}]},
      {"id": "operacao-pedido-por-telefone", "titulo": "Como lançar um pedido manual", "curto": "Pedido manual", "resumo": "Pedido recebido por telefone", "dur": 25, "busca": "pedido manual ligação novo pedido anotar", "passos": [{"t": 0.4, "x": "Em Meus pedidos, clique em Novo pedido."}, {"t": 4.9, "x": "Escolha: Delivery, Retirada ou Mesa."}, {"t": 7.9, "x": "Preencha o cliente e o endereço."}, {"t": 11, "x": "Clique no produto que o cliente pediu."}, {"t": 13.8, "x": "Ajuste a quantidade e clique em Adicionar ao pedido."}, {"t": 17.8, "x": "Escolha a forma de pagamento."}, {"t": 20.6, "x": "Clique em Criar pedido."}]},
      {"id": "operacao-venda-no-balcao", "titulo": "Como vender no balcão (PDV)", "curto": "Venda no balcão", "resumo": "Lançar e cobrar na hora", "dur": 22, "busca": "pdv balcão venda rápida", "passos": [{"t": 0.4, "x": "No menu lateral, abra Pedidos balcão (PDV)."}, {"t": 4.5, "x": "Clique nos produtos para montar o pedido."}, {"t": 7.5, "x": "Os itens do pedido aparecem à direita."}, {"t": 11, "x": "Clique em Pagamentos."}, {"t": 13.8, "x": "Escolha a forma e confirme o pagamento."}, {"t": 17.9, "x": "Clique em Gerar pedido."}]},
      {"id": "operacao-impressao-automatica", "titulo": "Como configurar a impressão automática", "curto": "Impressão automática", "resumo": "Impressora térmica e modo automático", "dur": 29, "busca": "impressora imprimir cupom térmica comanda", "passos": [{"t": 0.4, "x": "No menu lateral, abra Impressão automática."}, {"t": 5.4, "x": "Clique em Adicionar para cadastrar a impressora."}, {"t": 9.6, "x": "Dê um apelido, escolha a conexão e a largura do papel."}, {"t": 16.2, "x": "Clique em Parear impressora USB e salve."}, {"t": 20.7, "x": "Deixe o modo em Auto."}, {"t": 25.2, "x": "Faça um teste de impressão."}]},
      {"id": "operacao-entregadores", "titulo": "Como cadastrar entregadores e despachar", "curto": "Entregadores", "resumo": "Cadastro e saída para entrega", "dur": 21, "busca": "motoboy entregador despachar entrega", "passos": [{"t": 0.4, "x": "Em Entregas, clique em Novo entregador."}, {"t": 3.4, "x": "Preencha nome, telefone e comissão."}, {"t": 6.9, "x": "Clique em Salvar entregador."}, {"t": 9.7, "x": "Na Fila de entrega, escolha o entregador do pedido."}, {"t": 14.2, "x": "Clique em Sair para entrega."}]},
      {"id": "operacao-caixa", "titulo": "Como usar o caixa", "curto": "Caixa", "resumo": "Entradas, sangrias e fechamento", "dur": 25, "busca": "sangria troco abrir caixa fechar caixa", "passos": [{"t": 0.4, "x": "No menu lateral, abra Caixa."}, {"t": 4.6, "x": "No topo, veja o saldo, as entradas e as saídas."}, {"t": 10.5, "x": "Em Registro rápido, anote sangria, troco ou compra."}, {"t": 14.9, "x": "Marque Entrada ou Saída e registre."}, {"t": 19.1, "x": "No fim do dia, clique em Fechar caixa."}]},
      {"id": "operacao-estoque", "titulo": "Como controlar o estoque", "curto": "Estoque", "resumo": "Baixa automática e aviso de reposição", "dur": 29, "busca": "ingrediente baixa repor acabando", "passos": [{"t": 0.4, "x": "No menu lateral, abra Controle de estoque."}, {"t": 4.8, "x": "Clique em Novo item."}, {"t": 7.6, "x": "Informe o nome, a quantidade e quando avisar."}, {"t": 13.5, "x": "Ligue ao produto do cardápio para a baixa automática."}, {"t": 18.5, "x": "Clique em Salvar item."}, {"t": 21.3, "x": "Quando estiver acabando, o aviso aparece aqui."}]},
      {"id": "operacao-senha-do-gestor", "titulo": "Área bloqueada: senha do gestor", "curto": "Tela pede senha", "resumo": "Caixa, relatórios e configurações", "dur": 15, "busca": "bloqueio financeiro liberar área bloqueada", "passos": [{"t": 0.4, "x": "Caixa, Relatórios e Configurações pedem a senha do gestor."}, {"t": 8.5, "x": "Digite a senha do seu login e clique em Liberar."}]},
      {"id": "operacao-configuracoes", "titulo": "Som dos pedidos, backup e outros ajustes", "curto": "Som e ajustes gerais", "resumo": "Som de aviso, backup e numeração", "dur": 21, "busca": "som alerta toque backup taxa de serviço", "passos": [{"t": 0.4, "x": "No menu lateral, abra Configurações."}, {"t": 4.9, "x": "Escolha o som que toca quando chega pedido."}, {"t": 10.3, "x": "Em Backup completo, baixe uma cópia dos seus dados."}, {"t": 15, "x": "Defina a taxa de serviço do garçom."}]}
    ] },
    { id: "vendas", nome: "Vendas e clientes", tutoriais: [
      {"id": "vendas-cupom-de-desconto", "titulo": "Como criar um cupom de desconto", "curto": "Cupom de desconto", "resumo": "Código, valor e limite de uso", "dur": 22, "busca": "código promocional desconto", "passos": [{"t": 0.4, "x": "No menu, abra Marketing e depois Cupom."}, {"t": 4.2, "x": "Clique em Criar cupom."}, {"t": 7, "x": "Digite o código e o valor do desconto."}, {"t": 12.3, "x": "Defina o pedido mínimo e o limite de usos."}, {"t": 16.3, "x": "Clique em Criar cupom e divulgue o código."}]},
      {"id": "vendas-cashback-e-fidelidade", "titulo": "Como ativar cashback e cartão fidelidade", "curto": "Cashback e fidelidade", "resumo": "Fazer o cliente voltar a comprar", "dur": 24, "busca": "pontos recompensa cartão fidelidade", "passos": [{"t": 0.4, "x": "Em Marketing, Cupom, abra a aba Cashback."}, {"t": 3.7, "x": "Defina a porcentagem que volta para o cliente."}, {"t": 11.3, "x": "Agora abra a aba Cartão fidelidade."}, {"t": 16, "x": "Informe quantas compras dão direito ao prêmio."}, {"t": 20.2, "x": "Ligue a chave Ativo e clique em Salvar regras."}]},
      {"id": "vendas-relatorios", "titulo": "Como ver os relatórios de vendas", "curto": "Relatórios", "resumo": "Faturamento, produtos e horários", "dur": 22, "busca": "faturamento vendas exportar ticket médio", "passos": [{"t": 0.4, "x": "No menu lateral, abra Relatórios."}, {"t": 4.6, "x": "Escolha o período: hoje, semana, mês ou ano."}, {"t": 7.9, "x": "No topo: faturamento, pedidos e ticket médio."}, {"t": 12.8, "x": "Nas abas, veja produtos, clientes e financeiro."}, {"t": 18.2, "x": "Exporte ou imprima o relatório."}]},
      {"id": "vendas-clientes", "titulo": "Como consultar seus clientes", "curto": "Clientes", "resumo": "Lista, aniversariantes e inativos", "dur": 21, "busca": "aniversariantes inativos cadastro de clientes", "passos": [{"t": 0.4, "x": "No menu, abra Marketing e depois Clientes."}, {"t": 5.6, "x": "Busque pelo nome ou telefone."}, {"t": 8.9, "x": "Veja os aniversariantes e quem sumiu há 30 dias."}, {"t": 15.3, "x": "Em Ver, abra o histórico do cliente."}]},
      {"id": "vendas-conectar-whatsapp", "titulo": "Como conectar o WhatsApp da loja", "curto": "Conectar WhatsApp", "resumo": "Robô e mensagens automáticas", "dur": 30, "busca": "robô qr code mensagens automáticas conectar", "passos": [{"t": 0.4, "x": "No menu lateral, abra Robô do WhatsApp."}, {"t": 5.7, "x": "Clique em Conectar WhatsApp."}, {"t": 10, "x": "No celular: WhatsApp, Aparelhos conectados, Conectar um aparelho."}, {"t": 16.4, "x": "Depois, abra a aba Automações."}, {"t": 19.2, "x": "Ligue e ajuste as mensagens de cada etapa do pedido."}, {"t": 26.2, "x": "Clique em Salvar automações."}]},
      {"id": "vendas-historico-de-pedidos", "titulo": "Como consultar pedidos antigos", "curto": "Histórico de pedidos", "resumo": "Buscar, rever e reimprimir", "dur": 19, "busca": "pedidos antigos reimprimir buscar pedido", "passos": [{"t": 0.4, "x": "No menu lateral, abra Histórico de pedidos."}, {"t": 5.2, "x": "Busque por nome, telefone ou número do pedido."}, {"t": 9.2, "x": "Filtre por situação e por data."}, {"t": 13, "x": "Em Ver, abra os detalhes. No ícone ao lado, reimprima."}]}
    ] },
    { id: "mesas", nome: "Mesas e garçom", tutoriais: [
      {"id": "mesas-criar-mesas-e-qr", "titulo": "Como criar as mesas e o código QR", "curto": "Mesas e código QR", "resumo": "Cliente pede direto da mesa", "dur": 19, "busca": "qr code mesa comanda salão", "passos": [{"t": 0.4, "x": "No menu lateral, abra Mesas."}, {"t": 4.9, "x": "Clique em Nova mesa para criar cada mesa."}, {"t": 8.5, "x": "Clique na mesa para abrir o código QR."}, {"t": 12.2, "x": "Imprima o código e cole na mesa."}]},
      {"id": "mesas-cadastrar-garcom", "titulo": "Como cadastrar um garçom", "curto": "Cadastrar garçom", "resumo": "Usuário, senha e link do aplicativo", "dur": 22, "busca": "usuário senha garçom login", "passos": [{"t": 0.4, "x": "No menu lateral, abra Modo garçom."}, {"t": 4.4, "x": "Clique em Novo garçom."}, {"t": 7.2, "x": "Preencha o nome, o usuário e a senha."}, {"t": 10.7, "x": "Clique em Cadastrar garçom."}, {"t": 13.5, "x": "Em Abrir app garçom, pegue o link do aplicativo."}]},
      {"id": "mesas-garcom-lancar-pedido", "titulo": "Garçom: como lançar um pedido", "curto": "Garçom: lançar pedido", "resumo": "Pedido da mesa pelo celular", "dur": 24, "busca": "aplicativo garçom pedido na mesa celular", "passos": [{"t": 0.4, "x": "O garçom abre o aplicativo e entra com usuário e senha."}, {"t": 5.6, "x": "Toca na mesa do cliente."}, {"t": 8.9, "x": "Confirma em Abrir mesa."}, {"t": 11.7, "x": "Toca nos produtos para adicionar."}, {"t": 14.6, "x": "Depois, toca em Ver carrinho."}, {"t": 17.4, "x": "Confere e toca em Enviar para cozinha."}]},
      {"id": "mesas-garcom-fechar-conta", "titulo": "Garçom: como fechar a conta", "curto": "Garçom: fechar conta", "resumo": "Dividir, transferir e finalizar", "dur": 27, "busca": "dividir conta pagamento garçom", "passos": [{"t": 0.4, "x": "O garçom toca na mesa ocupada."}, {"t": 4.1, "x": "A comanda mostra os itens e o total."}, {"t": 7.7, "x": "Transferir muda de mesa. Dividir reparte a conta."}, {"t": 13.6, "x": "Cobrar itens específicos recebe só uma parte."}, {"t": 17.9, "x": "Para encerrar, toca em Finalizar mesa."}, {"t": 20.9, "x": "Escolhe o pagamento e finaliza."}]},
      {"id": "mesas-cobrar-e-fechar-mesa", "titulo": "Como cobrar e fechar uma mesa", "curto": "Fechar a mesa", "resumo": "Lançar, cobrar e encerrar pelo gestor", "dur": 26, "busca": "fechar conta cobrar mesa pagamento", "passos": [{"t": 0.4, "x": "No menu lateral, abra Pedidos mesa."}, {"t": 5.2, "x": "Cada mesa aberta mostra a comanda e o total."}, {"t": 9.1, "x": "Em Lançar pedido, adicione itens na mesa."}, {"t": 13.5, "x": "Em Cobrar agora, receba o pagamento."}, {"t": 21, "x": "Depois, clique em Fechar mesa."}]}
    ] }
  ];

  // Tela do gestor que cada vídeo ensina (botão "Abrir esta tela")
  var TELA = {
    'cardapio-criar-categoria': 'gestor', 'cardapio-cadastrar-produto': 'gestor', 'cardapio-adicionais': 'gestor',
    'cardapio-pizza-meio-a-meio': 'gestor', 'cardapio-promocao': 'gestor', 'cardapio-pausar-produto': 'gestor',
    'cardapio-fotos': 'imagens', 'cardapio-edicao-em-massa': 'edicao', 'cardapio-modelos-prontos': 'gestor', 'cardapio-organizar': 'gestor',
    'loja-link-do-cardapio': 'cardapio-publico', 'loja-nome-logo-banner': 'cardapio-publico', 'loja-horario-de-funcionamento': 'cardapio-publico',
    'loja-entrega-retirada-minimo': 'cardapio-publico', 'loja-cores-e-visual': 'cardapio-publico', 'loja-taxa-de-entrega': 'taxa', 'loja-receber-por-pix': 'saques',
    'operacao-acompanhar-pedidos': 'pedidos', 'operacao-pedido-por-telefone': 'pedidos', 'operacao-venda-no-balcao': 'pdv-balcao',
    'operacao-impressao-automatica': 'impressao', 'operacao-entregadores': 'entregas', 'operacao-caixa': 'caixa', 'operacao-estoque': 'estoque',
    'operacao-configuracoes': 'configuracoes',
    'vendas-cupom-de-desconto': 'cupom', 'vendas-cashback-e-fidelidade': 'cupom', 'vendas-relatorios': 'relatorios', 'vendas-clientes': 'clientes',
    'vendas-conectar-whatsapp': 'robo', 'vendas-historico-de-pedidos': 'historico',
    'mesas-criar-mesas-e-qr': 'qrcode', 'mesas-cadastrar-garcom': 'garcom', 'mesas-garcom-lancar-pedido': 'garcom', 'mesas-garcom-fechar-conta': 'garcom',
    'mesas-cobrar-e-fechar-mesa': 'pedidos-mesa'
  };

  var CSS = [
    '#page-treinamento{--tr-alt:clamp(430px,calc(100vh - 214px),620px)}',
    '#page-treinamento [hidden]{display:none!important}',
    '.tr-prog{min-width:220px}',
    '.tr-prog-txt{font-size:12.5px;color:var(--muted);font-weight:600;display:flex;justify-content:space-between;gap:12px}',
    '.tr-prog-txt b{color:var(--text);font-weight:800}',
    '.tr-prog-barra{height:6px;border-radius:99px;background:var(--surface3,var(--surface2));margin-top:7px;overflow:hidden}',
    '.tr-prog-barra i{display:block;height:100%;width:0;border-radius:99px;background:var(--accent);transition:width .4s ease}',
    '.tr-grade{display:grid;grid-template-columns:minmax(0,1fr) 348px;gap:18px;align-items:start}',
    '.tr-player{scroll-margin-top:14px}',
    '.tr-player,.tr-lista{background:var(--surface);border:1px solid var(--pf-line,var(--border));border-radius:var(--pf-r-l,16px);overflow:hidden}',
    /* a coluna do vídeo tem largura fixa (9:16 da altura); sem isso o vídeo impõe a largura dele */
    '.tr-player{display:grid;grid-template-columns:calc(var(--tr-alt) * 9 / 16) minmax(0,1fr);height:var(--tr-alt)}',
    '.tr-video{position:relative;min-width:0;height:100%;background:#041b3d;overflow:hidden}',
    '.tr-video video{display:block;width:100%;height:100%;object-fit:contain;background:#041b3d}',
    '.tr-tocar{position:absolute;left:50%;top:50%;width:76px;height:76px;margin:-38px 0 0 -38px;border-radius:50%;border:0;background:var(--accent);color:#fff;cursor:pointer;display:grid;place-items:center;box-shadow:0 12px 34px rgba(0,0,0,.45)}',
    '.tr-tocar svg{width:30px;height:30px;margin-left:4px}',
    '.tr-seguir{position:absolute;left:0;right:0;bottom:0;padding:104px 16px 16px;background:linear-gradient(180deg,rgba(4,27,61,0),rgba(4,27,61,.98) 38%);color:#fff}',
    '.tr-seguir small{display:block;font-size:12.5px;font-weight:600;color:rgba(255,255,255,.78)}',
    '.tr-seguir strong{display:block;font-size:16px;font-weight:800;line-height:1.25;margin:3px 0 12px}',
    '.tr-seguir-b{display:flex;gap:8px;flex-wrap:wrap}',
    '.tr-seguir-b button{font:inherit;font-size:13px;font-weight:700;border-radius:99px;padding:9px 16px;cursor:pointer;border:1px solid rgba(255,255,255,.34);background:rgba(255,255,255,.1);color:#fff}',
    '.tr-seguir-b button.pri{background:#fff;color:#041b3d;border-color:#fff}',
    '.tr-info{display:flex;flex-direction:column;min-width:0;min-height:0}',
    '.tr-info-rol{flex:1;min-height:0;overflow-y:auto;padding:22px 24px 16px}',
    '.tr-area{font-size:12.5px;font-weight:700;color:var(--accent)}',
    '.tr-info h2{font-size:21px;font-weight:800;line-height:1.2;letter-spacing:-.02em;color:var(--text);margin-top:5px}',
    '.tr-resumo{font-size:13.5px;color:var(--muted);margin-top:6px;line-height:1.45}',
    '.tr-abrir{margin-top:14px}',
    '.tr-info h3{font-size:13px;font-weight:800;color:var(--text);margin-top:20px}',
    '.tr-passos{list-style:none;counter-reset:trp;display:grid;gap:2px;margin:8px -10px 0;padding:0}',
    '.tr-passos button{counter-increment:trp;display:grid;grid-template-columns:26px 1fr;gap:10px;align-items:start;width:100%;text-align:left;font:inherit;font-size:13.5px;font-weight:500;line-height:1.4;color:var(--muted2,var(--muted));background:none;border:0;border-radius:10px;padding:8px 10px;cursor:pointer;transition:background .15s,color .15s}',
    '.tr-passos button::before{content:counter(trp);width:26px;height:26px;border-radius:8px;background:var(--surface2);color:var(--text);font-weight:800;font-size:12.5px;display:grid;place-items:center}',
    '.tr-passos button span{padding-top:3px}',
    '.tr-passos button:hover{background:var(--surface2)}',
    '.tr-passos li[aria-current="step"] button{background:var(--accent-dim);color:var(--text);font-weight:700}',
    '.tr-passos li[aria-current="step"] button::before{background:var(--accent);color:#fff}',
    '.tr-rodape{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 24px;border-top:1px solid var(--pf-line,var(--border))}',
    '.tr-auto{margin-left:auto;display:inline-flex;align-items:center;gap:9px;font-size:12.5px;font-weight:600;color:var(--muted2,var(--muted));cursor:pointer;user-select:none}',
    '.tr-auto input{position:absolute;opacity:0;width:1px;height:1px}',
    '.tr-auto i{position:relative;width:36px;height:20px;border-radius:99px;background:var(--surface3,var(--surface2));border:1px solid var(--pf-line-strong,var(--border2));transition:background .2s,border-color .2s;flex:none}',
    '.tr-auto i::after{content:"";position:absolute;left:2px;top:2px;width:14px;height:14px;border-radius:50%;background:var(--muted);transition:transform .2s,background .2s}',
    '.tr-auto input:checked + i{background:var(--accent);border-color:var(--accent)}',
    '.tr-auto input:checked + i::after{transform:translateX(16px);background:#fff}',
    '.tr-auto input:focus-visible + i{outline:2px solid var(--accent);outline-offset:2px}',
    '.tr-lista{display:flex;flex-direction:column;height:var(--tr-alt)}',
    '.tr-busca{margin:12px 12px 4px;flex:none}',
    '.tr-busca input{width:100%!important}',
    '.tr-itens{flex:1;min-height:0;overflow-y:auto;padding:0 8px 8px}',
    '.tr-grupo{display:flex;justify-content:space-between;gap:10px;align-items:baseline;padding:14px 6px 6px;font-size:12.5px;font-weight:800;color:var(--text)}',
    '.tr-grupo span:last-child{font-weight:600;color:var(--muted);font-variant-numeric:tabular-nums}',
    '.tr-grupo-itens{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:2px}',
    '.tr-item{display:grid;grid-template-columns:72px minmax(0,1fr);gap:11px;align-items:center;width:100%;text-align:left;font:inherit;color:var(--text);background:none;border:0;border-radius:12px;padding:6px;cursor:pointer;transition:background .15s}',
    '.tr-item:hover{background:var(--surface2)}',
    '.tr-item.on{background:var(--accent-dim)}',
    '.tr-mini{position:relative;display:block;width:72px;height:54px;border-radius:9px;overflow:hidden;background:var(--surface2);border:1px solid var(--pf-line,var(--border))}',
    '.tr-mini img{display:block;width:100%;height:100%;object-fit:cover}',
    '.tr-item.on .tr-mini{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-dim)}',
    '.tr-ok{position:absolute;right:4px;bottom:4px;width:18px;height:18px;border-radius:50%;background:var(--success,#22c55e);color:#fff;display:none;place-items:center}',
    '.tr-ok svg{width:11px;height:11px}',
    '.tr-item.visto .tr-ok{display:grid}',
    '.tr-item b{display:block;font-size:13px;font-weight:700;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '.tr-item small{display:block;font-size:11.5px;color:var(--muted);margin-top:2px;font-variant-numeric:tabular-nums}',
    '.tr-item.on small{color:var(--accent);font-weight:700}',
    '.tr-vazio{padding:26px 14px;font-size:13px;color:var(--muted);text-align:center}',
    '.tr-lista-fim{flex:none;display:flex;justify-content:space-between;gap:10px;padding:10px 14px;border-top:1px solid var(--pf-line,var(--border));font-size:12px}',
    '.tr-lista-fim a,.tr-lista-fim button{font:inherit;font-weight:700;color:var(--muted2,var(--muted));background:none;border:0;cursor:pointer;text-decoration:none;padding:0}',
    '.tr-lista-fim a:hover,.tr-lista-fim button:hover{color:var(--accent)}',
    /* telas médias: a lista desce para baixo do vídeo e ocupa a largura toda */
    '@media (max-width:1279px){.tr-grade{grid-template-columns:minmax(0,1fr)}.tr-lista{height:auto}.tr-itens{overflow:visible}}',
    /* celular: vídeo em cima, passo a passo embaixo */
    '@media (max-width:760px){',
    '  #page-treinamento{--tr-alt:auto}',
    '  .tr-prog{min-width:0;width:100%}',
    '  .tr-player{display:block;height:auto}',
    '  .tr-video{height:auto;display:flex;justify-content:center}',
    '  .tr-video video{width:auto;height:min(58dvh,calc((100vw - 34px) * 16 / 9));max-width:100%;aspect-ratio:9/16}',
    '  .tr-info-rol{overflow:visible;padding:16px 16px 12px}',
    '  .tr-info h2{font-size:18px}',
    '  .tr-rodape{padding:10px 16px}',
    '  .tr-auto{margin-left:0;width:100%;justify-content:space-between;padding-top:4px}',
    '}'
  ].join('\n');

  var ICO_BUSCA = '<svg viewBox="0 0 16 16" fill="none" width="12" height="12" style="color:var(--muted);flex-shrink:0"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 10.5L13 13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
  var ICO_OK = '<svg viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICO_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

  var TUTS = {};
  AREAS.forEach(function (a) { a.tutoriais.forEach(function (t) { t.area = a; TUTS[t.id] = t; }); });

  var montado = false;
  var atual = '';
  var marcado = -1;
  var contagem = 0;      // relógio do "A seguir"
  var vistos = {};
  var auto = true;
  var el = {};

  function norm(s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function minutos(seg) { return Math.floor(seg / 60) + ':' + ('0' + (seg % 60)).slice(-2); }

  // ── O que fica guardado no aparelho ─────────────────────────────────
  function chave() {
    var t = '';
    try { t = (typeof _sessao !== 'undefined' && _sessao && _sessao.tenant_id) || ''; } catch (e) {}
    return 'ef_treino_vistos_' + String(t).replace(/[^a-zA-Z0-9_-]/g, '');
  }
  function lerGuardado() {
    vistos = {};
    try { (JSON.parse(localStorage.getItem(chave()) || '[]') || []).forEach(function (id) { if (TUTS[id]) vistos[id] = true; }); } catch (e) {}
    try { auto = localStorage.getItem('ef_treino_auto') !== '0'; } catch (e) { auto = true; }
  }
  function guardarVistos() { try { localStorage.setItem(chave(), JSON.stringify(Object.keys(vistos))); } catch (e) {} }

  // ── Lista válida para a loja (açougue não tem mesas nem pizza) ──────
  function fila() {
    var acougue = window._segmento === 'acougue';
    var ids = [];
    AREAS.forEach(function (a) {
      if (acougue && a.id === 'mesas') return;
      a.tutoriais.forEach(function (t) { if (!(acougue && t.id === 'cardapio-pizza-meio-a-meio')) ids.push(t.id); });
    });
    return ids;
  }
  function palavras(q) {
    return norm(q).split(/[^a-z0-9]+/).filter(function (p) { return p.length >= 2; }).map(function (p) {
      var f = [p];
      if (p.length > 3) {
        if (/oes$/.test(p)) f.push(p.replace(/oes$/, 'ao'));
        else if (/ns$/.test(p)) f.push(p.replace(/ns$/, 'm'));
        else if (/s$/.test(p)) f.push(p.replace(/s$/, ''));
      }
      return f;
    });
  }

  // ── Montagem da tela (uma vez) ──────────────────────────────────────
  function montar(pg) {
    if (!document.getElementById('tr-css')) {
      var st = document.createElement('style');
      st.id = 'tr-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    pg.innerHTML =
      '<div class="gz-page-head">' +
        '<div><div class="gz-page-title">Central de Treinamento</div>' +
        '<div class="gz-page-sub">Aprenda cada ferramenta do sistema em vídeos de até 30 segundos, com o passo a passo ao lado.</div></div>' +
        '<div class="tr-prog"><div class="tr-prog-txt"><span><b id="tr-prog-n"></b> concluídos</span><span id="tr-prog-p"></span></div>' +
        '<div class="tr-prog-barra"><i id="tr-prog-i"></i></div></div>' +
      '</div>' +
      '<div class="tr-grade">' +
        '<section class="tr-player" aria-label="Vídeo do treinamento">' +
          '<div class="tr-video">' +
            '<video id="tr-video" playsinline controls preload="metadata"></video>' +
            '<button type="button" class="tr-tocar" id="tr-tocar" aria-label="Tocar o vídeo" hidden>' + ICO_PLAY + '</button>' +
            '<div class="tr-seguir" id="tr-seguir" hidden>' +
              '<small id="tr-seg-rotulo"></small><strong id="tr-seg-titulo"></strong>' +
              '<div class="tr-seguir-b"><button type="button" class="pri" id="tr-seg-ir">Assistir agora</button><button type="button" id="tr-seg-cancelar">Cancelar</button></div>' +
            '</div>' +
          '</div>' +
          '<div class="tr-info">' +
            '<div class="tr-info-rol" id="tr-rol">' +
              '<div class="tr-area" id="tr-area"></div><h2 id="tr-titulo"></h2><p class="tr-resumo" id="tr-resumo"></p>' +
              '<button type="button" class="btn bp tr-abrir" id="tr-abrir">Abrir esta tela</button>' +
              '<h3>Passo a passo</h3><ol class="tr-passos" id="tr-passos"></ol>' +
            '</div>' +
            '<div class="tr-rodape">' +
              '<button type="button" class="btn bg" id="tr-ant">Anterior</button>' +
              '<button type="button" class="btn bg" id="tr-prox">Próximo</button>' +
              '<label class="tr-auto"><span>Reprodução automática</span><input type="checkbox" id="tr-auto"><i></i></label>' +
            '</div>' +
          '</div>' +
        '</section>' +
        '<aside class="tr-lista" aria-label="Todos os treinamentos">' +
          '<div class="sbox tr-busca">' + ICO_BUSCA + '<input id="tr-q" type="search" placeholder="Buscar treinamento" aria-label="Buscar treinamento" autocomplete="off" maxlength="60"></div>' +
          '<div class="tr-itens" id="tr-itens"></div>' +
          '<div class="tr-lista-fim"><a id="tr-suporte" href="#" target="_blank" rel="noopener">Falar com o suporte</a><button type="button" id="tr-zerar">Zerar progresso</button></div>' +
        '</aside>' +
      '</div>';

    ['video', 'tocar', 'seguir', 'seg-rotulo', 'seg-titulo', 'seg-ir', 'seg-cancelar', 'rol', 'area', 'titulo', 'resumo', 'abrir', 'passos',
      'ant', 'prox', 'auto', 'q', 'itens', 'suporte', 'zerar', 'prog-n', 'prog-p', 'prog-i'].forEach(function (k) { el[k] = document.getElementById('tr-' + k); });

    el.video.addEventListener('timeupdate', marcarPasso);
    el.video.addEventListener('seeked', marcarPasso);
    el.video.addEventListener('play', function () { el.tocar.hidden = true; pararContagem(); });
    el.video.addEventListener('ended', aoTerminar);
    el.tocar.addEventListener('click', function () { tocar(); });
    el.passos.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-t]');
      if (!b) return;
      el.video.currentTime = parseFloat(b.getAttribute('data-t')) || 0;
      tocar();
    });
    el.ant.addEventListener('click', function () { var v = vizinho(-1); if (v) abrir(v, true); });
    el.prox.addEventListener('click', function () { var v = vizinho(1); if (v) abrir(v, true); });
    el['seg-ir'].addEventListener('click', function () { var v = vizinho(1); if (v) abrir(v, true); });
    el['seg-cancelar'].addEventListener('click', pararContagem);
    el.auto.addEventListener('change', function () {
      auto = el.auto.checked;
      try { localStorage.setItem('ef_treino_auto', auto ? '1' : '0'); } catch (e) {}
      if (!auto) pararContagem();
    });
    el.abrir.addEventListener('click', function () { var t = TELA[atual]; if (t && typeof nav === 'function') nav(t); });
    el.q.addEventListener('input', desenharLista);
    el.q.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && el.q.value) { el.q.value = ''; desenharLista(); } });
    el.itens.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-id]');
      if (b) abrir(b.getAttribute('data-id'), true);
    });
    el.zerar.addEventListener('click', function () {
      if (!Object.keys(vistos).length) return;
      if (!window.confirm('Zerar o progresso? Os vídeos voltam a aparecer como não concluídos.')) return;
      vistos = {};
      guardarVistos();
      desenharLista();
      progresso();
    });
    montado = true;
  }

  // ── Lista da direita ────────────────────────────────────────────────
  function desenharLista() {
    var valida = fila(), lista = palavras(el.q.value), html = '', achou = 0;
    AREAS.forEach(function (a) {
      var itens = a.tutoriais.filter(function (t) {
        return valida.indexOf(t.id) >= 0 && lista.every(function (f) { return f.some(function (p) { return t.texto.indexOf(p) >= 0; }); });
      });
      if (!itens.length) return;
      var doGrupo = a.tutoriais.filter(function (t) { return valida.indexOf(t.id) >= 0; });
      var feitos = doGrupo.filter(function (t) { return vistos[t.id]; }).length;
      achou += itens.length;
      html += '<div class="tr-grupo"><span>' + esc(a.nome) + '</span><span>' + feitos + '/' + doGrupo.length + '</span></div><div class="tr-grupo-itens">';
      itens.forEach(function (t) {
        var on = t.id === atual;
        html += '<button type="button" class="tr-item' + (on ? ' on' : '') + (vistos[t.id] ? ' visto' : '') + '" data-id="' + t.id + '"' + (on ? ' aria-current="true"' : '') + '>' +
          '<span class="tr-mini"><img src="' + PASTA + t.id + '.jpg" alt="" loading="lazy" width="72" height="54"><span class="tr-ok">' + ICO_OK + '</span></span>' +
          '<span><b>' + esc(t.titulo) + '</b><small>' + (on ? 'Assistindo agora' : minutos(t.dur)) + '</small></span></button>';
      });
      html += '</div>';
    });
    el.itens.innerHTML = html || '<div class="tr-vazio">Nenhum treinamento sobre "' + esc(el.q.value.trim()) + '". Tente o nome da tela ou do botão.</div>';
  }

  function progresso() {
    var valida = fila(), n = valida.filter(function (id) { return vistos[id]; }).length;
    el['prog-n'].textContent = n + ' de ' + valida.length;
    el['prog-p'].textContent = Math.round(n * 100 / (valida.length || 1)) + '%';
    el['prog-i'].style.width = (n * 100 / (valida.length || 1)) + '%';
  }

  function vizinho(passo) {
    var f = fila(), i = f.indexOf(atual) + passo;
    return i >= 0 && i < f.length ? f[i] : '';
  }

  // ── Vídeo ───────────────────────────────────────────────────────────
  function tocar() {
    var p = el.video.play();
    if (p && p.catch) p.catch(function () { el.tocar.hidden = false; }); // navegador segurou o som: fica o botão de tocar
  }

  function marcarPasso() {
    var t = TUTS[atual];
    if (!t) return;
    var agora = el.video.currentTime, k = 0;
    for (var i = 0; i < t.passos.length; i++) if (agora >= t.passos[i].t - 0.05) k = i;
    if (k === marcado) return;
    marcado = k;
    var lis = el.passos.children;
    for (var j = 0; j < lis.length; j++) {
      if (j === k) lis[j].setAttribute('aria-current', 'step'); else lis[j].removeAttribute('aria-current');
    }
    var li = lis[k], rol = el.rol;
    if (li && rol.scrollHeight > rol.clientHeight + 2) {
      var topo = li.getBoundingClientRect().top - rol.getBoundingClientRect().top;
      if (topo < 0) rol.scrollTop += topo - 10;
      else if (topo + li.offsetHeight > rol.clientHeight) rol.scrollTop += topo + li.offsetHeight - rol.clientHeight + 10;
    }
  }

  function abrir(id, comecar) {
    var t = TUTS[id];
    if (!t) return;
    pararContagem();
    atual = id;
    marcado = -1;
    el.area.textContent = t.area.nome;
    el.titulo.textContent = t.titulo;
    el.resumo.textContent = t.resumo + '. Vídeo de ' + t.dur + ' segundos.';
    el.abrir.hidden = !TELA[id];
    el.passos.textContent = '';
    t.passos.forEach(function (p) {
      var li = document.createElement('li'), b = document.createElement('button'), s = document.createElement('span');
      b.type = 'button';
      b.setAttribute('data-t', p.t);
      s.textContent = p.x;
      b.appendChild(s); li.appendChild(b); el.passos.appendChild(li);
    });
    el.ant.disabled = !vizinho(-1);
    el.prox.disabled = !vizinho(1);
    el.suporte.href = 'https://wa.me/' + SUPORTE + '?text=' + encodeURIComponent('Olá, estou na Central de Treinamento e tenho uma dúvida sobre: ' + t.titulo + '.');
    el.rol.scrollTop = 0;
    el.tocar.hidden = true;
    el.video.src = PASTA + id + '.mp4#t=0.001';
    el.video.setAttribute('aria-label', t.titulo);
    desenharLista();
    var item = el.itens.querySelector('.tr-item.on');
    if (item && el.itens.scrollHeight > el.itens.clientHeight + 2) {
      var topo = item.getBoundingClientRect().top - el.itens.getBoundingClientRect().top;
      if (topo < 0 || topo + item.offsetHeight > el.itens.clientHeight) el.itens.scrollTop += topo - el.itens.clientHeight / 3;
    }
    marcarPasso();
    if (comecar) { tocar(); mostrarVideo(); } else el.tocar.hidden = false;
  }

  // Quem escolheu o vídeo lá embaixo na lista (ou estava lendo os passos) volta a ver o vídeo
  function mostrarVideo() {
    var p = el.video && el.video.closest('.tr-player');
    if (!p) return;
    var r = p.getBoundingClientRect();
    if (r.top < 56 || r.top > window.innerHeight * 0.45) {
      try { p.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { p.scrollIntoView(); }
    }
  }

  function aoTerminar() {
    if (atual && !vistos[atual]) { vistos[atual] = true; guardarVistos(); }
    desenharLista();
    progresso();
    var prox = vizinho(1);
    if (!prox) {
      var f = fila();
      if (f.every(function (id) { return vistos[id]; })) {
        el['seg-rotulo'].textContent = 'Parabéns';
        el['seg-titulo'].textContent = 'Você concluiu todos os treinamentos.';
        el['seg-ir'].hidden = true;
        el['seg-cancelar'].textContent = 'Fechar';
        el.seguir.hidden = false;
      }
      return;
    }
    if (!auto) return;
    var falta = ESPERA;
    el['seg-titulo'].textContent = TUTS[prox].titulo;
    el['seg-ir'].hidden = false;
    el['seg-cancelar'].textContent = 'Cancelar';
    var rotulo = function () { el['seg-rotulo'].textContent = 'A seguir em ' + falta + (falta === 1 ? ' segundo' : ' segundos'); };
    rotulo();
    el.seguir.hidden = false;
    contagem = window.setInterval(function () {
      falta--;
      if (falta <= 0) { pararContagem(); abrir(prox, true); return; }
      rotulo();
    }, 1000);
  }
  function pararContagem() {
    if (contagem) { window.clearInterval(contagem); contagem = 0; }
    if (el.seguir) el.seguir.hidden = true;
  }

  // ── Entrar e sair da tela ───────────────────────────────────────────
  function entrar() {
    var pg = document.getElementById('page-treinamento');
    if (!pg) return;
    if (!montado) { montar(pg); lerGuardado(); el.auto.checked = auto; }
    var f = fila();
    if (!atual || f.indexOf(atual) < 0) {
      var proximo = f.filter(function (id) { return !vistos[id]; })[0] || f[0];
      abrir(proximo, auto);
    } else {
      desenharLista();
      if (auto && el.video.paused && !el.video.ended) tocar();
    }
    progresso();
  }
  function sair() {
    if (!montado) return;
    pararContagem();
    try { el.video.pause(); } catch (e) {}
  }

  AREAS.forEach(function (a) {
    a.tutoriais.forEach(function (t) {
      t.texto = norm([t.titulo, t.curto, t.resumo, t.busca, a.nome, t.passos.map(function (p) { return p.x; }).join(' ')].join(' '));
    });
  });

  // Liga-se à navegação do gestor sem mexer nela: depois de cada troca de tela,
  // monta/retoma a Central quando ela é a tela aberta e pausa o vídeo nas outras.
  var navOriginal = window.nav;
  if (typeof navOriginal === 'function' && !navOriginal._treino) {
    var navNova = function (id) {
      var r = navOriginal.apply(this, arguments);
      try {
        var pg = document.getElementById('page-treinamento');
        if (pg && pg.classList.contains('on')) entrar(); else sair();
      } catch (e) { console.warn('[treinamento]', e); }
      return r;
    };
    navNova._treino = true;
    window.nav = navNova;
  }
  window.renderTreinamento = entrar;
  // se a tela já estava aberta quando este arquivo carregou (clique muito cedo), monta agora
  var conferir = function () { var pg = document.getElementById('page-treinamento'); if (pg && pg.classList.contains('on') && !montado) entrar(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { window.setTimeout(conferir, 0); }); else conferir();
})();
