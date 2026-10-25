package com.fuellog.fueling;

import org.springframework.data.jpa.repository.*;
import java.time.Instant;
import java.util.*;

interface FuelEntryRepository extends JpaRepository<FuelEntry,UUID>, JpaSpecificationExecutor<FuelEntry> {
    List<FuelEntry> findByVehicleIdOrderByOccurredAtAscIdAsc(UUID vehicleId);
    Optional<FuelEntry> findByIdAndVehicleId(UUID id, UUID vehicleId);
    Optional<FuelEntry> findFirstByVehicleIdAndOccurredAtLessThanOrderByOccurredAtDescIdDesc(UUID vehicleId, Instant at);
    Optional<FuelEntry> findFirstByVehicleIdAndOccurredAtGreaterThanOrderByOccurredAtAscIdAsc(UUID vehicleId, Instant at);
    List<FuelEntry> findByVehicleIdAndOccurredAt(UUID vehicleId, Instant at);
}
