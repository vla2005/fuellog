package com.fuellog.platform.exceptions;

import java.util.Map;
import java.util.UUID;

public class ApiException extends RuntimeException {
    private final String correlationId = UUID.randomUUID().toString();
    private final int status;
    private final String code;
    private final Map<String, String> fieldErrors;

    public ApiException(int status, String code, String message) {
        this(status, code, message, Map.of());
    }

    public ApiException(int status, String code, String message, Map<String, String> fieldErrors) {
        super(message);
        this.status = status;
        this.code = code;
        this.fieldErrors = Map.copyOf(fieldErrors);
    }

    public String correlationId() { return correlationId; }
    public int status() { return status; }
    public String code() { return code; }
    public Map<String, String> fieldErrors() { return fieldErrors; }
}
