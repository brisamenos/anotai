# VisseTV (app Android das TVs)

App que passa nas TVs os vídeos da TV Indoor (lojas do EstimaFood) e da rede VisseTV.

- Abre sozinho quando a TV liga (depois de liberar "Abrir sozinho ao ligar a TV" na primeira tela).
- Mostra um código de 6 números. No painel: Adicionar TV (gestor) ou Ligar TV (admin, aba VisseTV).
- Guarda os vídeos no aparelho: se a internet cair, continua passando.
- Confere a lista de vídeos a cada 15 segundos e conta as exibições dos anúncios.
- Tecla MENU do controle: trocar o endereço do sistema (padrão: https://estimafood.evocrm.sbs).
- Para sair do app: apertar Voltar 3 vezes seguidas.

## Onde fica

Esta pasta mora dentro do repositório do EstimaFood (pasta app-tv-android).
O servidor bloqueia o acesso público a ela, então a chave de assinatura
(app/estimafood-tv.jks) não fica exposta. Mantenha o repositório PRIVADO.

O pacote continua "com.estimafood.tv" de propósito: assim o app novo instala
por cima do antigo nas TVs que já têm o app.

## Gerar um .apk novo

Mudou algo nesta pasta e enviou para o GitHub: a aba "Actions" roda o
"Gerar app da TV" sozinha (uns 5 minutos) e o vissetv.apk aparece em
"Releases". Depois é só trocar o vissetv.apk na pasta do projeto.
