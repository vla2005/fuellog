package com.fuellog.identity;

import java.util.UUID;
import com.fuellog.platform.ApiException;
import org.springframework.core.annotation.Order;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@Order(-1)
@RestControllerAdvice(assignableTypes = IdentityController.class)
class IdentityExceptionHandler {
    @ExceptionHandler({org.springframework.transaction.TransactionException.class, jakarta.persistence.PersistenceException.class})
    ResponseEntity<ProblemDetail> dependency(RuntimeException error) {
        return domain(new ApiException(503, "AUTH_DEPENDENCY_UNAVAILABLE", "Serviço temporariamente indisponível."));
    }
    @ExceptionHandler(ApiException.class)
    ResponseEntity<ProblemDetail> domain(ApiException error) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatusCode.valueOf(error.status()), error.getMessage());
        problem.setProperty("code", error.code()); problem.setProperty("fieldErrors", error.fieldErrors());
        problem.setProperty("correlationId", UUID.randomUUID().toString());
        var response = ResponseEntity.status(error.status()).cacheControl(CacheControl.noStore());
        if (error.status() == 401) response.header(HttpHeaders.WWW_AUTHENTICATE, "Bearer error=\"invalid_token\"");
        return response.body(problem);
    }

    @ExceptionHandler(org.springframework.web.bind.MethodArgumentNotValidException.class)
    ResponseEntity<ProblemDetail> validation(org.springframework.web.bind.MethodArgumentNotValidException error) {
        var fields = new java.util.LinkedHashMap<String, String>();
        error.getBindingResult().getFieldErrors().forEach(field ->
                fields.putIfAbsent(field.getField(), field.getDefaultMessage()));
        return domain(new ApiException(422, "VALIDATION_FAILED", "Confira os campos informados.", fields));
    }
}
