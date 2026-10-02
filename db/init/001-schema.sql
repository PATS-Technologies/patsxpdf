CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_user (
  id BIGSERIAL PRIMARY KEY,
  login VARCHAR(80) NOT NULL,
  name VARCHAR(80) NOT NULL,
  email VARCHAR(160) NOT NULL,
  gender CHAR(1) CHECK (gender IN ('M', 'F')),
  password_hash VARCHAR(100) NOT NULL,
  password_expired BOOLEAN NOT NULL DEFAULT false,
  locked BOOLEAN NOT NULL DEFAULT false,
  deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS app_user_login_uk ON app_user (lower(trim(login))) WHERE NOT deleted;
CREATE UNIQUE INDEX IF NOT EXISTS app_user_email_uk ON app_user (lower(trim(email))) WHERE NOT deleted;

CREATE TABLE IF NOT EXISTS privilege (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(60) NOT NULL UNIQUE,
  description TEXT,
  system BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS role_privilege (
  role_id BIGINT NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  privilege_id BIGINT NOT NULL REFERENCES privilege(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, privilege_id)
);

CREATE TABLE IF NOT EXISTS user_role (
  user_id BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role_id BIGINT NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS app_param (
  code VARCHAR(40) PRIMARY KEY,
  value TEXT,
  description TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by BIGINT REFERENCES app_user(id)
);

CREATE TABLE IF NOT EXISTS pdf_document (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_name VARCHAR(255) NOT NULL,
  storage_name VARCHAR(255) NOT NULL UNIQUE,
  mime_type VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
  size_bytes BIGINT NOT NULL,
  page_count INTEGER NOT NULL,
  document_date TIMESTAMPTZ,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by BIGINT NOT NULL REFERENCES app_user(id)
);

CREATE TABLE IF NOT EXISTS conversion_task (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES app_user(id),
  document_id UUID REFERENCES pdf_document(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  original_name VARCHAR(255) NOT NULL,
  source_mime_type VARCHAR(160),
  source_size_bytes BIGINT NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('processing', 'ok', 'alert', 'error')),
  details TEXT
);

CREATE INDEX IF NOT EXISTS conversion_task_uploaded_at_idx ON conversion_task (uploaded_at DESC);
CREATE INDEX IF NOT EXISTS conversion_task_user_uploaded_at_idx ON conversion_task (user_id, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS annotation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES pdf_document(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  page INTEGER NOT NULL CHECK (page > 0),
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('highlight', 'note', 'circle', 'rectangle', 'freehand')),
  color VARCHAR(20) NOT NULL,
  geometry JSONB NOT NULL,
  content TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO privilege (code, description) VALUES
  ('admin', 'Todos os privilégios'),
  ('pdfs-1', 'Visualizar PDFs'),
  ('pdfs-2', 'Carregar e anotar PDFs'),
  ('pdfs-9', 'Administrar PDFs'),
  ('params-1', 'Visualizar parâmetros'),
  ('params-2', 'Editar parâmetros'),
  ('users-1', 'Visualizar usuários'),
  ('users-2', 'Editar usuários'),
  ('users-9', 'Administrar usuários')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role (id, name, description, system) VALUES
  (1, 'Administrador', 'Acesso irrestrito ao sistema', true),
  (2, 'Visualizador', 'Consulta de PDFs', true),
  (3, 'Operador', 'Carga e anotação de PDFs', true)
ON CONFLICT (id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('role', 'id'), GREATEST((SELECT max(id) FROM role), 1));

INSERT INTO role_privilege (role_id, privilege_id)
SELECT 1, id FROM privilege WHERE code = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_privilege (role_id, privilege_id)
SELECT 2, id FROM privilege WHERE code IN ('pdfs-1')
ON CONFLICT DO NOTHING;

INSERT INTO role_privilege (role_id, privilege_id)
SELECT 3, id FROM privilege WHERE code IN ('pdfs-2')
ON CONFLICT DO NOTHING;

INSERT INTO app_user (id, login, name, email, gender, password_hash)
VALUES (1, 'admin', 'Administrador', 'admin@localhost', NULL, '$2b$12$hDo4zdEHWx/OpV7qR7m5B.TmRJpaNhzl2kFfg/GGjJij6ZSyQQ6Di')
ON CONFLICT (id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('app_user', 'id'), GREATEST((SELECT max(id) FROM app_user), 1));

INSERT INTO user_role (user_id, role_id) VALUES (1, 1)
ON CONFLICT DO NOTHING;

INSERT INTO app_param (code, value, description, updated_by) VALUES
  ('MAX_UPLOAD_MB', '100', 'Tamanho máximo de upload de PDF em MB', 1),
  ('SESSION_HOURS', '24', 'Duração da sessão do usuário em horas', 1),
  ('PDF_STORAGE', '/data/pdfs', 'Pasta de armazenamento dos arquivos PDF', 1)
ON CONFLICT (code) DO NOTHING;
