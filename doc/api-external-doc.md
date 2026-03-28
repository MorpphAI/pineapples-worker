# Como chamar essa API externamente

API Serverless para automação de escalas de limpeza, integrada com Avantio, Cloudflare D1.

## Autenticação

**Todas as rotas exigem o header `x-api-key`.**

```http
x-api-key: SUA_CHAVE_AQUI
```

Requisições sem o header ou com chave inválida retornam:
```json
{ "success": false, "error": "Unauthorized" }
```

> A chave é gerenciada como Cloudflare Secret. Solicite ao responsável pelo projeto.

## URL Base

A API está rodando em Cloudflare Workers.
**URL:** `https://pineapples-worker.morphia.workers.dev`

---

## Guia de Integração (Endpoints)

### 1. Gerar Escala Diária (Core)

Esta é a rota principal. Ela processa Check-ins/Outs, aloca a equipe e salva no banco.

- **Método:** `POST`
- **Rota:** `/v1/scale`
- **Query Params:** `date` (Opcional, padrão: hoje. Formato: `YYYY-MM-DD`)

#### Exemplo de Chamada (cURL):

```bash
curl -X POST "https://pineapples-worker.morphia.workers.dev/v1/scale?date=2025-12-05" \
     -H "Content-Type: application/json" \
     -H "x-api-key: SUA_CHAVE_AQUI"
```

#### Resposta Sucesso:

```json
{
  "success": true,
  "message": "Escala gerada para o dia 2025-12-05",
  "runId": 15,
  "downloadUrl": "https://.../v1/scale/15/export"
}
```

### 2. Visualizar Escala Operacional

Retorna a visão agrupada por faxineira para o dia. Útil para dashboards ou envio de mensagens no WhatsApp.

- **Método:** `GET`
- **Rota:** `/v1/scale`
- **Query Params:** `date` (Opcional, padrão: hoje)

#### Exemplo N8N / Postman:

```http
GET /v1/scale?date=2025-12-05
x-api-key: SUA_CHAVE_AQUI
```

### 3. Baixar Relatório Excel

Faz o download direto do arquivo .xlsx de uma execução específica.

- **Método:** `GET`
- **Rota:** `/v1/scale/{runId}/export`

```bash
curl "https://pineapples-worker.morphia.workers.dev/v1/scale/15/export" \
     -H "x-api-key: SUA_CHAVE_AQUI" \
     --output escala.xlsx
```

---

## Gestão de Equipe (Cleaners)

### 4. Cadastrar Equipe

Cadastra faxineiras em lote. Suporta definição de fixas e zonas.

- **Método:** `POST`
- **Rota:** `/v1/cleaner`

#### Body:

```json
{
  "cleaners": [
    {
      "name": "Valda",
      "zones": "ZONA1",
      "shift_start": "08:00",
      "shift_end": "17:00",
      "is_fixed": true,
      "fixed_accommodations": "NS101, AP202"
    },
    {
      "name": "Maria",
      "zones": "ZONA2, BARRA",
      "shift_start": "08:00",
      "shift_end": "17:00",
      "is_fixed": false
    }
  ]
}
```

### 5. Ativar / Inativar Faxineira

- **Método:** `PATCH`
- **Rota:** `/v1/cleaner/:id`

#### Body:

```json
{ "is_active": false }
```

#### Resposta Sucesso:

```json
{ "success": true, "message": "Faxineira ativada/inativada com sucesso." }
```

---

## Gestão de Folgas (Off Days)

### 6. Cadastrar Folgas do Mês

Define os dias que a faxineira NÃO deve ser alocada.

- **Método:** `POST`
- **Rota:** `/v1/cleaner/offdays`

#### Body:

```json
{
  "month": "2025-12",
  "schedules": [
    {
      "cleanerId": 1,
      "offDays": ["2025-12-07", "2025-12-25"],
      "reason": "Folga + Natal"
    }
  ]
}
```

### 7. Consultar Folgas

- **Método:** `GET`
- **Rota:** `/v1/cleaner/offdays?month=2025-12`
