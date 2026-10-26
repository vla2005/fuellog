ALTER TABLE vehicles
    ADD COLUMN current_odometer_km BIGINT CHECK (current_odometer_km >= 0);
