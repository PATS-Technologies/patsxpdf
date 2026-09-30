# PATS PDF

Visualizador web de PDFs com biblioteca no servidor, múltiplas abas, pesquisa, anotações persistentes e administração por papéis e privilégios.

## Execução com Docker

1. Copie `.env.example` para `.env` e altere as senhas e a chave de sessão.
2. Execute `docker compose up --build -d`.
3. Acesse `http://localhost:3000` (ou a porta definida em `APP_PORT`).

A conta inicial é `admin`, com senha `admin`. Altere-a na tela **Configurações > Usuários** após o primeiro acesso.

Os dados do PostgreSQL e os PDFs ficam nos volumes `postgres-data` e `pdf-data`. O schema e os registros iniciais são aplicados automaticamente na criação de um volume novo do banco.

## Desenvolvimento local

Com um PostgreSQL disponível, defina `DATABASE_URL`, `SESSION_SECRET` e `PDF_STORAGE`. Em seguida:

```bash
npm install
npm run dev
```

Verificações do projeto:

```bash
npm run lint
npm run build
```

## Segurança

As sessões são JWT assinados armazenados em cookie `HttpOnly`, `SameSite=Lax`. Senhas usam bcrypt com custo 12. As APIs validam privilégios no servidor usando níveis compatíveis com o PATSXPS: `recurso-1` para consulta, `recurso-2` para edição e `recurso-9` para administração.

O container web usa Ubuntu 24.04 atualizado, Node.js 24.18.0 fixado e validado pelo `SHASUMS256.txt` oficial. O runtime recebe somente o binário Node e os artefatos standalone, executa como usuário sem login e usa `tini` como PID 1.
