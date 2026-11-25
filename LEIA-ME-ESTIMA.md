# Estima: assistente de voz do gestor

A Estima é um adicional pago, ligado loja por loja no painel admin.

## Como ligar para uma loja
1. No admin, abra **Clientes**, clique na loja e desça até **Estima: assistente de voz do gestor**.
2. Escolha a situação:
   - **Teste grátis**: escolha até quando (botões 7 e 15 dias). Não cobra. No dia seguinte à data, desliga sozinha.
   - **Ativa**: digite o valor mensal (pode ser 0 para cortesia). O valor entra na fatura da loja, somado à mensalidade.
   - **Desligada**: o gestor vê a apresentação da Estima e um botão "Quero testar grátis", que abre o WhatsApp do suporte.
3. Clique em **Salvar**.

## Configuração geral (admin, aba Planos)
- **Inteligência**: Automático, Claude ou OpenAI.
  - Sem fazer nada, a Estima usa a chave da OpenAI que já está cadastrada no **Agente IA**.
  - Se você colar a chave do Claude (Anthropic), ela passa a usar o Claude.
- **Voz premium (OpenAI)**: as vozes mais naturais. Usa a mesma chave da OpenAI.
- **Limite de perguntas por loja/mês**: protege o seu custo. O padrão é 1500. Use 0 para não ter limite.
- O botão "Quero testar grátis" usa o número do **WhatsApp do robô de cobrança**, que fica na mesma aba.

## O que o gestor vê
- O botão **Estima** no topo do painel.
- O item **Estima** no menu, em Gestão financeira.
- No celular, a Estima aparece no **Mais**.
- Ele pode chamar dizendo **"Olá, Estima"**, mas antes precisa ligar essa opção na página da Estima e permitir o microfone. Funciona no Chrome e no Edge, com o endereço em https.

## O que ela sabe
Ela só **lê** dados, e só da própria loja:
- faturamento, pedidos, ticket médio e cancelamentos;
- produtos que mais vendem, que menos vendem e que não vendem nada;
- horários e dias da semana;
- clientes novos, melhores e sumidos;
- cardápio, avaliações e bairros;
- o que está acontecendo agora;
- dicas para vender mais.

O faturamento segue a mesma regra da tela de Relatórios.

O que ela **não** faz:
- não vê lucro, despesas nem contas a pagar, que ficam protegidos por senha;
- não muda nada no sistema.

## Variáveis de ambiente (opcionais)
- `ANTHROPIC_API_KEY`: chave do Claude, se não quiser colar no admin.
- `OPENAI_API_KEY`: chave da OpenAI, se não estiver no Agente IA.
- `ESTIMA_TTS_MODEL`: modelo de voz. O padrão é `gpt-4o-mini-tts`. A OpenAI avisou que esse modelo será desligado em 06/01/2027; quando sair o substituto, é só trocar aqui.
