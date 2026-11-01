package com.fuellog.vikash;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import com.fuellog.vikash.services.ViKashService;

public final class ViKashTestSupport {
    private ViKashTestSupport() {}
    public static ViKashService disconnected() {
        var service=mock(ViKashService.class);
        when(service.decorate(any())).thenAnswer(invocation -> invocation.getArgument(0));
        return service;
    }
}
