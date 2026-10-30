-- Retain identity and chronology so retries cannot restore deleted purchases or bridge missing fuel.
ALTER TABLE fuel_entries ADD COLUMN deleted_at TIMESTAMPTZ;
