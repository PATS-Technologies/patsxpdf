CREATE TABLE IF NOT EXISTS ocr_task (
  id UUID PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES app_user(id),
  document_id UUID REFERENCES pdf_document(id) ON DELETE SET NULL,
  mode VARCHAR(16) NOT NULL CHECK (mode IN ('page', 'full')),
  page_number INTEGER CHECK (page_number IS NULL OR page_number > 0),
  original_name VARCHAR(255) NOT NULL,
  source_size_bytes BIGINT NOT NULL,
  languages TEXT[] NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'error')),
  total_pages INTEGER NOT NULL DEFAULT 0,
  processed_pages INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CHECK (
    (mode = 'page' AND page_number IS NOT NULL)
    OR (mode = 'full' AND page_number IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS ocr_task_created_at_idx
  ON ocr_task (created_at DESC);
CREATE INDEX IF NOT EXISTS ocr_task_user_created_at_idx
  ON ocr_task (user_id, created_at DESC);
