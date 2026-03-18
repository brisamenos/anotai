# 🍕 Estima Food — Servidor Próprio (SQLite + Node.js)

Versão **sem Supabase** — tudo roda no seu VPS via **GitHub + Easypanel**.

---

## 📦 O que mudou

| Antes (Supabase) | Agora (VPS próprio) |
|---|---|
| Banco PostgreSQL no Supabase | **SQLite** local no VPS |
| Supabase Realtime (WebSocket) | **SSE** — Server-Sent Events (nativo no servidor) |
| Supabase Storage (imagens) | **Upload local** salvo em `/app/data/uploads` |
| SDK `@supabase/supabase-js` nos HTMLs | **`supabase-shim.js`** — emula 100% da SDK |
| Autenticação Supabase Auth | Autenticação própria com `sys_users` no SQLite |

> Os HTMLs **não precisam ser reescritos** — o shim mantém toda a API compatível.

---

## 🚀 Deploy no Easypanel (passo a passo)

### 1. Suba o projeto no GitHub

```bash
# No seu computador, na pasta do projeto
git init
git add .
git commit -m "feat: migração Supabase → SQLite local"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/estima-food.git
git push -u origin main
```

---

### 2. Configure o Easypanel

1. Acesse seu Easypanel → **New Service → App**
2. **Source:** GitHub → selecione o repositório `estima-food`
3. **Branch:** `main`
4. **Build:** Docker (usa o `Dockerfile` do projeto automaticamente)
5. **Port:** `3001`

---

### 3. Configure o Volume (IMPORTANTE — dados persistentes)

No Easypanel, vá em **Volumes** do serviço e adicione:

| Host Path | Container Path |
|---|---|
| `/var/estima-food-data` | `/app/data` |

> ⚠️ **Sem isso, o banco SQLite e as imagens são apagados a cada deploy!**

---

### 4. Variáveis de ambiente (opcional)

No Easypanel → **Environment**:

```
PORT=3001
DB_PATH=/app/data/estima.db
UPLOADS_DIR=/app/data/uploads
EVOLUTION_URL=https://projeto-evolution-api.xtknqq.easypanel.host
EVOLUTION_KEY=429683C4C977415CAAFCCE10F7D57E11
EVOLUTION_INST=estima-food
```

---

### 5. Domain / HTTPS

No Easypanel → **Domains**, configure o domínio:
- Exemplo: `app.estimafood.com.br`
- Ativa o **HTTPS automático** (Let's Encrypt)

---

### 6. Primeiro acesso

Após o deploy, acesse:

```
https://app.estimafood.com.br/login.html
```

**Credenciais padrão criadas automaticamente:**
```
Email:  admin@estimafood.com
Senha:  admin123
```

> ⚠️ Troque a senha no painel admin assim que logar!

---

## 🔄 Como fazer atualizações

```bash
# Edita os arquivos localmente
git add .
git commit -m "fix: descrição da mudança"
git push origin main
```

O Easypanel detecta o push e faz rebuild automático (CI/CD). O banco de dados **não é apagado** por estar no volume.

---

## 📁 Estrutura do projeto

```
estima-food/
├── server.js          ← Servidor Node.js (SQLite + REST + SSE + WhatsApp)
├── supabase-shim.js   ← Emula SDK do Supabase (mantém HTMLs sem alteração)
├── package.json       ← Dependência: better-sqlite3
├── Dockerfile         ← Build para Easypanel
├── patch-html.js      ← Script utilitário (já foi executado)
├── .env.example       ← Variáveis de ambiente de exemplo
├── .gitignore
│
├── index.html         ← Cardápio público
├── login.html         ← Login do sistema
├── gestor.html        ← Painel do gestor
├── garcom.html        ← App do garçom
├── admin.html         ← Painel superadmin
├── garcom-sw.js       ← Service Worker do garçom (polling)
└── gestor-sw.js       ← Service Worker do gestor (polling)
```

---

## 🗄️ Tabelas SQLite

| Tabela | Descrição |
|---|---|
| `tenants` | Restaurantes cadastrados |
| `sys_users` | Usuários do sistema (gestor, admin) |
| `store_config` | Configurações da loja |
| `categories` | Categorias do cardápio |
| `menu_items` | Itens do cardápio |
| `orders` | Pedidos |
| `mesas` | Mesas do restaurante |
| `garcons` | Garçons |
| `movimentos` | Movimentações do caixa |
| `estoque` | Controle de estoque |
| `fidelidade` | Programa de fidelidade |
| `customers` | Clientes (delivery) |
| `cupons` | Cupons de desconto |

---

## 🔌 Endpoints da API

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/rest/v1/:tabela` | Lista registros (filtros via query string) |
| `POST` | `/rest/v1/:tabela` | Insere registro |
| `PATCH` | `/rest/v1/:tabela` | Atualiza registro |
| `DELETE` | `/rest/v1/:tabela` | Remove registro |
| `GET` | `/sse/:channel` | Stream SSE (substitui Realtime) |
| `POST` | `/storage/v1/object/:bucket/:path` | Upload de imagem |
| `GET` | `/uploads/:filename` | Serve imagem |
| `POST` | `/enviar` | Envia WhatsApp avulso |
| `POST` | `/promocao` | Envio em massa |
| `GET` | `/status` | Health check |

---

## 💾 Backup do banco

```bash
# No servidor VPS, via SSH
cp /var/estima-food-data/estima.db /var/estima-food-data/estima.db.bak

# Ou baixa para o computador
scp usuario@seu-vps:/var/estima-food-data/estima.db ./backup-$(date +%Y%m%d).db
```

---

## 🐛 Troubleshooting

**Servidor não inicia:**
```bash
# No Easypanel → Logs do serviço
# Verifique se o volume /app/data está montado
```

**Imagens não aparecem após deploy:**
```
→ Confirme que o volume /app/data está mapeado
→ As imagens ficam em /app/data/uploads/
```

**SSE (tempo real) não funciona:**
```
→ Verifique se o proxy do Easypanel tem timeout longo (SSE mantém conexão aberta)
→ No Easypanel → Service → Advanced → Proxy Timeout: 3600
```
