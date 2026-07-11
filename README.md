# Avantio Cleaner Scale 🧹

API Serverless construída com **Cloudflare Workers**, **Hono** e **Chanfana** para automatizar a geração de escalas de limpeza baseadas em check-ins e check-outs da plataforma Avantio.

---
## para saber como chamar essa api entre [aqui](https://github.com/MorpphAI/pineapples-worker/blob/main/doc/api-external-doc.md)

## 📋 Sobre o Projeto

O objetivo deste sistema é cruzar dados de reservas da Avantio com a disponibilidade da equipe de limpeza para gerar uma escala diária otimizada.

### Fluxo de Funcionamento

1. **Entrada 1:** Busca Check-ins (chegadas) e Check-outs (saídas) na API da Avantio
2. **Entrada 2:** Busca a lista de camareiras ativas e suas zonas de atuação no banco D1
3. **Processamento:** Cruza os dados identificando prioridades (ex: Turnover/Bate-volta)
4. **Saída:** Gera e salva a escala de limpeza no banco de dados

---

## 🔐 Autenticação

Todos os endpoints são protegidos por API Key. Inclua o header abaixo em todas as requisições:

```
x-api-key: SUA_CHAVE_AQUI
```

Requisições sem o header ou com chave inválida retornam `401 Unauthorized`.

---

## 🚀 Como Rodar o Projeto

### Pré-requisitos

- Node.js instalado
- Conta na Cloudflare

### 1. Instalação

```bash
npm install
```

### 2. Configuração de Variáveis

Crie um arquivo `.dev.vars` na raiz do projeto (não comite este arquivo) com as credenciais:

```env
AVANTIO_API_KEY=sua_chave_aqui
AVANTIO_BASE_URL=https://api.avantio.pro/pms/v2
API_KEY=sua_api_key_local
```

### Decisões de autorização para Cange

O Worker expõe decisões determinísticas, sem gravar em PineOS ou Cange:

```http
GET /v1/cange/authorization-decisions?date=YYYY-MM-DD
POST /v1/cange/authorization-decisions
```

O corpo do `POST` aceita:

```json
{ "date": "YYYY-MM-DD" }
```

A rota legada `POST /v1/kanban/authorization-sync` foi desativada e retorna `410 Gone`.

### 3. Executando Localmente

Existem dois modos de rodar o projeto localmente:

#### Modo A: Totalmente Local (Banco Mockado)

Roda o código no seu PC e cria um banco SQLite temporário na pasta `.wrangler`. Ideal para desenvolvimento rápido sem internet.

```bash
npx wrangler dev
```

#### Modo B: Local com Banco Real (Recomendado)

Roda o código no seu PC, mas conecta e salva os dados no banco D1 da Cloudflare (Produção). Ideal para testar com dados reais.

```bash
npx wrangler dev --remote
```

Acesse a documentação (Swagger) em: http://localhost:8787

---

## 🗄️ Banco de Dados (D1)

O projeto utiliza o **Cloudflare D1** (SQLite na Borda). O nome do banco configurado no `wrangler.jsonc` é `pineapples-db`.

### Comandos de Migração (Migrations)

Sempre que alterar a estrutura do banco (criar tabelas, alterar colunas), use os comandos abaixo:

#### 1. Criar uma nova migração

Gera um arquivo `.sql` na pasta `migrations/`.

```bash
npx wrangler d1 migrations create pineapples-db nome_da_mudanca
```

**Exemplo:**
```bash
npx wrangler d1 migrations create pineapples-db create_schedule_table
```

#### 2. Aplicar migração LOCALMENTE

Atualiza o banco temporário do seu computador.

```bash
npx wrangler d1 migrations apply pineapples-db --local
```

#### 3. Aplicar migração em PRODUÇÃO (Remoto)

⚠️ **Cuidado:** Afeta os dados reais na nuvem da Cloudflare.

```bash
npx wrangler d1 migrations apply pineapples-db --remote
```

---

## 🛠️ Arquitetura do Projeto

O projeto segue o padrão de camadas (Layered Architecture):

```
src/
├── index.ts                    # Ponto de entrada (Hono, Swagger, middleware)
├── middleware/                 # Middlewares globais
│   └── auth.ts                # Autenticação por API Key (x-api-key)
├── controllers/                # Controladores das rotas (HTTP + OpenAPI schema)
│   ├── router.ts
│   └── v1/
│       ├── cleaner/            # Gestão da equipe (criar, listar, status, folgas)
│       ├── scale/              # Geração e consulta de escala
│       ├── priority/           # Visualização de prioridades
│       └── appointments/       # Sincronização com Avantio
├── services/                   # Regras de negócio e lógica pesada
├── repositories/               # Acesso direto ao banco de dados (SQL)
├── apiGateways/                # Integração com APIs externas (Avantio)
└── types/                      # Interfaces TypeScript e Variáveis de Ambiente
    ├── avantioTypes.ts
    ├── cleanerTypes.ts
    └── configTypes.ts
```

---

## 📦 Deploy

### Fazer Deploy para Produção

Todo código mergeado na `main` é deployado automaticamente via CI/CD no Cloudflare.

Para subir manualmente:

```bash
npx wrangler deploy
```

### Adicionar/Atualizar Secrets de Produção

```bash
npx wrangler secret put API_KEY
npx wrangler secret put AVANTIO_API_KEY
```

### Ver Logs em Tempo Real

```bash
npx wrangler tail
```

---

## 📚 Recursos Úteis

- [Documentação Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Documentação Hono](https://hono.dev/)
- [Documentação Cloudflare D1](https://developers.cloudflare.com/d1/)
- [API Avantio](https://api.avantio.pro/pms/v2)
