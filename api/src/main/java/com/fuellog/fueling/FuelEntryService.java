package com.fuellog.fueling;

import com.fuellog.vehicles.*;
import com.fuellog.platform.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import java.sql.SQLException;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.data.domain.*;
import org.springframework.data.jpa.domain.Specification;
import jakarta.persistence.criteria.Predicate;
import java.time.*;
import java.util.*;

@Service
public class FuelEntryService {
    private final FuelEntryRepository entries;
    private final VehicleService vehicles;
    private final Clock clock;
    public FuelEntryService(FuelEntryRepository entries, VehicleService vehicles, Clock clock) {
        this.entries=entries; this.vehicles=vehicles; this.clock=clock;
    }
    @Transactional
    public FuelEntryDtos.View create(UUID vehicleId, FuelEntryDtos.Create input) {
        Vehicle vehicle=vehicles.lockOwned(vehicleId);
        FuelCommand command=FuelCommand.normalize(vehicleId,input);
        var existing=entries.findById(command.id());
        if (existing.isPresent()) {
            FuelEntry entry=existing.get();
            if (!entry.vehicleId.equals(vehicleId) || !entry.createRequestHash.equals(command.hash()))
                throw new ApiException(409,"IDEMPOTENCY_CONFLICT","UUID j\u00e1 utilizado com outro comando.");
            return entry.view(true);
        }
        command.requireLocation();
        if (vehicle.archivedAt() != null) throw new ApiException(409,"VEHICLE_ARCHIVED","Ve\u00edculo arquivado.");
        if (!vehicle.allowedFuels().contains(command.fuelType())) throw DomainValues.invalid("fuelType","Combust\u00edvel n\u00e3o permitido pelo ve\u00edculo.");
        if (command.occurredAt().isAfter(clock.instant().plusSeconds(300))) throw DomainValues.invalid("occurredAt","Data excede toler\u00e2ncia futura de cinco minutos.");
        var previous=entries.findFirstByVehicleIdAndOccurredAtLessThanOrderByOccurredAtDescIdDesc(vehicleId,command.occurredAt());
        var next=entries.findFirstByVehicleIdAndOccurredAtGreaterThanOrderByOccurredAtAscIdAsc(vehicleId,command.occurredAt());
        validateHistory(command,previous,next,entries.findByVehicleIdAndOccurredAt(vehicleId,command.occurredAt()));
        boolean pendingGap=vehicle.pendingHistoryGapAfter() != null && !command.occurredAt().isBefore(vehicle.pendingHistoryGapAfter());
        if (pendingGap) vehicle.consumePendingGap();
        try {
            return entries.saveAndFlush(new FuelEntry(command,pendingGap)).view(false);
        } catch (DataIntegrityViolationException error) {
            // Different vehicle locks cannot serialize a shared client UUID; roll back this transaction.
            for (Throwable cause=error; cause != null; cause=cause.getCause()) {
                if (cause instanceof SQLException sql && "23505".equals(sql.getSQLState()))
                    throw new ApiException(409,"IDEMPOTENCY_CONFLICT","UUID j\u00e1 utilizado com outro comando.");
            }
            throw error;
        }
    }
    @Transactional
    public FuelEntryDtos.View update(UUID vehicleId, UUID entryId, String ifMatch, FuelEntryDtos.Update input) {
        Vehicle vehicle=vehicles.lockOwned(vehicleId);
        FuelEntry entry=entries.findByIdAndVehicleId(entryId,vehicleId).orElseThrow(VehicleService::notFound);
        long expected=expectedVersion(ifMatch);
        if (!Objects.equals(entry.version,expected)) throw staleVersion();
        FuelCommand command=FuelCommand.normalize(vehicleId,entryId,input);
        if (command.fuelType() != entry.fuelType && !vehicle.allowedFuels().contains(command.fuelType()))
            throw DomainValues.invalid("fuelType","Combust\u00edvel n\u00e3o permitido pelo ve\u00edculo.");
        if (command.occurredAt().isAfter(clock.instant().plusSeconds(300)))
            throw DomainValues.invalid("occurredAt","Data excede toler\u00e2ncia futura de cinco minutos.");
        var previous=entries.findFirstByVehicleIdAndIdNotAndOccurredAtLessThanOrderByOccurredAtDescIdDesc(vehicleId,entryId,command.occurredAt());
        var next=entries.findFirstByVehicleIdAndIdNotAndOccurredAtGreaterThanOrderByOccurredAtAscIdAsc(vehicleId,entryId,command.occurredAt());
        validateHistory(command,previous,next,entries.findByVehicleIdAndIdNotAndOccurredAt(vehicleId,entryId,command.occurredAt()));
        entry.update(command);
        try { return entries.saveAndFlush(entry).view(false); }
        catch (ObjectOptimisticLockingFailureException error) { throw staleVersion(); }
    }
    private static long expectedVersion(String ifMatch) {
        if (ifMatch == null) throw new ApiException(428,"PRECONDITION_REQUIRED","Informe If-Match com o ETag do abastecimento.");
        if (!ifMatch.matches("\"(?:0|[1-9][0-9]*)\""))
            throw new ApiException(400,"INVALID_IF_MATCH","If-Match deve conter um ETag forte num\u00e9rico.");
        try { return Long.parseLong(ifMatch.substring(1,ifMatch.length()-1)); }
        catch (NumberFormatException error) { throw new ApiException(400,"INVALID_IF_MATCH","Vers\u00e3o fora do intervalo suportado."); }
    }
    private static ApiException staleVersion() {
        return new ApiException(412,"PRECONDITION_FAILED","Abastecimento alterado; consulte novamente antes de editar.");
    }
    private static void validateHistory(FuelCommand command, Optional<FuelEntry> previous, Optional<FuelEntry> next, List<FuelEntry> ties) {
        if (previous.isPresent() && previous.get().odometerKm > command.odometerKm() || next.isPresent() && next.get().odometerKm < command.odometerKm())
            throw DomainValues.invalid("odometerKm","Hod\u00f4metro deve ficar entre os vizinhos cronol\u00f3gicos.");
        for (FuelEntry same:ties) {
            if (same.odometerKm != command.odometerKm() || same.tankState == TankState.FULL || command.tankState() == TankState.FULL
                || same.historyGapBefore || command.historyGapBefore())
                throw DomainValues.invalid("occurredAt","Ordem amb\u00edgua no mesmo instante; corrija a hora.");
        }
    }
    @Transactional(readOnly=true)
    public FuelEntryDtos.View get(UUID vehicleId, UUID entryId) {
        vehicles.owned(vehicleId);
        return entries.findByIdAndVehicleId(entryId,vehicleId).orElseThrow(VehicleService::notFound).view(false);
    }
    @Transactional(readOnly=true)
    public FuelEntryDtos.Page list(UUID vehicleId, LocalDate from, LocalDate to, String timezone,
        FuelType fuelType, TankState tankState, int page, int size) {
        vehicles.owned(vehicleId);
        ZoneId zone=DomainValues.zone(timezone);
        if (page < 0 || size < 1 || size > 100) throw new ApiException(400,"INVALID_PAGINATION","page >= 0 e size entre 1 e 100.");
        if (from != null && to != null && from.isAfter(to)) throw DomainValues.invalid("to","Fim anterior ao in\u00edcio.");
        Instant start=from == null ? null : from.atStartOfDay(zone).toInstant();
        Instant end;
        try { end=to == null ? null : to.plusDays(1).atStartOfDay(zone).toInstant(); }
        catch (DateTimeException e) { throw DomainValues.invalid("to","Data final fora da faixa suportada."); }
        Specification<FuelEntry> filter=(root,query,builder) -> {
            var predicates=new ArrayList<Predicate>();
            predicates.add(builder.equal(root.get("vehicleId"),vehicleId));
            if(start != null) predicates.add(builder.greaterThanOrEqualTo(root.get("occurredAt"),start));
            if(end != null) predicates.add(builder.lessThan(root.get("occurredAt"),end));
            if(fuelType != null) predicates.add(builder.equal(root.get("fuelType"),fuelType));
            if(tankState != null) predicates.add(builder.equal(root.get("tankState"),tankState));
            return builder.and(predicates.toArray(Predicate[]::new));
        };
        var result=entries.findAll(filter,PageRequest.of(page,size,Sort.by(Sort.Direction.DESC,"occurredAt","id")));
        return new FuelEntryDtos.Page(result.getContent().stream().map(e -> e.view(false)).toList(),page,size,result.getTotalElements(),result.getTotalPages());
    }
}
