package com.fuellog;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class OpenApiContractTest {
    @Test
    void registrationPasswordBoundsMatchTheHttpValidation() throws Exception {
        var spec = new ObjectMapper().readTree(Files.readString(Path.of("..", "contracts", "openapi.json")));
        var password = spec.path("components").path("schemas").path("Register").path("properties").path("password");
        var component = Arrays.stream(Class.forName("com.fuellog.identity.IdentityController$Register").getRecordComponents())
                .filter(field -> field.getName().equals("password")).findFirst().orElseThrow();
        var size = component.getAccessor().getAnnotation(jakarta.validation.constraints.Size.class);
        assertThat(size.min()).isEqualTo(6);
        assertThat(size.max()).isEqualTo(128);
        assertThat(password.path("minLength").asInt()).isEqualTo(size.min());
        assertThat(password.path("maxLength").asInt()).isEqualTo(size.max());
    }

    @Test
    void documentedDtoPropertiesMatchTheHttpRecords() throws Exception {
        var spec = new ObjectMapper().readTree(Files.readString(Path.of("..", "contracts", "openapi.json")));
        assertThat(spec.path("openapi").asString()).isEqualTo("3.1.0");
        Map<String, String> types = Map.ofEntries(
                Map.entry("Register", "identity.IdentityController$Register"),
                Map.entry("Login", "identity.IdentityController$Login"),
                Map.entry("Refresh", "identity.IdentityController$Refresh"),
                Map.entry("RegisteredUser", "identity.IdentityService$RegisteredUser"),
                Map.entry("TokenResponse", "identity.IdentityService$TokenResponse"),
                Map.entry("Me", "identity.IdentityService$Me"),
                Map.entry("CreateVehicle", "vehicles.VehicleDtos$Create"),
                Map.entry("Vehicle", "vehicles.VehicleDtos$View"),
                Map.entry("CreateFuelEntry", "fueling.FuelEntryDtos$Create"),
                Map.entry("UpdateFuelEntry", "fueling.FuelEntryDtos$Update"),
                Map.entry("FuelEntry", "fueling.FuelEntryDtos$View"),
                Map.entry("FuelEntryPage", "fueling.FuelEntryDtos$Page"),
                Map.entry("Cycle", "metrics.MetricsDtos$Cycle"),
                Map.entry("Cycles", "metrics.MetricsDtos$Cycles"),
                Map.entry("Summary", "metrics.MetricsDtos$Summary"));
        for (var entry : types.entrySet()) {
            Set<String> documented = new LinkedHashSet<>();
            spec.path("components").path("schemas").path(entry.getKey()).path("properties")
                    .properties().forEach(property -> documented.add(property.getKey()));
            var actual = Arrays.stream(Class.forName("com.fuellog." + entry.getValue()).getRecordComponents())
                    .map(java.lang.reflect.RecordComponent::getName).toList();
            assertThat(documented).as(entry.getKey()).containsExactlyInAnyOrderElementsOf(actual);
        }
    }

    @Test
    void fuelEntryUpdateRequiresStrongVersionAndKeepsDecimalPrecision() throws Exception {
        var spec = new ObjectMapper().readTree(Files.readString(Path.of("..", "contracts", "openapi.json")));
        var put = spec.path("paths").path("/vehicles/{vehicleId}/fuel-entries/{entryId}").path("put");
        var header = put.path("parameters").get(0);
        assertThat(header.path("name").asString()).isEqualTo("If-Match");
        assertThat(header.path("required").asBoolean()).isTrue();
        assertThat(put.path("responses").has("428")).isTrue();
        assertThat(put.path("responses").has("412")).isTrue();
        assertThat(put.path("responses").path("200").path("headers").has("ETag")).isTrue();
        var update = spec.path("components").path("schemas").path("UpdateFuelEntry");
        var create = spec.path("components").path("schemas").path("CreateFuelEntry");
        assertThat(update.path("properties").has("id")).isFalse();
        for (String field : Set.of("liters", "unitPrice", "paidTotal"))
            assertThat(update.path("properties").path(field)).isEqualTo(create.path("properties").path(field));
        assertThat(update.path("required").valueStream().map(v -> v.asString()).toList())
                .doesNotContain("id", "latitude", "longitude");
    }
}
