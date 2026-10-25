package com.fuellog.identity;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
class IdentityController {
    private final IdentityService identity;
    private final CurrentUserService currentUser;
    IdentityController(IdentityService identity, CurrentUserService currentUser) { this.identity = identity; this.currentUser = currentUser; }
    @PostMapping("/auth/register")
    ResponseEntity<IdentityService.RegisteredUser> register(@Valid @RequestBody Register request) {
        return ResponseEntity.status(201).cacheControl(CacheControl.noStore()).body(identity.register(request.name, request.email, request.password));
    }
    @PostMapping("/auth/login")
    ResponseEntity<IdentityService.TokenResponse> login(@Valid @RequestBody Login request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(identity.login(request.email, request.password));
    }
    @PostMapping("/auth/refresh")
    ResponseEntity<IdentityService.TokenResponse> refresh(@Valid @RequestBody Refresh request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(identity.refresh(request.refresh_token));
    }
    @PostMapping("/auth/logout")
    ResponseEntity<Void> logout() {
        identity.logout(currentUser.requireSessionId());
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }
    @GetMapping("/me")
    ResponseEntity<IdentityService.Me> me() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(identity.me(currentUser.requireUserId()));
    }
    record Register(@NotBlank @Size(max=100) String name, @NotBlank @Email @Size(max=254) String email,
                    @NotBlank @Size(min=12, max=128) String password) {}
    record Login(@NotBlank @Email @Size(max=254) String email, @NotBlank @Size(max=128) String password) {}
    record Refresh(@NotBlank @Pattern(regexp="[A-Za-z0-9_-]{43}") String refresh_token) {}
}
