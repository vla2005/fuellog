package com.fuellog.identity.repositories;

import com.fuellog.identity.models.UserSession;

import java.util.Optional;
import java.util.List;
import java.util.UUID;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;

public interface UserSessionRepository extends JpaRepository<UserSession, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from UserSession s where s.id = :id")
    Optional<UserSession> lockById(@Param("id") UUID id);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from UserSession s where s.userId = :userId and s.revokedAt is null "
            + "and (:exceptSessionId is null or s.id <> :exceptSessionId) order by s.id")
    List<UserSession> lockForRevocation(@Param("userId") UUID userId, @Param("exceptSessionId") UUID exceptSessionId);
}
