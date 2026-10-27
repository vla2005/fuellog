package com.fuellog.identity.security;

import java.io.IOException;
import java.util.UUID;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.oauth2.jwt.JwtValidationException;

public final class SecurityProblems {
    private SecurityProblems() {}
    public static void authentication(HttpServletResponse response, Throwable error) throws IOException {
        int status = 401;
        String code = error instanceof org.springframework.security.authentication.InsufficientAuthenticationException
                ? "ACCESS_TOKEN_MISSING" : "ACCESS_TOKEN_INVALID";
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause instanceof SessionCheckingJwtDecoder.SecurityDependencyException) { status = 503; code = "AUTH_DEPENDENCY_UNAVAILABLE"; break; }
            if (cause instanceof SessionCheckingJwtDecoder.AccessFailure failure) code = failure.code;
            if (cause instanceof JwtValidationException validation && validation.getErrors().stream()
                    .anyMatch(e -> "ACCESS_TOKEN_EXPIRED".equals(e.getErrorCode()))) code = "ACCESS_TOKEN_EXPIRED";
        }
        write(response, status, code);
    }
    public static void write(HttpServletResponse response, int status, String code) throws IOException {
        response.setStatus(status);
        response.setContentType("application/problem+json");
        response.setCharacterEncoding("UTF-8");
        response.setHeader("Cache-Control", "no-store");
        if (status == 401) response.setHeader("WWW-Authenticate", "ACCESS_TOKEN_MISSING".equals(code) ? "Bearer" : "Bearer error=\"invalid_token\"");
        String title = status == 503 ? "Service Unavailable" : status == 403 ? "Forbidden" : "Unauthorized";
        response.getWriter().write("{\"type\":\"about:blank\",\"title\":\"" + title + "\",\"status\":" + status
                + ",\"detail\":\"" + title + "\",\"code\":\"" + code
                + "\",\"fieldErrors\":{},\"correlationId\":\"" + UUID.randomUUID() + "\"}");
    }
}
