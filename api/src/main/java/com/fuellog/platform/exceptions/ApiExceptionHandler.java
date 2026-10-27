package com.fuellog.platform.exceptions;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@Order(-1)
@RestControllerAdvice
public class ApiExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    ResponseEntity<ProblemDetail> domain(ApiException error) {
        return problem(error.status(), error.code(), error.getMessage(), error.fieldErrors());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ProblemDetail> validation(MethodArgumentNotValidException error) {
        Map<String, String> fields = new LinkedHashMap<>();
        error.getBindingResult().getFieldErrors().forEach(field ->
                fields.putIfAbsent(field.getField(), field.getDefaultMessage()));
        return problem(422, "VALIDATION_FAILED", "Confira os campos informados.", fields);
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class})
    ResponseEntity<ProblemDetail> malformed(Exception error) {
        return problem(400, "INVALID_REQUEST", "Formato de requisição inválido.", Map.of());
    }

    @ExceptionHandler(DataAccessException.class)
    ResponseEntity<ProblemDetail> unavailable(DataAccessException error) {
        return problem(503, "DEPENDENCY_UNAVAILABLE", "Serviço temporariamente indisponível.", Map.of());
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ProblemDetail> unexpected(Exception error) {
        if (error instanceof org.springframework.web.ErrorResponse frameworkError) {
            int status = frameworkError.getStatusCode().value();
            return problem(status, status == 404 ? "RESOURCE_NOT_FOUND" : "INVALID_REQUEST",
                    status == 404 ? "Recurso não encontrado." : "Requisição não suportada.", Map.of());
        }
        String correlationId = UUID.randomUUID().toString();
        // Log only the type: exception messages may contain SQL parameters or submitted data.
        log.error("Unhandled request failure correlationId={} type={}", correlationId, error.getClass().getName());
        return problem(500, "INTERNAL_ERROR", "Não foi possível concluir a operação.", Map.of(), correlationId);
    }

    private ResponseEntity<ProblemDetail> problem(int status, String code, String detail, Map<String, String> fields) {
        return problem(status, code, detail, fields, UUID.randomUUID().toString());
    }

    private ResponseEntity<ProblemDetail> problem(int status, String code, String detail,
            Map<String, String> fields, String correlationId) {
        ProblemDetail body = ProblemDetail.forStatusAndDetail(HttpStatus.valueOf(status), detail);
        body.setProperty("code", code);
        body.setProperty("fieldErrors", fields);
        body.setProperty("correlationId", correlationId);
        return ResponseEntity.status(status).body(body);
    }
}
