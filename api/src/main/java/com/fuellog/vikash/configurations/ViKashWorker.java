package com.fuellog.vikash.configurations;

import com.fuellog.vikash.services.ViKashService;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.*;

@Configuration
@EnableScheduling
@ConditionalOnProperty(name="fuellog.vikash.worker-enabled",havingValue="true",matchIfMissing=true)
public class ViKashWorker {
    private final ViKashService service;
    public ViKashWorker(ViKashService service) { this.service=service; }
    @Scheduled(fixedDelayString="${fuellog.vikash.worker-delay-ms:30000}")
    public void tick() { for (var id:service.due()) service.process(id); }
}
