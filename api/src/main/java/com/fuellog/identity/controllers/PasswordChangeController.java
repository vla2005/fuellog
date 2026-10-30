package com.fuellog.identity.controllers;

import com.fuellog.identity.dtos.PasswordChangeDtos.ChangePassword;
import com.fuellog.identity.services.CurrentUserService;
import com.fuellog.identity.services.PasswordChangeService;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/me/password")
public class PasswordChangeController {
    private final PasswordChangeService passwords;
    private final CurrentUserService currentUser;

    PasswordChangeController(PasswordChangeService passwords, CurrentUserService currentUser) {
        this.passwords = passwords; this.currentUser = currentUser;
    }

    @PostMapping
    ResponseEntity<Void> changePassword(@RequestBody ChangePassword request) {
        passwords.changePassword(currentUser.requireUserId(), currentUser.requireSessionId(),
                request.currentPassword(), request.newPassword(), request.secondFactorCode());
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }
}
