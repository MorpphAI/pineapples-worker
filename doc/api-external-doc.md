# Como chamar essa API externalmente

API Serverless para automação de escalas de limpeza, integrada com Avantio, Cloudflare D1 e Google Drive.

> **⚠️ Aviso de Segurança Importante**
>
> **ESTA API ATUALMENTE É PÚBLICA.**
>
> As rotas não possuem autenticação (API Key ou OAuth) configurada neste momento.
> Qualquer pessoa com a URL base pode realizar chamadas.
>
> **Recomendação Futura:** Implementar um middleware de autenticação (ex: Header `x-api-key`) antes de utilizar em ambientes de produção crítica expostos.

## URL Base

A API está rodando em Cloudflare Workers.
**URL:** `https://pineapples-worker.morphia.workers.dev` (Exemplo - substitua pela sua URL real)

---

## Guia de Integração (Endpoints)

### 1. Gerar Escala Diária (Core)

Esta é a rota principal. Ela processa Check-ins/Outs, aloca a equipe, salva no banco e envia o relatório para o Google Drive.

- **Método:** `POST`
- **Rota:** `/v1/scale`
- **Query Params:** `date` (Opcional, padrão: hoje. Formato: `YYYY-MM-DD`)

#### Exemplo de Chamada (cURL):

```bash
curl -X POST "https://SEU_WORKER.workers.dev/v1/scale?date=2025-12-05" \
     -H "Content-Type: application/json"
```

#### Resposta Sucesso:

```json
{
  "success": true,
  "message": "Escala gerada para o dia 2025-12-05",
  "runId": 15,
  "downloadUrl": "https://.../v1/scale/15/export",
  "driveUpload": {
    "status": "success",
    "fileUrl": "https://drive.google.com/file/d/..."
  }
}
```

### 2. Visualizar Escala Operacional

Retorna a visão agrupada por faxineira para o dia (quem limpa o quê e a que horas). Útil para dashboards ou envio de mensagens no WhatsApp.

- **Método:** `GET`
- **Rota:** `/v1/scale`
- **Query Params:** `date` (Opcional, padrão: hoje)

#### Exemplo N8N / Postman:

```http
GET /v1/scale?date=2025-12-05
```

### 3. Baixar Relatório Excel

Faz o download direto do arquivo .xlsx de uma execução específica.

- **Método:** `GET`
- **Rota:** `/v1/scale/{runId}/export`

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

---

## Gestão de Folgas (Off Days)

### 5. Cadastrar Folgas do Mês

Define os dias que a faxineira NÃO deve ser alocada.

- **Método:** `POST`
- **Rota:** `/v1/cleaners/off-days`

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

### 6. Consultar Folgas

- **Método:** `GET`
- **Rota:** `/v1/cleaners/off-days?month=2025-12`

