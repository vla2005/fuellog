package com.fuellog.vikash.services;

import com.fuellog.fueling.dtos.FuelEntryDtos;
import com.fuellog.identity.repositories.UserAccountRepository;
import com.fuellog.identity.services.CurrentUserService;
import com.fuellog.platform.exceptions.ApiException;
import com.fuellog.vikash.configurations.ViKashProperties;
import com.fuellog.vikash.dtos.ViKashDtos.*;
import com.fuellog.vikash.exceptions.ViKashRemoteException;
import com.fuellog.vikash.models.ViKashRecords.*;
import com.fuellog.vikash.repositories.ViKashRepository;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.*;
import java.util.*;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

@Service
public class ViKashService {
    private static final Logger log=LoggerFactory.getLogger(ViKashService.class);
    private final ViKashRepository store;
    private final UserAccountRepository users;
    private final CurrentUserService current;
    private final ViKashEncryption crypto;
    private final ViKashProperties config;
    private final ViKashClient client;
    private final ObjectMapper json;
    private final Clock clock;
    private final TransactionTemplate transactions;
    private final SecureRandom random=new SecureRandom();
    public ViKashService(ViKashRepository store,UserAccountRepository users,CurrentUserService current,ViKashEncryption crypto,
        ViKashProperties config,ViKashClient client,ObjectMapper json,Clock clock,PlatformTransactionManager manager) {
        this.store=store; this.users=users; this.current=current; this.crypto=crypto; this.config=config; this.client=client; this.json=json; this.clock=clock;
        this.transactions=new TransactionTemplate(manager);
        if (config.enabled && !crypto.configured()) throw new IllegalStateException("Configure the dedicated ViKash encryption key before enabling integration");
    }
    public boolean configured() { return config.enabled && crypto.configured(); }
    private void requireConfigured() { if (!configured()) throw new ApiException(503,"VIKASH_NOT_CONFIGURED","A conexão com o ViKash ainda não está disponível."); }
    private void lock(UUID userId) { users.lockById(userId).orElseThrow(() -> new ApiException(401,"ACCESS_TOKEN_INVALID","Sessão inválida.")); }
    private Connection connected(UUID userId) {
        Connection c=store.current(userId).orElseThrow(() -> new ApiException(409,"VIKASH_DISCONNECTED","Conecte sua conta ViKash em Ajustes."));
        if (!"CONNECTED".equals(c.status())) throw new ApiException(409,"VIKASH_LINK_EXPIRED","Conecte novamente sua conta ViKash.");
        return c;
    }
    public Status status() {
        UUID userId=current.requireUserId();
        if (!configured()) return new Status("NOT_CONFIGURED",false,null,null);
        var connection=store.current(userId);
        if (connection.isPresent()) {
            Connection c=connection.get();
            return new Status(c.status(),true,c.id(),new Preferences(c.automaticSend(),read(c.choicesJson(),Choices.class)));
        }
        return new Status(store.pending(userId,clock.instant()) ? "CONNECTING" : "DISCONNECTED",true,null,null);
    }
    public Authorization start(Start input) {
        requireConfigured(); UUID userId=current.requireUserId(), sessionId=current.requireSessionId();
        if (input == null || input.platform() == null || !Set.of("web","native").contains(input.platform())) throw new ApiException(422,"VALIDATION_ERROR","Escolha a plataforma de retorno.");
        String returnUrl=returnUrl(input.platform());
        return transactions.execute(tx -> {
            lock(userId);
            if (store.current(userId).filter(c -> "CONNECTED".equals(c.status())).isPresent())
                throw new ApiException(409,"VIKASH_ALREADY_CONNECTED","Desconecte o vínculo atual antes de conectar outra conta.");
            String state=randomSecret(), verifier=randomSecret(); UUID attemptId=UUID.randomUUID();
            store.clearAttempts(userId);
            store.attempt(hash(state),new Attempt(attemptId,userId,sessionId,crypto.encrypt(attemptId,verifier),input.platform(),clock.instant().plusSeconds(180)));
            return new Authorization(client.authorizationUrl(state,challenge(verifier)),returnUrl);
        });
    }
    public String callback(String state,String code,String error) {
        requireConfigured();
        if (state == null || !state.matches("[A-Za-z0-9_-]{43}")) throw invalidState(CallbackRejection.MALFORMED_STATE);
        // Consumption commits even if token exchange fails; authorization codes and states must never be replayed.
        Attempt attempt=transactions.execute(tx -> store.consume(hash(state)).orElseThrow(() -> invalidState(CallbackRejection.ATTEMPT_MISSING_OR_CONSUMED)));
        if (!attempt.expiresAt().isAfter(clock.instant())) throw invalidState(CallbackRejection.ATTEMPT_EXPIRED);
        if (!store.sessionValid(attempt.userId(),attempt.sessionId(),clock.instant())) throw invalidState(CallbackRejection.SESSION_INVALID);
        String returnUrl=returnUrl(attempt.platform());
        if (error != null) return returnUrl;
        if (code == null || code.isBlank() || code.length() > 2048) throw invalidState(CallbackRejection.INVALID_CODE);
        return transactions.execute(tx -> {
            lock(attempt.userId());
            if (!store.authoritative(attempt.id())) throw invalidState(CallbackRejection.ATTEMPT_SUPERSEDED);
            if (!store.sessionValid(attempt.userId(),attempt.sessionId(),clock.instant())) throw invalidState(CallbackRejection.SESSION_INVALID);
            try {
                var tokens=client.exchange(code,crypto.decrypt(attempt.id(),attempt.verifierCipher()));
                store.current(attempt.userId()).ifPresent(c -> store.revoke(c.id()));
                UUID id=UUID.randomUUID();
                store.connect(id,attempt.userId(),crypto.encrypt(id,tokens.accessToken()),crypto.encrypt(id,tokens.refreshToken()),clock.instant().plusSeconds(tokens.expiresIn()));
                store.clearAttempts(attempt.userId());
                return returnUrl;
            } catch (ViKashRemoteException e) { throw unavailable(); }
        });
    }
    public void cancelAuthorization() {
        UUID userId=current.requireUserId(); transactions.executeWithoutResult(tx -> { lock(userId); store.clearAttempts(userId); });
    }
    public Catalog catalog() {
        requireConfigured(); UUID userId=current.requireUserId();
        return remoteTransaction(userId,() -> {
            Connection c=connected(userId); Catalog catalog=client.catalog(access(c)); store.catalog(c.id(),write(catalog)); return catalog;
        });
    }
    public Preferences preferences(Preferences input) {
        requireConfigured(); UUID userId=current.requireUserId();
        return remoteTransaction(userId,() -> {
            Connection c=connected(userId);
            if (input == null) throw new ApiException(422,"VALIDATION_ERROR","Informe as preferências.");
            Catalog catalog=client.catalog(access(c));
            if (input.choices() != null || input.automaticSend()) ViKashRules.validate(input.choices(),catalog,null);
            store.catalog(c.id(),write(catalog)); store.preferences(c.id(),input.automaticSend(),write(input.choices()));
            return input;
        });
    }
    public Disconnect disconnect() {
        UUID userId=current.requireUserId();
        return transactions.execute(tx -> {
            lock(userId); store.clearAttempts(userId);
            var currentLink=store.current(userId); if (currentLink.isEmpty()) return new Disconnect(store.last(userId).map(Connection::remoteRevoked).orElse(true));
            Connection c=currentLink.get(); boolean remoteRevoked=false;
            try { if (c.refreshCipher() != null && configured()) { client.revoke(crypto.decrypt(c.id(),c.refreshCipher())); remoteRevoked=true; } }
            catch (ViKashRemoteException e) { remoteRevoked=false; }
            store.revoke(c.id(),remoteRevoked); return new Disconnect(remoteRevoked);
        });
    }
    private String access(Connection c) {
        if (c.accessExpiresAt() != null && c.accessExpiresAt().isAfter(clock.instant().plusSeconds(30))) return crypto.decrypt(c.id(),c.accessCipher());
        try {
            var tokens=client.refresh(crypto.decrypt(c.id(),c.refreshCipher()));
            store.tokens(c.id(),crypto.encrypt(c.id(),tokens.accessToken()),crypto.encrypt(c.id(),tokens.refreshToken()),clock.instant().plusSeconds(tokens.expiresIn()));
            return tokens.accessToken();
        } catch (ViKashRemoteException e) {
            // An uncertain rotation must not replay the old refresh token.
            store.expire(c.id()); throw new ViKashRemoteException(401,"LINK_EXPIRED");
        }
    }
    private <T> T remoteTransaction(UUID userId,Supplier<T> work) {
        Object result=transactions.execute(tx -> {
            lock(userId);
            try { return work.get(); }
            catch (ViKashRemoteException e) {
                if (e.status() == 401) store.current(userId).ifPresent(c -> store.expire(c.id()));
                return e;
            }
        });
        if (result instanceof ViKashRemoteException e) {
            if (e.status() == 401) throw new ApiException(409,"VIKASH_LINK_EXPIRED","Conecte novamente sua conta ViKash.");
            throw unavailable();
        }
        @SuppressWarnings("unchecked") T value=(T)result; return value;
    }
    public String selectionHash(Selection selection) { return selection == null ? null : hash(write(selection)); }

