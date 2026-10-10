CREATE TABLE IF NOT EXISTS error_event (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  route TEXT NOT NULL,
  method VARCHAR(12) NOT NULL,
  status_code INTEGER NOT NULL CHECK (status_code BETWEEN 400 AND 599),
  error_name VARCHAR(160) NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  request_id UUID NOT NULL,
  ip_address INET,
  user_agent TEXT,
  filename VARCHAR(255),
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS error_event_occurred_at_idx ON error_event (occurred_at DESC);
CREATE INDEX IF NOT EXISTS error_event_status_idx ON error_event (status_code, occurred_at DESC);
CREATE INDEX IF NOT EXISTS error_event_route_idx ON error_event (route, occurred_at DESC);
CREATE INDEX IF NOT EXISTS error_event_actor_idx ON error_event (actor_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION prevent_error_event_changes()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'error_event is append-only';
END;
$$;

DROP TRIGGER IF EXISTS error_event_immutable ON error_event;
CREATE TRIGGER error_event_immutable
BEFORE UPDATE OR DELETE ON error_event
FOR EACH ROW EXECUTE FUNCTION prevent_error_event_changes();
