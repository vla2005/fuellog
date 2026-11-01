package com.fuellog.vikash.repositories;

import com.fuellog.vikash.models.ViKashRecords.*;
import com.fuellog.vikash.dtos.ViKashDtos.*;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.*;
import org.springframework.stereotype.Repository;

@Repository
public class ViKashRepository {
    private final JdbcTemplate jdbc;
    public ViKashRepository(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    private static Instant time(ResultSet r,String key) throws SQLException { Timestamp t=r.getTimestamp(key); return t == null ? null : t.toInstant(); }
    private static final RowMapper<Connection> CONNECTION=(r,n) -> new Connection(r.getObject("id",UUID.class),r.getObject("user_id",UUID.class),r.getString("status"),
        r.getString("access_cipher"),r.getString("refresh_cipher"),time(r,"access_expires_at"),r.getBoolean("automatic_send"),r.getString("choices_json"),r.getString("catalog_json"),r.getBoolean("remote_revoked"));
    private static final RowMapper<Sync> SYNC=(r,n) -> new Sync(r.getObject("entry_id",UUID.class),r.getObject("connection_id",UUID.class),r.getLong("source_version"),r.getBoolean("send"),
        r.getString("choices_json"),r.getString("payload_json"),r.getString("remote_etag"),r.getObject("remote_version",Long.class),r.getString("operation"),r.getString("status"),
        r.getString("error_code"),r.getInt("attempts"),time(r,"updated_at"));
    public Optional<Connection> current(UUID userId) { return jdbc.query("select * from vikash_connections where user_id=? and status<>'REVOKED'",CONNECTION,userId).stream().findFirst(); }
    public Optional<Connection> last(UUID userId) { return jdbc.query("select * from vikash_connections where user_id=? order by created_at desc,id desc limit 1",CONNECTION,userId).stream().findFirst(); }
    public Optional<Connection> connection(UUID id) { return jdbc.query("select * from vikash_connections where id=?",CONNECTION,id).stream().findFirst(); }
    public void connect(UUID id,UUID userId,String access,String refresh,Instant expiresAt) {
        jdbc.update("insert into vikash_connections(id,user_id,status,access_cipher,refresh_cipher,access_expires_at) values (?,?,'CONNECTED',?,?,?)",id,userId,access,refresh,Timestamp.from(expiresAt));
    }
    public void tokens(UUID id,String access,String refresh,Instant expiresAt) {
        jdbc.update("update vikash_connections set access_cipher=?,refresh_cipher=?,access_expires_at=?,status='CONNECTED' where id=?",access,refresh,Timestamp.from(expiresAt),id);
    }
    public void expire(UUID id) {
        jdbc.update("update vikash_connections set status='EXPIRED',access_cipher=null,refresh_cipher=null where id=?",id);
        jdbc.update("update vikash_sync set status='ACTION_REQUIRED',error_code='LINK_EXPIRED',updated_at=now() where connection_id=? and status in ('PENDING','ERROR')",id);
    }
    public void revoke(UUID id) {
        revoke(id,false);
    }
    public void revoke(UUID id,boolean remoteRevoked) {
        jdbc.update("update vikash_connections set status='REVOKED',access_cipher=null,refresh_cipher=null,automatic_send=false,choices_json=null,catalog_json=null,remote_revoked=? where id=?",remoteRevoked,id);
        jdbc.update("update vikash_sync set status='CANCELLED',send=false,error_code=case when error_code='CANCELLATION_CONFIRMED' then error_code else 'LINK_REVOKED' end,updated_at=now() where connection_id=?",id);
    }
    public void preferences(UUID id,boolean automatic,String choices) { jdbc.update("update vikash_connections set automatic_send=?,choices_json=? where id=?",automatic,choices,id); }
    public void catalog(UUID id,String catalog) { jdbc.update("update vikash_connections set catalog_json=? where id=?",catalog,id); }
    public void clearAttempts(UUID userId) { jdbc.update("delete from vikash_authorizations where user_id=?",userId); }
    public void attempt(String hash,Attempt a) {
        jdbc.update("insert into vikash_authorizations(state_hash,id,user_id,session_id,verifier_cipher,platform,expires_at) values (?,?,?,?,?,?,?)",hash,a.id(),a.userId(),a.sessionId(),a.verifierCipher(),a.platform(),Timestamp.from(a.expiresAt()));
    }
    public Optional<Attempt> consume(String hash) {
        return jdbc.query("update vikash_authorizations set consumed_at=now() where state_hash=? and consumed_at is null returning *",(r,n) ->
            new Attempt(r.getObject("id",UUID.class),r.getObject("user_id",UUID.class),r.getObject("session_id",UUID.class),r.getString("verifier_cipher"),r.getString("platform"),time(r,"expires_at")),hash).stream().findFirst();
    }
    public boolean authoritative(UUID attemptId) { return Boolean.TRUE.equals(jdbc.queryForObject("select exists(select 1 from vikash_authorizations where id=? and consumed_at is not null)",Boolean.class,attemptId)); }
    public boolean pending(UUID userId,Instant now) { return Boolean.TRUE.equals(jdbc.queryForObject("select exists(select 1 from vikash_authorizations where user_id=? and consumed_at is null and expires_at>?)",Boolean.class,userId,Timestamp.from(now))); }
    public boolean sessionValid(UUID userId,UUID sessionId,Instant now) {
        return Boolean.TRUE.equals(jdbc.queryForObject("select exists(select 1 from user_sessions s join users u on u.id=s.user_id where s.id=? and s.user_id=? and s.revoked_at is null and s.expires_at>? and u.disabled_at is null)",Boolean.class,sessionId,userId,Timestamp.from(now)));
    }
    public Optional<Sync> sync(UUID entryId) { return jdbc.query("select * from vikash_sync where entry_id=?",SYNC,entryId).stream().findFirst(); }
    public void save(UUID entryId,UUID connectionId,long version,boolean send,String choices,String payload,String operation) {
        jdbc.update("""
            insert into vikash_sync(entry_id,connection_id,source_version,send,choices_json,payload_json,operation,status)
            values (?,?,?,?,?,?,?,'PENDING') on conflict(entry_id) do update set source_version=excluded.source_version,
            send=excluded.send,choices_json=excluded.choices_json,payload_json=excluded.payload_json,operation=excluded.operation,
            status='PENDING',error_code=null,attempts=0,next_attempt_at=now(),updated_at=now()
            """,entryId,connectionId,version,send,choices,payload,operation);
    }
    public void state(UUID entryId,String status,String code,int attempts,Instant next) {
        jdbc.update("update vikash_sync set status=?,error_code=?,attempts=?,next_attempt_at=?,updated_at=now() where entry_id=?",status,code,attempts,Timestamp.from(next),entryId);
    }
    public void confirmed(UUID entryId,String etag,long remoteVersion,String status) {
        jdbc.update("update vikash_sync set remote_etag=?,remote_version=?,status=?,error_code=?,attempts=0,updated_at=now() where entry_id=?",etag,remoteVersion,status,"CANCELLED".equals(status) ? "CANCELLATION_CONFIRMED" : null,entryId);
    }
    public void acceptRemote(UUID entryId,String etag,Long remoteVersion,Instant now) {
        jdbc.update("update vikash_sync set remote_etag=?,remote_version=?,status='PENDING',error_code=null,attempts=0,next_attempt_at=?,updated_at=now() where entry_id=?",etag,remoteVersion,Timestamp.from(now),entryId);
    }
    public List<UUID> due(Instant now) { return jdbc.query("select entry_id from vikash_sync where status in ('PENDING','ERROR') and next_attempt_at<=? order by next_attempt_at limit 20",(r,n) -> r.getObject(1,UUID.class),Timestamp.from(now)); }
    public Deletions deletions(UUID userId,int page) {
        String from=" from vikash_sync s join vikash_connections c on c.id=s.connection_id join fuel_entries e on e.id=s.entry_id where c.user_id=? and e.deleted_at is not null";
        long total=jdbc.queryForObject("select count(*)"+from,Long.class,userId);
        var items=jdbc.query("select s.entry_id,e.occurred_at,e.paid_total,s.status,s.error_code"+from+" order by s.updated_at desc,s.entry_id limit 10 offset ?",
            (r,n) -> new Deletion(r.getObject("entry_id",UUID.class),time(r,"occurred_at"),r.getBigDecimal("paid_total").toPlainString(),r.getString("status"),r.getString("error_code")),userId,page*10);
        return new Deletions(items,page,total);
    }
}
