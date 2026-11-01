-- Purchase records retain identity, amounts, GPS, chronology, versions and original request hashes.
ALTER TABLE fuel_entries
    DROP COLUMN station_name,
    DROP COLUMN notes,
    DROP COLUMN tank_state,
    DROP COLUMN history_gap_before;

-- This boundary existed only to propagate the removed history-gap marker.
ALTER TABLE vehicles DROP COLUMN pending_history_gap_after;
