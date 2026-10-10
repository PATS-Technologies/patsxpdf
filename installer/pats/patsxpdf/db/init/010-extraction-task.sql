CREATE TABLE IF NOT EXISTS extraction_task (
  id UUID PRIMARY KEY,
  public_id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  user_id BIGINT NOT NULL REFERENCES app_user(id),
  document_id UUID NOT NULL REFERENCES pdf_document(id) ON DELETE CASCADE,
  original_name VARCHAR(255) NOT NULL,
  requested_pages INTEGER[] NOT NULL,
  languages TEXT[] NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'error')),
  total_pages INTEGER NOT NULL,
  processed_pages INTEGER NOT NULL DEFAULT 0,
  used_ocr BOOLEAN,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CHECK (cardinality(requested_pages) >= 2)
);

CREATE INDEX IF NOT EXISTS extraction_task_created_at_idx
  ON extraction_task (created_at DESC);
CREATE INDEX IF NOT EXISTS extraction_task_user_created_at_idx
  ON extraction_task (user_id, created_at DESC);
