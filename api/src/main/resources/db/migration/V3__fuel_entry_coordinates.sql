ALTER TABLE fuel_entries
    ADD COLUMN latitude NUMERIC(10,7),
    ADD COLUMN longitude NUMERIC(10,7),
    ADD CONSTRAINT fuel_entries_coordinates_check CHECK (
        (latitude IS NULL AND longitude IS NULL)
        OR (latitude IS NOT NULL AND longitude IS NOT NULL
            AND latitude BETWEEN -90 AND 90
            AND longitude BETWEEN -180 AND 180)
    );
