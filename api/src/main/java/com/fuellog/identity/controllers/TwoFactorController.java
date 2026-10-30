package com.fuellog.identity.controllers;

import com.fuellog.identity.dtos.IdentityDtos;
import com.fuellog.identity.dtos.TwoFactorDtos;
import com.fuellog.identity.services.*;
import jakarta.validation.Valid;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
public class TwoFactorController {
    private final TwoFactorService factors;
    private final IdentityService identity;
    private final CurrentUserService current;
    public TwoFactorController(TwoFactorService factors, IdentityService identity, CurrentUserService current) {
        this.factors = factors; this.identity = identity; this.current = current;
    }
    @GetMapping("/me/2fa")
    ResponseEntity<TwoFactorDtos.Status> status() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(factors.status(current.requireUserId()));
    }
    @PostMapping("/me/2fa/setup")
    ResponseEntity<TwoFactorDtos.SetupResponse> setup(@Valid @RequestBody TwoFactorDtos.Setup request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(factors.setup(current.requireUserId(), current.requireSessionId(), request.currentPassword()));
    }
    @PostMapping("/me/2fa/enable")
    ResponseEntity<TwoFactorDtos.RecoveryCodes> enable(@Valid @RequestBody TwoFactorDtos.Enable request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(factors.enable(current.requireUserId(), current.requireSessionId(), request.code()));
    }
    @PostMapping("/me/2fa/disable")
    ResponseEntity<Void> disable(@Valid @RequestBody TwoFactorDtos.Disable request) {
        factors.disable(current.requireUserId(), current.requireSessionId(), request.currentPassword(), request.code());
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }
    @PostMapping("/auth/2fa/verify")
    ResponseEntity<IdentityDtos.TokenResponse> verify(@Valid @RequestBody TwoFactorDtos.Verify request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(identity.verifyTwoFactor(request.challengeToken(), request.code()));
    }

    @ExceptionHandler({com.fuellog.platform.exceptions.ApiException.class, org.springframework.web.bind.MethodArgumentNotValidException.class})
    ResponseEntity<ProblemDetail> problem(Exception error) {
        int status; String code, message; java.util.Map<String, String> fields;
        if (error instanceof com.fuellog.platform.exceptions.ApiException domain) {
            status = domain.status(); code = domain.code(); message = domain.getMessage(); fields = domain.fieldErrors();
        } else {
            status = 422; code = "VALIDATION_FAILED"; message = "Confira os campos informados.";
            fields = new java.util.LinkedHashMap<>();
            ((org.springframework.web.bind.MethodArgumentNotValidException) error).getBindingResult().getFieldErrors()
                    .forEach(field -> fields.putIfAbsent(field.getField(), field.getDefaultMessage()));
        }
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatusCode.valueOf(status), message);
        problem.setProperty("code", code); problem.setProperty("fieldErrors", fields);
        problem.setProperty("correlationId", java.util.UUID.randomUUID().toString());
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(problem);
    }
}
