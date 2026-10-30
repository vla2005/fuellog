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
    @Test void profileUpdateDocumentsAuthenticatedContractAndConditionalCredentials() throws Exception {
        var spec = new ObjectMapper().readTree(Files.readString(Path.of("..", "contracts", "openapi.json")));
        var operation = spec.path("paths").path("/me").path("patch");
        assertThat(spec.path("security").get(0).has("bearerAuth")).isTrue();
        assertThat(operation.has("security")).isFalse();
        assertThat(operation.path("requestBody").path("required").asBoolean()).isTrue();
        assertThat(operation.path("requestBody").path("content").path("application/json").path("schema").path("$ref").asString())
                .isEqualTo("#/components/schemas/UpdateProfile");
        var schema = spec.path("components").path("schemas").path("UpdateProfile");
        assertThat(schema.path("required").valueStream().map(value -> value.asString()).toList()).containsExactly("name", "email");
        assertThat(schema.path("properties").propertyNames()).containsExactlyInAnyOrderElementsOf(
                Arrays.stream(Class.forName("com.fuellog.identity.dtos.ProfileDtos$UpdateProfile").getRecordComponents())
                        .map(java.lang.reflect.RecordComponent::getName).toList());
        assertThat(schema.path("properties").path("name").path("maxLength").asInt()).isEqualTo(100);
        assertThat(schema.path("properties").path("email").path("maxLength").asInt()).isEqualTo(254);
        assertThat(schema.path("properties").path("currentPassword").path("writeOnly").asBoolean()).isTrue();
        assertThat(schema.path("properties").path("secondFactorCode").path("writeOnly").asBoolean()).isTrue();
        var responses = operation.path("responses");
        assertThat(responses.path("200").path("content").path("application/json").path("schema").path("$ref").asString())
                .isEqualTo("#/components/schemas/Me");
        assertThat(responses.path("200").path("headers").path("Cache-Control").path("description").asString()).isEqualTo("no-store");
        for (String status : Set.of("401", "409", "422", "429")) assertThat(responses.has(status)).isTrue();
    }

    @Test
    void registrationPasswordBoundsMatchTheHttpValidation() throws Exception {
        var spec = new ObjectMapper().readTree(Files.readString(Path.of("..", "contracts", "openapi.json")));
        var password = spec.path("components").path("schemas").path("Register").path("properties").path("password");
        var component = Arrays.stream(Class.forName("com.fuellog.identity.dtos.IdentityDtos$Register").getRecordComponents())
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
                Map.entry("Register", "identity.dtos.IdentityDtos$Register"),
                Map.entry("Login", "identity.dtos.IdentityDtos$Login"),
                Map.entry("Refresh", "identity.dtos.IdentityDtos$Refresh"),
                Map.entry("RegisteredUser", "identity.dtos.IdentityDtos$RegisteredUser"),
                Map.entry("TokenResponse", "identity.dtos.IdentityDtos$TokenResponse"),
                Map.entry("Me", "identity.dtos.IdentityDtos$Me"),
                Map.entry("PasswordChange", "identity.dtos.PasswordChangeDtos$ChangePassword"),
                Map.entry("TwoFactorStatus", "identity.dtos.TwoFactorDtos$Status"),
                Map.entry("TwoFactorSetup", "identity.dtos.TwoFactorDtos$Setup"),
                Map.entry("TwoFactorSetupResponse", "identity.dtos.TwoFactorDtos$SetupResponse"),
                Map.entry("TwoFactorEnable", "identity.dtos.TwoFactorDtos$Enable"),
                Map.entry("TwoFactorRecoveryCodes", "identity.dtos.TwoFactorDtos$RecoveryCodes"),
                Map.entry("TwoFactorDisable", "identity.dtos.TwoFactorDtos$Disable"),
                Map.entry("TwoFactorChallenge", "identity.dtos.TwoFactorDtos$Challenge"),
                Map.entry("TwoFactorVerify", "identity.dtos.TwoFactorDtos$Verify"),
                Map.entry("CreateVehicle", "vehicles.dtos.VehicleDtos$Create"),
                Map.entry("Vehicle", "vehicles.dtos.VehicleDtos$View"),
                Map.entry("CreateFuelEntry", "fueling.dtos.FuelEntryDtos$Create"),
                Map.entry("UpdateFuelEntry", "fueling.dtos.FuelEntryDtos$Update"),
                Map.entry("FuelEntry", "fueling.dtos.FuelEntryDtos$View"),
                Map.entry("FuelEntryPage", "fueling.dtos.FuelEntryDtos$Page"),
                Map.entry("Cycle", "metrics.dtos.MetricsDtos$Cycle"),
                Map.entry("Cycles", "metrics.dtos.MetricsDtos$Cycles"),
                Map.entry("Summary", "metrics.dtos.MetricsDtos$Summary"));
        for (var entry : types.entrySet()) {
            Set<String> documented = new LinkedHashSet<>();
            spec.path("components").path("schemas").path(entry.getKey()).path("properties")
                    .properties().forEach(property -> documented.add(property.getKey()));
            var actual = Arrays.stream(Class.forName("com.fuellog." + entry.getValue()).getRecordComponents())
                    .map(java.lang.reflect.RecordComponent::getName).toList();
            assertThat(documented).as(entry.getKey()).containsExactlyInAnyOrderElementsOf(actual);
        }
    }

    @Test void loginResultIsExplicitAndSecurityMutationsDocumentNoStore() throws Exception {
        var spec = new ObjectMapper().readTree(Files.readString(Path.of("..", "contracts", "openapi.json")));
        var login = spec.path("components").path("schemas").path("LoginResult").path("oneOf");
        assertThat(login.valueStream().map(value -> value.path("$ref").asString()).toList())
                .containsExactly("#/components/schemas/TokenResponse", "#/components/schemas/TwoFactorChallenge");
        for (String path : Set.of("/me/password", "/me/2fa/setup", "/me/2fa/enable", "/me/2fa/disable", "/auth/2fa/verify")) {
            var operation = spec.path("paths").path(path).path("post");
            var responses = operation.path("responses");
            assertThat(responses.path(path.endsWith("password") || path.endsWith("disable") ? "204" : "200")
                    .path("headers").path("Cache-Control").path("description").asString()).isEqualTo("no-store");
            assertThat(responses.has("429")).isTrue();
        }
        assertThat(spec.path("paths").path("/auth/2fa/verify").path("post").path("security").isEmpty()).isTrue();
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
