CREATE TABLE IF NOT EXISTS audit_event (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  resource_type VARCHAR(80) NOT NULL,
  resource_id VARCHAR(255),
  outcome VARCHAR(16) NOT NULL CHECK (outcome IN ('success', 'failure')),
  request_id UUID NOT NULL,
  ip_address INET,
  user_agent TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_event_occurred_at_idx ON audit_event (occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_event_actor_idx ON audit_event (actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_event_resource_idx ON audit_event (resource_type, resource_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION prevent_audit_event_changes()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_event_immutable ON audit_event;
CREATE TRIGGER audit_event_immutable
BEFORE UPDATE OR DELETE ON audit_event
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_changes();

INSERT INTO privilege (code, description) VALUES
  ('audit-1', 'Visualizar trilha de auditoria')
ON CONFLICT (code) DO NOTHING;