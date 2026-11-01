package com.fuellog.vikash.dtos;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class ViKashDtos {
    private ViKashDtos() {}
    public record Choices(String categoryId, String paymentMethod, String accountId, String cardId, Integer installments) {}
    public record Selection(boolean send, UUID connectionId, Choices choices) {}
    public record Preferences(boolean automaticSend, Choices choices) {}
    public record Status(String status, boolean configured, UUID connectionId, Preferences preferences) {}
    public record Start(String platform) {}
    public record Authorization(String authorizationUrl, String returnUrl) {}
    public record Category(String id, String name, String kind) {}
    public record Account(String uuid, String description, String type) {}
    public record Card(String uuid, String description) {}
    public record Installments(int min, int max, boolean creditOnly) {}
    public record Catalog(String apiVersion, List<Category> categories, List<Account> accounts, List<Card> cards,
        List<String> paymentMethods, Installments installments, String currency) {}
    public record EntryStatus(String status, boolean send, UUID connectionId, Choices choices, String code, Instant updatedAt) {}
    public record Retry(String resolution, String remoteEtag) {}
    public record RemoteStatus(String status, long version, boolean manuallyModified, String etag) {}
    public record Disconnect(boolean remoteRevoked) {}
    public record Deletion(UUID entryId, Instant occurredAt, String paidTotal, String status, String code) {}
    public record Deletions(List<Deletion> items, int page, long totalElements) {}
}
