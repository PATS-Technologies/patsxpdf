# PATS PDF

Visualizador web de PDFs com biblioteca no servidor, conversão de DOCX, XLSX e PPTX para PDF, múltiplas abas, pesquisa, anotações persistentes e administração por papéis e privilégios.

## Execução com Docker

1. Copie `.env.example` para `.env` e altere as senhas e a chave de sessão.
2. Execute `docker compose up --build -d`.
3. Acesse `http://localhost:3000` (ou a porta definida em `APP_PORT`).

A conta inicial é `admin`, com senha `admin`. Altere-a na tela **Configurações > Usuários** após o primeiro acesso.

Os dados do PostgreSQL, os PDFs e os resultados de OCR ficam nos volumes `postgres-data`, `pdf-data` e `ocr-data`. O schema e os registros iniciais são aplicados automaticamente na criação de um volume novo do banco. Arquivos DOCX, XLSX e PPTX enviados pelo usuário são convertidos para PDF pelo serviço interno `libreoffice` (Gotenberg) antes de serem armazenados; esse serviço não publica portas para o host.

Para preservar a formatação dos documentos, as fontes instaladas no Windows são montadas no conversor em modo somente leitura. O caminho padrão para WSL é `/mnt/c/Windows/Fonts` e pode ser alterado com `WINDOWS_FONTS_PATH`. As fontes não são copiadas para o repositório nem incorporadas à imagem; a máquina que executar o stack deve possuir as licenças necessárias para utilizá-las.

As migrações pendentes são aplicadas automaticamente pelo serviço `migrate` antes da aplicação iniciar. Para aplicá-las manualmente:

```bash
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/003-audit.sql
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/004-user-preferred-locale.sql
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/005-user-password-activation.sql
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/006-conversion-task.sql
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/007-audit-filename.sql
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/008-error-event.sql
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/009-ocr-task.sql
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/010-extraction-task.sql
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

## OCR e PDFBox

O serviço interno `pdfbox` usa Apache PDFBox 3 e Tesseract para OCR em português, inglês, espanhol e francês. Ele não publica portas para o host e exige o token compartilhado `PDFBOX_API_TOKEN`. `OCR_DPI`, `OCR_WORKERS` e `OCR_PAGE_TIMEOUT_SECONDS` controlam, respectivamente, a resolução, o paralelismo entre tarefas e o limite por página. Os PDFs pesquisáveis gerados pelo OCR são rasterizados na resolução configurada.

As extrações de texto são híbridas. O PDFBox preserva o texto nativo e suas coordenadas, mascara essas regiões na imagem da página e aplica Tesseract somente ao conteúdo visual restante. Os fragmentos nativos e reconhecidos são então ordenados espacialmente. O resultado inclui um TXT na ordem de leitura e um JSON por página com coordenadas, origem (`native` ou `ocr`) e confiança do OCR.

Extrações de uma página são processadas de forma síncrona. Solicitações de duas ou mais páginas viram tarefas assíncronas persistentes, identificadas por um número público no formato `999.999.999.999`, e podem ser acompanhadas pela fila de extração.

As APIs exigem sessão e os privilégios de PDF usuais:

- `POST /api/ocr/page`: recebe JSON com `documentId`, `page` e `languages` opcional; processa uma página do documento armazenado e retorna o texto em JSON e as URLs dos artefatos.
- `POST /api/ocr/jobs`: recebe `multipart/form-data` com `file` e um ou mais campos `languages`; inicia o OCR completo de forma assíncrona.
- `GET /api/ocr/jobs`: lista as tarefas do usuário; administradores visualizam todas.
- `GET /api/ocr/jobs/{id}`: consulta e sincroniza o andamento da tarefa.
- `GET /api/ocr/jobs/{id}/text`: retorna o texto reconhecido em JSON após a conclusão.
- `GET /api/ocr/jobs/{id}/pdf`: baixa o PDF pesquisável após a conclusão.
- `POST /api/extractions`: recebe `documentId` e `pages`; retorna o resultado diretamente para uma página ou cria uma tarefa para várias páginas.
- `GET /api/extractions`: lista as tarefas de extração.
- `GET /api/extractions/{id}`: consulta e sincroniza o andamento da extração.
- `GET /api/extractions/{id}/text`: baixa o texto na ordem de leitura.
- `GET /api/extractions/{id}/json`: baixa o JSON posicional por página.

Os códigos de idioma aceitos são `por`, `eng`, `spa` e `fra`. Quando omitidos, os quatro idiomas são utilizados.

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
