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

CREATE INDEX IF NOT EXISTS conversion_task_uploaded_at_idx
  ON conversion_task (uploaded_at DESC);
CREATE INDEX IF NOT EXISTS conversion_task_user_uploaded_at_idx
  ON conversion_task (user_id, uploaded_at DESC);
