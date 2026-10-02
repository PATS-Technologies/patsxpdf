# PATS PDF

Visualizador web de PDFs com biblioteca no servidor, conversão de DOCX, XLSX e PPTX para PDF, múltiplas abas, pesquisa, anotações persistentes e administração por papéis e privilégios.

## Execução com Docker

1. Copie `.env.example` para `.env` e altere as senhas e a chave de sessão.
2. Execute `docker compose up --build -d`.
3. Acesse `http://localhost:3000` (ou a porta definida em `APP_PORT`).

A conta inicial é `admin`, com senha `admin`. Altere-a na tela **Configurações > Usuários** após o primeiro acesso.

Os dados do PostgreSQL e os PDFs ficam nos volumes `postgres-data` e `pdf-data`. O schema e os registros iniciais são aplicados automaticamente na criação de um volume novo do banco. Arquivos DOCX, XLSX e PPTX enviados pelo usuário são convertidos para PDF pelo serviço interno `libreoffice` (Gotenberg) antes de serem armazenados; esse serviço não publica portas para o host.

Para preservar a formatação dos documentos, as fontes instaladas no Windows são montadas no conversor em modo somente leitura. O caminho padrão para WSL é `/mnt/c/Windows/Fonts` e pode ser alterado com `WINDOWS_FONTS_PATH`. As fontes não são copiadas para o repositório nem incorporadas à imagem; a máquina que executar o stack deve possuir as licenças necessárias para utilizá-las.

Para uma instalação com volume de banco já existente, aplique a migração de auditoria antes de atualizar a aplicação:

```bash
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/003-audit.sql
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/004-user-preferred-locale.sql
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/005-user-password-activation.sql
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/006-conversion-task.sql
```

## Desenvolvimento local

Com um PostgreSQL e uma instância do Gotenberg disponíveis, defina `DATABASE_URL`, `SESSION_SECRET`, `PDF_STORAGE` e `OFFICE_CONVERTER_URL`. Em seguida:

```bash
npm install
npm run dev
```

Verificações do projeto:

```bash
npm run lint
npm run build
```

`MAX_UPLOAD_MB` limita o arquivo recebido e também configura o limite da API de conversão. O tempo máximo pode ser ajustado com `OFFICE_CONVERTER_TIMEOUT` no container e `OFFICE_CONVERTER_TIMEOUT_MS` na aplicação.

## Conversões

Uploads de DOCX, XLSX e PPTX geram uma tarefa persistente antes do início da conversão. A tela **Arquivo > Conversões** mostra as tarefas em ordem cronológica decrescente; administradores visualizam todos os usuários e os demais usuários visualizam somente as próprias tarefas. O histórico informa os estados processando, OK, alerta ou erro e permite abrir o PDF quando disponível.

Antes da conversão, a aplicação verifica as fontes declaradas no pacote OOXML contra o catálogo produzido pelo mesmo ambiente do LibreOffice e identifica referências externas. Fontes ausentes ou conteúdo externo resultam em alerta, pois podem alterar a formatação do PDF. `OFFICE_FONT_CATALOG` define onde a aplicação lê esse catálogo.

## Atalhos de navegação

- `PgDn` e `PgUp`: avançam ou retrocedem uma página no viewer e nas tabelas.
- `↓` e `↑`: selecionam o próximo registro ou o registro anterior nas tabelas.
- `Ctrl+Home`: retorna à primeira página.
- `Ctrl+End`: vai à última página; nas tabelas selecionáveis, também seleciona o último registro.
- `Esc`: fecha o modal ativo e cancela a operação em andamento no modal; nas páginas com tabela, retorna ao workspace.

As tabelas são paginadas em blocos de 100 registros, selecionam automaticamente o primeiro item e também possuem controles visuais de página. As páginas de tabela possuem um botão **X** no canto superior direito para retornar ao workspace.

## Segurança

As sessões são JWT assinados armazenados em cookie `HttpOnly`, `SameSite=Lax`. Senhas usam bcrypt com custo 12. Novos usuários recebem um código de ativação de uso único para definir a senha no primeiro acesso; somente o hash do código é armazenado e sua validade padrão é de 24 horas, configurável por `PASSWORD_ACTIVATION_HOURS`. As APIs validam privilégios no servidor usando níveis compatíveis com o PATSXPS: `recurso-1` para consulta, `recurso-2` para edição e `recurso-9` para administração.

O container web usa Ubuntu 24.04 atualizado, Node.js 24.18.0 fixado e validado pelo `SHASUMS256.txt` oficial. O runtime recebe somente o binário Node e os artefatos standalone, executa como usuário sem login e usa `tini` como PID 1.

## Idiomas

A interface e as mensagens das APIs estão disponíveis em Português do Brasil (`pt-BR`), Inglês dos EUA (`en-US`), Espanhol (`es`) e Francês (`fr`). O idioma preferido é definido no cadastro do usuário, aplicado automaticamente no login e atualizado quando o usuário troca o idioma no cabeçalho. Antes da autenticação, a escolha da tela de login é armazenada em cookie `HttpOnly` por um ano.

## Auditoria

Alterações de documentos, anotações, parâmetros e usuários são registradas na tabela `audit_event` na mesma transação do dado alterado. Logins bem-sucedidos e falhos e logouts também são registrados. Cada evento contém ator, ação, recurso, resultado, data, request id, IP, user-agent e metadados sem senhas ou hashes.

A tabela é append-only: um trigger do PostgreSQL bloqueia `UPDATE` e `DELETE`. Usuários com o privilégio `audit-1` (incluindo administradores) podem consultar eventos em `GET /api/audit`, com filtros opcionais `limit`, `before`, `actorId` e `resourceType`.
