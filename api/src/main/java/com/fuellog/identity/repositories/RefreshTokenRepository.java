package com.fuellog.identity.repositories;

import com.fuellog.identity.models.RefreshToken;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {
    @Query("select t.sessionId from RefreshToken t where t.tokenHash = :hash")
    Optional<UUID> findSessionId(@Param("hash") String hash);
    Optional<RefreshToken> findByTokenHash(String hash);
    @Modifying
    @Query("update RefreshToken t set t.revokedAt = :now where t.sessionId = :sessionId and t.revokedAt is null")
    int revokeFamily(@Param("sessionId") UUID sessionId, @Param("now") Instant now);
    @Modifying(flushAutomatically = true)
    @Query("update RefreshToken t set t.revokedAt = :now where t.revokedAt is null and t.sessionId in "
            + "(select s.id from UserSession s where s.userId = :userId "
            + "and (:exceptSessionId is null or s.id <> :exceptSessionId))")
    int revokeUserFamilies(@Param("userId") UUID userId, @Param("exceptSessionId") UUID exceptSessionId,
            @Param("now") Instant now);
}
