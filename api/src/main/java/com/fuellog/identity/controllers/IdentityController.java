package com.fuellog.identity.controllers;

import com.fuellog.identity.dtos.IdentityDtos;
import com.fuellog.identity.services.CurrentUserService;
import com.fuellog.identity.services.IdentityService;

import jakarta.validation.Valid;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
public class IdentityController {
    private final IdentityService identity;
    private final CurrentUserService currentUser;
    IdentityController(IdentityService identity, CurrentUserService currentUser) { this.identity = identity; this.currentUser = currentUser; }
    @PostMapping("/auth/register")
    ResponseEntity<IdentityDtos.RegisteredUser> register(@Valid @RequestBody IdentityDtos.Register request) {
        return ResponseEntity.status(201).cacheControl(CacheControl.noStore()).body(identity.register(request.name(), request.email(), request.password()));
    }
    @PostMapping("/auth/login")
    ResponseEntity<IdentityDtos.LoginResult> login(@Valid @RequestBody IdentityDtos.Login request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(identity.login(request.email(), request.password()));
    }
    @PostMapping("/auth/refresh")
    ResponseEntity<IdentityDtos.TokenResponse> refresh(@Valid @RequestBody IdentityDtos.Refresh request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(identity.refresh(request.refresh_token()));
    }
    @PostMapping("/auth/logout")
    ResponseEntity<Void> logout() {
        identity.logout(currentUser.requireSessionId());
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }
    @GetMapping("/me")
    ResponseEntity<IdentityDtos.Me> me() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(identity.me(currentUser.requireUserId()));
    }
}
