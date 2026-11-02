package com.fuellog.identity.configurations;

import static org.assertj.core.api.Assertions.*;
import org.junit.jupiter.api.Test;

class LoginRateLimitPropertiesTest {
    @Test void rejectsDisabledOrUnboundedSecurityBudgets() {
        for (int[] values : new int[][]{{0,100,300,50000},{1001,100,300,50000},{10,0,300,50000},
                {10,100001,300,50000},{10,100,0,50000},{10,100,3601,50000},{10,100,300,1},{10,100,300,1000001}})
            assertThatThrownBy(() -> new LoginRateLimitProperties(values[0], values[1], values[2], values[3]))
                    .isInstanceOf(IllegalArgumentException.class);
        assertThatCode(() -> new LoginRateLimitProperties(1,1,1,2)).doesNotThrowAnyException();
    }
}