    // Called only inside the existing FuelEntry transaction. Network I/O belongs to the separate worker.
    public void saveIntent(FuelEntryDtos.View entry,Selection selection,boolean creating,boolean deleting) {
        UUID userId=current.requireUserId(); lock(userId);
        Sync previous=store.sync(entry.id()).orElse(null);
        Connection connection=store.current(userId).orElse(null);
        if (selection == null) {
            if (previous != null) selection=new Selection(previous.send(),previous.connectionId(),read(previous.choicesJson(),Choices.class));
            else if (creating && connection != null && "CONNECTED".equals(connection.status()) && connection.automaticSend()) selection=new Selection(true,connection.id(),read(connection.choicesJson(),Choices.class));
        }
        if (previous == null && (selection == null || deleting || !selection.send() && selection.choices() == null)) return;
        boolean send=!deleting && selection != null && selection.send();
        if (previous == null && !send && (connection == null || !"CONNECTED".equals(connection.status()) || !connection.id().equals(selection.connectionId()))) return;
        if (previous != null && (connection == null || !connection.id().equals(previous.connectionId()) || !"CONNECTED".equals(connection.status()))) {
            if (send && selection != null && !Objects.equals(selection.connectionId(),previous.connectionId()))
                throw new ApiException(409,"VIKASH_OLD_CONNECTION","Este abastecimento pertence a outro vínculo e não pode ser reenviado.");
            if (store.connection(previous.connectionId()).filter(c -> "EXPIRED".equals(c.status())).isPresent()) {
                var preserved=read(previous.choicesJson(),Choices.class);
                long version=Math.max(entry.version()+1,previous.sourceVersion()+1);
                store.save(entry.id(),previous.connectionId(),version,send,previous.choicesJson(),write(payload(entry,preserved,version)),send ? "PUT" : "DELETE");
                store.state(entry.id(),"ACTION_REQUIRED","LINK_EXPIRED",previous.attempts(),clock.instant());
            }
            return;
        }
        if (send || previous == null) {
            if (connection == null || !"CONNECTED".equals(connection.status())) throw new ApiException(409,"VIKASH_DISCONNECTED","Conecte sua conta ViKash antes de enviar.");
            if (!connection.id().equals(selection.connectionId())) throw new ApiException(409,"VIKASH_CONNECTION_CHANGED","O vínculo ViKash mudou. Confira suas escolhas.");
            if (previous != null && "CANCELLED".equals(previous.status()) && previous.remoteVersion() != null)
                throw new ApiException(409,"VIKASH_CANCELLED","O envio foi cancelado no ViKash e não pode ser reativado.");
            Catalog catalog=read(connection.catalogJson(),Catalog.class);
            if (catalog == null) throw new ApiException(409,"VIKASH_CATALOG_REQUIRED","Abra as opções ViKash para carregar as escolhas disponíveis.");
            ViKashRules.validate(selection.choices(),catalog,new BigDecimal(entry.paidTotal()));
        }
        Choices choices=send || previous == null ? selection.choices() : read(previous.choicesJson(),Choices.class);
        UUID connectionId=previous == null ? connection.id() : previous.connectionId();
        long version=previous == null ? entry.version()+1 : Math.max(entry.version()+1,previous.sourceVersion()+1);
        store.save(entry.id(),connectionId,version,send,write(choices),write(payload(entry,choices,version)),send ? "PUT" : "DELETE");
        if (previous == null && !send) store.state(entry.id(),"CANCELLED",null,0,clock.instant());
        if (previous != null && "ACTION_REQUIRED".equals(previous.status()))
            store.state(entry.id(),"ACTION_REQUIRED",previous.errorCode(),0,clock.instant());
    }
    private Map<String,Object> payload(FuelEntryDtos.View entry,Choices c,long version) {
        var p=new LinkedHashMap<String,Object>(); p.put("version",version);
        p.put("occurredAt",entry.occurredAt().atZone(ZoneId.of(entry.timezone())).toOffsetDateTime().toString()); p.put("timeZone",entry.timezone());
        p.put("amount",new BigDecimal(entry.paidTotal())); p.put("currency","BRL"); p.put("description","Abastecimento FuelLog");
        p.put("fuel",entry.fuelType().name()); p.put("liters",new BigDecimal(entry.liters()));
        p.put("categoryId",c.categoryId()); p.put("paymentMethod",c.paymentMethod());
        if (c.accountId() != null) p.put("accountUuid",c.accountId()); if (c.cardId() != null) p.put("creditCardUuid",c.cardId());
        p.put("installmentCount",c.installments()); return p;
    }
    public EntryStatus entryStatus(UUID entryId) {
        return store.sync(entryId).map(s -> new EntryStatus(s.status(),s.send(),s.connectionId(),read(s.choicesJson(),Choices.class),s.errorCode(),s.updatedAt())).orElse(null);
    }
    public FuelEntryDtos.View decorate(FuelEntryDtos.View v) {
        return new FuelEntryDtos.View(v.id(),v.vehicleId(),v.occurredAt(),v.timezone(),v.odometerKm(),v.fuelType(),v.liters(),v.unitPrice(),v.paidTotal(),
            v.referenceTotal(),v.adjustmentAmount(),v.adjustmentReason(),v.version(),v.idempotentReplay(),v.latitude(),v.longitude(),entryStatus(v.id()));
    }
    public void process(UUID entryId) {
        if (!configured()) return;
        Sync first=store.sync(entryId).orElse(null); if (first == null) return;
        Connection owner=store.connection(first.connectionId()).orElse(null); if (owner == null) return;
        // Serializes dispatch, refresh, local edits and revocation across API instances.
        transactions.executeWithoutResult(tx -> {
            lock(owner.userId()); Sync s=store.sync(entryId).orElseThrow();
            if (!Set.of("PENDING","ERROR").contains(s.status())) return;
            Connection c=store.connection(s.connectionId()).orElseThrow();
            if (!"CONNECTED".equals(c.status())) { store.state(entryId,"REVOKED".equals(c.status()) ? "CANCELLED" : "ACTION_REQUIRED","LINK_"+c.status(),s.attempts(),clock.instant()); return; }
            try {
                String access=access(c), externalId=externalId(s);
                var remote=client.get(access,externalId);
                if (remote != null && "CANCELLED".equals(remote.status()) && "DELETE".equals(s.operation()) && remote.version() == s.sourceVersion()) {
                    store.confirmed(entryId,remote.etag(),remote.version(),"CANCELLED"); return;
                }
                if (remote != null && (!"ACTIVE".equals(remote.status()) || remote.manuallyModified() && !Objects.equals(remote.etag(),s.remoteEtag())
                    || remote.version() > s.sourceVersion() || s.remoteEtag() != null && !s.remoteEtag().equals(remote.etag())
                    && remote.version() <= Objects.requireNonNullElse(s.remoteVersion(),0L))) {
                    store.state(entryId,"ACTION_REQUIRED",remote.manuallyModified() ? "PRECONDITION_FAILED" : remote.status(),s.attempts(),clock.instant()); return;
                }
                if (remote == null && s.remoteEtag() != null) { store.state(entryId,"ACTION_REQUIRED","MANUALLY_DELETED",s.attempts(),clock.instant()); return; }
                if (remote != null && remote.version() == s.sourceVersion() && "PUT".equals(s.operation())) {
                    store.confirmed(entryId,remote.etag(),remote.version(),"SENT"); return;
                }
                if ("DELETE".equals(s.operation())) {
                    if (remote == null) { store.state(entryId,"CANCELLED",null,0,clock.instant()); return; }
                    var result=client.delete(access,externalId,s.sourceVersion(),remote.etag());
                    store.confirmed(entryId,result.etag(),result.version(),"CANCELLED"); return;
                }
                ViKashRules.validate(read(s.choicesJson(),Choices.class),client.catalog(access),new BigDecimal(json.readTree(s.payloadJson()).path("amount").asString()));
                var result=client.put(access,externalId,s.payloadJson(),remote == null ? null : remote.etag());
                store.confirmed(entryId,result.etag(),result.version(),"SENT");
            } catch (ViKashRemoteException e) {
                if (e.status() == 401) store.expire(c.id());
                int attempts=s.attempts()+1;
                store.state(entryId,e.retryable() && attempts < 8 ? "ERROR" : "ACTION_REQUIRED",e.code(),attempts,
                    clock.instant().plusSeconds(Math.min(3600,15L << Math.min(attempts,8))));
            } catch (ApiException e) { store.state(entryId,"ACTION_REQUIRED","INVALID_REFERENCE",s.attempts(),clock.instant()); }
        });
    }
    public List<UUID> due() { return configured() ? store.due(clock.instant()) : List.of(); }
    public Deletions deletions(int page) {
        if (page < 0 || page > 100000) throw new ApiException(400,"INVALID_PAGINATION","Informe uma página válida.");
        return store.deletions(current.requireUserId(),page);
    }
    private Sync ownedSync(UUID entryId,UUID userId) {
        Sync s=store.sync(entryId).orElseThrow(() -> new ApiException(404,"NOT_FOUND","Envio não encontrado."));
        Connection c=store.connection(s.connectionId()).orElseThrow();
        if (!c.userId().equals(userId)) throw new ApiException(404,"NOT_FOUND","Envio não encontrado.");
        if (!"CONNECTED".equals(c.status())) throw new ApiException(409,"VIKASH_LINK_EXPIRED","Este vínculo ViKash está encerrado ou expirou.");
        return s;
    }
    public RemoteStatus remoteStatus(UUID entryId) {
        requireConfigured(); UUID userId=current.requireUserId();
        return remoteTransaction(userId,() -> {
            Sync s=ownedSync(entryId,userId); var r=client.get(access(store.connection(s.connectionId()).orElseThrow()),externalId(s));
            return r == null ? new RemoteStatus("ABSENT",0,false,null) : new RemoteStatus(r.status(),r.version(),r.manuallyModified(),r.etag());
        });
    }
    public void retry(UUID entryId,Retry input) {
        requireConfigured(); UUID userId=current.requireUserId();
        remoteTransaction(userId,() -> {
            Sync s=ownedSync(entryId,userId);
            if (input == null || input.resolution() == null || !Set.of("RETRY","OVERWRITE").contains(input.resolution())) throw new ApiException(422,"VALIDATION_ERROR","Escolha como resolver o envio.");
            if ("CANCELLED".equals(s.status()) || "SENT".equals(s.status())) throw new ApiException(409,"VIKASH_NO_RETRY","Este envio não precisa de nova tentativa.");
            if ("OVERWRITE".equals(input.resolution())) {
                var r=client.get(access(store.connection(s.connectionId()).orElseThrow()),externalId(s));
                if (r == null || !"ACTIVE".equals(r.status()) || !Objects.equals(input.remoteEtag(),r.etag()))
                    throw new ApiException(409,"VIKASH_REVIEW_REQUIRED","Confira novamente o estado atual no ViKash.");
                // A new source revision makes explicit overwrite distinguishable from a conflicting replay.
                long version=Math.max(s.sourceVersion(),r.version())+1;
                var payload=json.readTree(s.payloadJson()).deepCopy(); ((tools.jackson.databind.node.ObjectNode)payload).put("version",version);
                store.save(entryId,s.connectionId(),version,s.send(),s.choicesJson(),write(payload),s.operation());
                store.acceptRemote(entryId,r.etag(),r.version(),clock.instant());
            } else {
                if ("ACTION_REQUIRED".equals(s.status()) && !Set.of("INVALID_REFERENCE","UNAVAILABLE","INVALID_RESPONSE").contains(Objects.requireNonNullElse(s.errorCode(),"")))
                    throw new ApiException(409,"VIKASH_REVIEW_REQUIRED","Revise o conflito antes de reenviar.");
                store.state(entryId,"PENDING",null,0,clock.instant());
            }
            return true;
        });
    }
    private static String externalId(Sync s) { return s.connectionId()+"."+s.entryId(); }
    private String returnUrl(String platform) {
        if ("web".equals(platform) && config.webReturnUrl.isBlank())
            throw new ApiException(503,"VIKASH_WEB_NOT_CONFIGURED","A conexão com o ViKash pelo app web não está disponível.");
        return "web".equals(platform) ? config.webReturnUrl : config.nativeReturnUrl;
    }
    private String randomSecret() { byte[] bytes=new byte[32]; random.nextBytes(bytes); return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    private static String challenge(String value) { return Base64.getUrlEncoder().withoutPadding().encodeToString(digest(value)); }
    private static String hash(String value) { return HexFormat.of().formatHex(digest(value)); }
    private static byte[] digest(String value) { try { return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)); } catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); } }
    private String write(Object value) { return value == null ? null : json.writeValueAsString(value); }
    private <T> T read(String value,Class<T> type) { return value == null ? null : json.readValue(value,type); }
    private enum CallbackRejection {
        MALFORMED_STATE, ATTEMPT_MISSING_OR_CONSUMED, ATTEMPT_EXPIRED, SESSION_INVALID, INVALID_CODE, ATTEMPT_SUPERSEDED
    }
    private static ApiException invalidState(CallbackRejection reason) {
        ApiException error=new ApiException(400,"VIKASH_INVALID_STATE","Autorização inválida ou expirada. Inicie a conexão novamente.");
        log.warn("VIKASH_INVALID_STATE correlationId={} reason={}",error.correlationId(),reason);
        return error;
    }
    private static ApiException unavailable() { return new ApiException(503,"VIKASH_UNAVAILABLE","ViKash indisponível. Tente novamente mais tarde."); }
}
