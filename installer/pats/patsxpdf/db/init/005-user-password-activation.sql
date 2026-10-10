ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS activation_code_hash VARCHAR(100),
  ADD COLUMN IF NOT EXISTS activation_code_expires_at TIMESTAMPTZ;
