# PATS PDF

Visualizador web de PDFs com biblioteca no servidor, múltiplas abas, pesquisa, anotações persistentes e administração por papéis e privilégios.

## Execução com Docker

1. Copie `.env.example` para `.env` e altere as senhas e a chave de sessão.
2. Execute `docker compose up --build -d`.
3. Acesse `http://localhost:3000` (ou a porta definida em `APP_PORT`).

A conta inicial é `admin`, com senha `admin`. Altere-a na tela **Configurações > Usuários** após o primeiro acesso.

Os dados do PostgreSQL e os PDFs ficam nos volumes `postgres-data` e `pdf-data`. O schema e os registros iniciais são aplicados automaticamente na criação de um volume novo do banco.

Para uma instalação com volume de banco já existente, aplique a migração de auditoria antes de atualizar a aplicação:

```bash
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/003-audit.sql
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/004-user-preferred-locale.sql
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/005-user-password-activation.sql
```

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

As sessões são JWT assinados armazenados em cookie `HttpOnly`, `SameSite=Lax`. Senhas usam bcrypt com custo 12. Novos usuários recebem um código de ativação de uso único para definir a senha no primeiro acesso; somente o hash do código é armazenado e sua validade padrão é de 24 horas, configurável por `PASSWORD_ACTIVATION_HOURS`. As APIs validam privilégios no servidor usando níveis compatíveis com o PATSXPS: `recurso-1` para consulta, `recurso-2` para edição e `recurso-9` para administração.

O container web usa Ubuntu 24.04 atualizado, Node.js 24.18.0 fixado e validado pelo `SHASUMS256.txt` oficial. O runtime recebe somente o binário Node e os artefatos standalone, executa como usuário sem login e usa `tini` como PID 1.

## Idiomas

A interface e as mensagens das APIs estão disponíveis em Português do Brasil (`pt-BR`), Inglês dos EUA (`en-US`), Espanhol (`es`) e Francês (`fr`). O idioma preferido é definido no cadastro do usuário, aplicado automaticamente no login e atualizado quando o usuário troca o idioma no cabeçalho. Antes da autenticação, a escolha da tela de login é armazenada em cookie `HttpOnly` por um ano.

## Auditoria

Alterações de documentos, anotações, parâmetros e usuários são registradas na tabela `audit_event` na mesma transação do dado alterado. Logins bem-sucedidos e falhos e logouts também são registrados. Cada evento contém ator, ação, recurso, resultado, data, request id, IP, user-agent e metadados sem senhas ou hashes.

A tabela é append-only: um trigger do PostgreSQL bloqueia `UPDATE` e `DELETE`. Usuários com o privilégio `audit-1` (incluindo administradores) podem consultar eventos em `GET /api/audit`, com filtros opcionais `limit`, `before`, `actorId` e `resourceType`.
