package com.fuellog.identity.controllers;

import com.fuellog.identity.dtos.IdentityDtos.Me;
import com.fuellog.identity.dtos.ProfileDtos.UpdateProfile;
import com.fuellog.identity.services.CurrentUserService;
import com.fuellog.identity.services.ProfileService;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/me")
public class ProfileController {
    private final ProfileService profiles;
    private final CurrentUserService currentUser;

    ProfileController(ProfileService profiles, CurrentUserService currentUser) {
        this.profiles = profiles; this.currentUser = currentUser;
    }

    @PatchMapping
    ResponseEntity<Me> update(@RequestBody UpdateProfile request) {
        var result = profiles.update(currentUser.requireUserId(), currentUser.requireSessionId(), request);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(result);
    }
}
