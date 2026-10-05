ALTER TABLE audit_event
ADD COLUMN IF NOT EXISTS filename VARCHAR(255);

DROP TRIGGER IF EXISTS audit_event_immutable ON audit_event;

UPDATE audit_event a
SET filename = COALESCE(
  NULLIF(a.details->>'fileName', ''),
  (
    SELECT d.original_name
    FROM pdf_document d
    WHERE d.id::text = CASE
      WHEN a.resource_type = 'pdf_document' THEN a.resource_id
      ELSE a.details->>'documentId'
    END
    LIMIT 1
  )
)
WHERE a.filename IS NULL;

CREATE TRIGGER audit_event_immutable
BEFORE UPDATE OR DELETE ON audit_event
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_changes();
