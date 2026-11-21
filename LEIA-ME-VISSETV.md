# Atualização: TV Indoor + VisseTV

## O que tem aqui
- Sistema EstimaFood completo, com tudo atualizado.
- `vissetv.apk`: app das TVs, pronto para instalar (as TVs baixam em `/app-tv`).
- `app-tv-android/`: projeto do app (código-fonte). Só serve para gerar versões novas.
- `.github/workflows/gerar-app-tv.yml`: o GitHub monta o app sozinho quando a pasta do app muda.
- `marca-vissetv/`: logo em SVG e PNG (ícone, logo para fundo claro e escuro, banner).
- `vissetv/`: arquivos da marca usados pelas telas do sistema.

## Endereços
- `/outdoor`: painel do anunciante VisseTV (login e senha que você cria no admin).
- `/tv`: player para TVs sem Android (Samsung, LG) no navegador.
- `/app-tv`: download do app Android.

## Depois de subir
Reinicie o servidor. As tabelas novas do banco são criadas sozinhas.
O repositório precisa ser PRIVADO (a chave que assina o app está em app-tv-android).
