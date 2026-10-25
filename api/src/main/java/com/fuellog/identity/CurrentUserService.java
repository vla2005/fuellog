package com.fuellog.identity;

import java.util.UUID;
import com.fuellog.platform.ApiException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Service;

@Service
public class CurrentUserService {
    public UUID requireUserId() { return UUID.fromString(requireAuthentication().getToken().getSubject()); }
    public UUID requireSessionId() { return UUID.fromString(requireAuthentication().getToken().getClaimAsString("sid")); }
    private JwtAuthenticationToken requireAuthentication() {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (!(authentication instanceof JwtAuthenticationToken jwt) || !jwt.isAuthenticated())
            throw new ApiException(401, "ACCESS_TOKEN_MISSING", "Autenticação necessária.");
        return jwt;
    }
}
