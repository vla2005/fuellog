-- Accepted fuels govern new entries; historical purchases keep their original fuel.
-- The separate vehicle_id foreign key continues to enforce vehicle ownership of history.
ALTER TABLE fuel_entries DROP CONSTRAINT fuel_entries_vehicle_id_fuel_type_fkey;
