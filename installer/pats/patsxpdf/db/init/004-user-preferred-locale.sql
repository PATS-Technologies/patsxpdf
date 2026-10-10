ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS preferred_locale VARCHAR(10) NOT NULL DEFAULT 'pt-BR';

ALTER TABLE app_user
  DROP CONSTRAINT IF EXISTS app_user_preferred_locale_check;

ALTER TABLE app_user
  ADD CONSTRAINT app_user_preferred_locale_check
  CHECK (preferred_locale IN ('pt-BR', 'en-US', 'es', 'fr'));