# EstimaFood TV (app Android)

App que passa os vídeos da TV Indoor do EstimaFood na TV da loja.

- Abre sozinho quando a TV liga (depois de liberar "Abrir sozinho ao ligar a TV" na primeira tela).
- Mostra um código de 6 números. No gestor: TV Indoor > Adicionar TV > digitar o código.
- Guarda os vídeos no aparelho: se a internet cair, continua passando.
- Confere a lista de vídeos a cada 15 segundos.
- Tecla MENU do controle: trocar o endereço do sistema (padrão: https://estimafood.evocrm.sbs).
- Para sair do app: apertar Voltar 3 vezes seguidas.

## Onde fica

Esta pasta mora dentro do repositório do EstimaFood (pasta app-tv-android).
O servidor bloqueia o acesso público a ela, então a chave de assinatura
(app/estimafood-tv.jks) não fica exposta. Mantenha o repositório privado.

## Como gerar um .apk novo

Mudou algo nesta pasta e enviou para o GitHub: a aba "Actions" roda o
"Gerar app da TV" sozinha (uns 5 minutos) e o estimafood-tv.apk aparece em
"Releases". Depois é só trocar o estimafood-tv.apk na pasta do projeto.
