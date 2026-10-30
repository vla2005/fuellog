-- Keep historical adjustments and also allow the milliliter rounding of paid / price.
DO $$
DECLARE amount_check RECORD;
BEGIN
    FOR amount_check IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'fuel_entries'::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%adjustment_reason%'
    LOOP
        EXECUTE format('ALTER TABLE fuel_entries DROP CONSTRAINT %I', amount_check.conname);
    END LOOP;
END $$;

ALTER TABLE fuel_entries ADD CONSTRAINT fuel_entries_amounts_check CHECK (
    abs(paid_total - round(liters * unit_price, 2)) <= 0.05
    OR nullif(btrim(adjustment_reason), '') IS NOT NULL
    OR liters = round(paid_total / unit_price, 3)
);
