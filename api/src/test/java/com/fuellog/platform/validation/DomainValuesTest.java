package com.fuellog.platform.validation;

import com.fuellog.platform.exceptions.ApiException;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class DomainValuesTest {
    @Test void rejectsOversizedDecimalsBeforeNumericParsing() {
        for (String input : new String[]{"0".repeat(64) + "1", "0".repeat(100_000) + "1", "1".repeat(100_000)}) {
            ApiException error = assertThrows(ApiException.class, () -> decimal(input, true));
            assertEquals(422, error.status());
            assertTrue(error.fieldErrors().containsKey("liters"));
        }
    }

    @Test void acceptsTheInputLengthBoundaryAndKeepsExistingDecimalRules() {
        assertEquals(new BigDecimal("1"), decimal("0".repeat(63) + "1", true));
        assertEquals(new BigDecimal("999999999.999"), decimal("999999999.999", true));
        assertNull(decimal(null, false));
        for (String input : new String[]{"0", "-1", "1e2", "1,2", "1.0000", "1000000000", "", " 1"})
            assertThrows(ApiException.class, () -> decimal(input, true));
        assertThrows(ApiException.class, () -> decimal(null, true));
    }

    private BigDecimal decimal(String input, boolean required) {
        return DomainValues.decimal(input, "liters", 12, 3, required);
    }
}
