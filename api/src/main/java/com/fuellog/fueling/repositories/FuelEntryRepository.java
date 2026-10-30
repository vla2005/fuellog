package com.fuellog.fueling.repositories;

import com.fuellog.fueling.models.FuelEntry;

import org.springframework.data.jpa.repository.*;
import java.time.Instant;
import java.util.*;

public interface FuelEntryRepository extends JpaRepository<FuelEntry,UUID>, JpaSpecificationExecutor<FuelEntry> {
    @Query(value="select exists(select 1 from fuel_entries where id=:id and deleted_at is not null)",nativeQuery=true)
    boolean wasDeleted(UUID id);
    // Native history intentionally includes tombstones; public JPA queries always exclude them.
    @Query(value="select * from fuel_entries where vehicle_id=:vehicleId order by occurred_at, case when deleted_at is not null then 0 else 1 end, id",nativeQuery=true)
    List<FuelEntry> historyIncludingDeleted(UUID vehicleId);
    List<FuelEntry> findByVehicleIdOrderByOccurredAtAscIdAsc(UUID vehicleId);
    Optional<FuelEntry> findByIdAndVehicleId(UUID id, UUID vehicleId);
    Optional<FuelEntry> findFirstByVehicleIdAndOccurredAtLessThanOrderByOccurredAtDescIdDesc(UUID vehicleId, Instant at);
    Optional<FuelEntry> findFirstByVehicleIdAndOccurredAtGreaterThanOrderByOccurredAtAscIdAsc(UUID vehicleId, Instant at);
    List<FuelEntry> findByVehicleIdAndOccurredAt(UUID vehicleId, Instant at);
    Optional<FuelEntry> findFirstByVehicleIdAndIdNotAndOccurredAtLessThanOrderByOccurredAtDescIdDesc(UUID vehicleId, UUID excludedId, Instant at);
    Optional<FuelEntry> findFirstByVehicleIdAndIdNotAndOccurredAtGreaterThanOrderByOccurredAtAscIdAsc(UUID vehicleId, UUID excludedId, Instant at);
    List<FuelEntry> findByVehicleIdAndIdNotAndOccurredAt(UUID vehicleId, UUID excludedId, Instant at);
}
