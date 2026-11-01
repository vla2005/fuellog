package com.fuellog.vikash.models;

import java.time.Instant;
import java.util.UUID;

public final class ViKashRecords {
    private ViKashRecords() {}
    public record Connection(UUID id, UUID userId, String status, String accessCipher, String refreshCipher,
        Instant accessExpiresAt, boolean automaticSend, String choicesJson, String catalogJson, boolean remoteRevoked) {
        @Override public String toString() { return "Connection[redacted]"; }
    }
    public record Attempt(UUID id, UUID userId, UUID sessionId, String verifierCipher, String platform, Instant expiresAt) {
        @Override public String toString() { return "Attempt[redacted]"; }
    }
    public record Sync(UUID entryId, UUID connectionId, long sourceVersion, boolean send, String choicesJson,
        String payloadJson, String remoteEtag, Long remoteVersion, String operation, String status, String errorCode,
        int attempts, Instant updatedAt) {}
}
