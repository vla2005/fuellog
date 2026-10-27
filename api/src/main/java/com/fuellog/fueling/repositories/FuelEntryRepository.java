package com.fuellog.fueling.repositories;

import com.fuellog.fueling.models.FuelEntry;

import org.springframework.data.jpa.repository.*;
import java.time.Instant;
import java.util.*;

public interface FuelEntryRepository extends JpaRepository<FuelEntry,UUID>, JpaSpecificationExecutor<FuelEntry> {
    List<FuelEntry> findByVehicleIdOrderByOccurredAtAscIdAsc(UUID vehicleId);
    Optional<FuelEntry> findByIdAndVehicleId(UUID id, UUID vehicleId);
    Optional<FuelEntry> findFirstByVehicleIdAndOccurredAtLessThanOrderByOccurredAtDescIdDesc(UUID vehicleId, Instant at);
    Optional<FuelEntry> findFirstByVehicleIdAndOccurredAtGreaterThanOrderByOccurredAtAscIdAsc(UUID vehicleId, Instant at);
    List<FuelEntry> findByVehicleIdAndOccurredAt(UUID vehicleId, Instant at);
    Optional<FuelEntry> findFirstByVehicleIdAndIdNotAndOccurredAtLessThanOrderByOccurredAtDescIdDesc(UUID vehicleId, UUID excludedId, Instant at);
    Optional<FuelEntry> findFirstByVehicleIdAndIdNotAndOccurredAtGreaterThanOrderByOccurredAtAscIdAsc(UUID vehicleId, UUID excludedId, Instant at);
    List<FuelEntry> findByVehicleIdAndIdNotAndOccurredAt(UUID vehicleId, UUID excludedId, Instant at);
}
