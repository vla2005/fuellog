package com.fuellog.vehicles.services;

import com.fuellog.vehicles.dtos.VehicleDtos;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class VehicleEditingContractTest {
    @Test void updateContractMatchesDtoPreconditionsAndResponse() throws Exception {
        var spec=new ObjectMapper().readTree(Files.readString(Path.of("..","contracts","openapi.json")));
        var schema=spec.path("components").path("schemas").path("UpdateVehicle");
        assertThat(schema.path("properties").propertyNames()).containsExactlyInAnyOrderElementsOf(
                Arrays.stream(VehicleDtos.Update.class.getRecordComponents()).map(java.lang.reflect.RecordComponent::getName).toList());
        assertThat(schema.path("required").valueStream().map(n->n.asString()).toList()).containsExactlyInAnyOrder("model","allowedFuels");
        assertThat(schema.path("properties").path("model").path("maxLength").asInt()).isEqualTo(60);
        String decimalPattern=schema.path("properties").path("tankCapacityLiters").path("anyOf").get(0).path("pattern").asString();
        assertThat("50.123".matches(decimalPattern)).isTrue();
        assertThat("50,123".matches(decimalPattern)).isFalse();
        assertThat(schema.path("properties").path("currentOdometerKm").path("anyOf").get(0).path("maximum").asLong()).isEqualTo(9007199254740991L);
        var operation=spec.path("paths").path("/vehicles/{vehicleId}").path("put");
        var header=operation.path("parameters").get(0);
        assertThat(header.path("name").asString()).isEqualTo("If-Match");
        assertThat(header.path("in").asString()).isEqualTo("header");
        assertThat(header.path("required").asBoolean()).isTrue();
        assertThat(VehicleService.expectedVersion(header.path("example").asString())).isZero();
        assertThat(operation.path("requestBody").path("content").path("application/json").path("schema").path("$ref").asString())
                .isEqualTo("#/components/schemas/UpdateVehicle");
        var responses=operation.path("responses");
        assertThat(responses.propertyNames()).containsAll(List.of("200","400","401","404","412","422","428","503"));
        assertThat(responses.path("200").path("content").path("application/json").path("schema").path("$ref").asString())
                .isEqualTo("#/components/schemas/Vehicle");
        assertThat(responses.path("200").path("headers").has("ETag")).isTrue();
        for (var expected : java.util.Map.of("400","INVALID_IF_MATCH","412","PRECONDITION_FAILED","422","VALIDATION_ERROR","428","PRECONDITION_REQUIRED").entrySet())
            assertThat(responses.path(expected.getKey()).path("content").path("application/problem+json").path("example").path("code").asString())
                    .isEqualTo(expected.getValue());
    }
}
