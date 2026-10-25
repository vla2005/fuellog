package com.fuellog.vehicles;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;
import java.util.*;

public interface VehicleRepository extends JpaRepository<Vehicle, UUID> {
    List<Vehicle> findByUserIdOrderByCreatedAtAscIdAsc(UUID userId);
    Optional<Vehicle> findByIdAndUserId(UUID id, UUID userId);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select v from Vehicle v where v.id = :id and v.userId = :userId")
    Optional<Vehicle> lockOwned(@Param("id") UUID id, @Param("userId") UUID userId);
}
