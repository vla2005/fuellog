package com.fuellog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fuellog.fueling.FuelEntryDtos;
import com.fuellog.fueling.TankState;
import com.fuellog.vehicles.FuelType;
import com.fuellog.vehicles.VehicleDtos;
import java.util.List;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.jackson.autoconfigure.JacksonAutoConfiguration;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.json.JsonMapper;

class StrictJsonTypesTest {
    private static AnnotationConfigApplicationContext context;
    private static JsonMapper mapper;

    @BeforeAll
    static void bootMapper() {
        context = new AnnotationConfigApplicationContext();
        context.register(JacksonAutoConfiguration.class);
        context.scan("com.fuellog.platform");
        context.refresh();
        mapper = context.getBean(JsonMapper.class);
    }

    @AfterAll static void close() { context.close(); }

    @Test
    void yearRequiresAnIntegerToken() {
        for (String value : List.of("2020.9", "\"2020\"")) {
            assertThatThrownBy(() -> mapper.readValue("{\"modelYear\":" + value + "}", VehicleDtos.Create.class))
                    .isInstanceOf(JacksonException.class);
        }
    }

    @Test
    void enumNamesCannotBeReplacedByTheirJavaOrdinal() {
        assertThatThrownBy(() -> mapper.readValue("{\"allowedFuels\":[0]}", VehicleDtos.Create.class))
                .isInstanceOf(JacksonException.class);
        for (String field : List.of("fuelType", "tankState")) {
            for (String value : List.of("0", "\"0\"")) {
                assertThatThrownBy(() -> mapper.readValue("{\"" + field + "\":" + value + "}", FuelEntryDtos.Create.class))
                        .isInstanceOf(JacksonException.class);
            }
        }
    }

    @Test
    void continuityRequiresAJsonBoolean() {
        for (String value : List.of("0", "2", "0.5", "\"false\"", "\"true\"")) {
            assertThatThrownBy(() -> mapper.readValue("{\"historyGapBefore\":" + value + "}", FuelEntryDtos.Create.class))
                    .isInstanceOf(JacksonException.class);
        }
    }

    @Test
    void documentedTypesRemainValid() {
        var vehicle = mapper.readValue("{\"modelYear\":2020,\"allowedFuels\":[\"GASOLINE_REGULAR\"]}", VehicleDtos.Create.class);
        assertThat(vehicle.modelYear()).isEqualTo(2020);
        assertThat(vehicle.allowedFuels()).containsExactly(FuelType.GASOLINE_REGULAR);
        var entry = mapper.readValue("{\"fuelType\":\"GASOLINE_REGULAR\",\"tankState\":\"FULL\",\"historyGapBefore\":false,\"liters\":\"35.000\"}", FuelEntryDtos.Create.class);
        assertThat(entry.fuelType()).isEqualTo(FuelType.GASOLINE_REGULAR);
        assertThat(entry.tankState()).isEqualTo(TankState.FULL);
        assertThat(entry.historyGapBefore()).isFalse();
        assertThat(entry.liters()).isEqualTo("35.000");
    }
}
