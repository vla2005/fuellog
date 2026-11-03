package com.fuellog.identity.controllers;

import com.fuellog.identity.dtos.IdentityDtos;
import com.fuellog.identity.services.CurrentUserService;
import com.fuellog.identity.services.IdentityService;
import com.fuellog.identity.services.RegistrationService;

import jakarta.validation.Valid;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1")
public class IdentityController {
    private final IdentityService identity;
    private final CurrentUserService currentUser;
    private final RegistrationService registration;
    IdentityController(IdentityService identity, CurrentUserService currentUser, RegistrationService registration) {
        this.identity = identity; this.currentUser = currentUser; this.registration = registration;
    }
    @PostMapping("/auth/registration-code")
    ResponseEntity<IdentityDtos.RegistrationCodeSent> registrationCode(@Valid @RequestBody IdentityDtos.RegistrationCodeRequest request, HttpServletRequest http) {
        return ResponseEntity.accepted().cacheControl(CacheControl.noStore()).body(registration.requestCode(request.email(), http.getRemoteAddr()));
    }
    @PostMapping("/auth/register")
    ResponseEntity<IdentityDtos.RegisteredUser> register(@Valid @RequestBody IdentityDtos.Register request) {
        return ResponseEntity.status(201).cacheControl(CacheControl.noStore()).body(registration.register(
                request.name(), request.email(), request.password(), request.verificationId(), request.code()));
    }
    @PostMapping("/auth/login")
    ResponseEntity<IdentityDtos.LoginResult> login(@Valid @RequestBody IdentityDtos.Login request, HttpServletRequest http) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(identity.login(request.email(), request.password(), http.getRemoteAddr()));
    }
    @PostMapping("/auth/refresh")
    ResponseEntity<IdentityDtos.TokenResponse> refresh(@Valid @RequestBody IdentityDtos.Refresh request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(identity.refresh(request.refresh_token()));
    }
    @PostMapping("/auth/biometric-login")
    ResponseEntity<IdentityDtos.BiometricLoginResponse> biometricLogin(@Valid @RequestBody IdentityDtos.Refresh request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(identity.biometricLogin(request.refresh_token()));
    }
    @PostMapping("/me/biometric-session")
    ResponseEntity<IdentityDtos.BiometricSession> createBiometricSession(@Valid @RequestBody IdentityDtos.Refresh request) {
        return ResponseEntity.status(201).cacheControl(CacheControl.noStore())
                .body(identity.createBiometricSession(currentUser.requireUserId(), currentUser.requireSessionId(), request.refresh_token()));
    }
    @DeleteMapping("/me/biometric-session/{sessionId}")
    ResponseEntity<Void> revokeBiometricSession(@PathVariable UUID sessionId) {
        identity.revokeBiometricSession(currentUser.requireUserId(), sessionId);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
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
