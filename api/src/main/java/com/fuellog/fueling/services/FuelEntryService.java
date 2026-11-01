package com.fuellog.fueling.services;

import com.fuellog.fueling.dtos.FuelEntryDtos;
import com.fuellog.fueling.dtos.FuelEntryFilters;
import com.fuellog.fueling.models.FuelCommand;
import com.fuellog.fueling.models.FuelEntry;
import com.fuellog.fueling.repositories.FuelEntryRepository;
import com.fuellog.platform.exceptions.ApiException;
import com.fuellog.platform.validation.DomainValues;
import com.fuellog.vehicles.enums.FuelType;
import com.fuellog.vehicles.models.Vehicle;
import com.fuellog.vehicles.services.VehicleService;
import com.fuellog.vikash.services.ViKashService;

import org.springframework.stereotype.Service;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import java.sql.SQLException;
import java.math.BigDecimal;
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
    private final ViKashService vikash;
    public FuelEntryService(FuelEntryRepository entries, VehicleService vehicles, Clock clock, ViKashService vikash) {
        this.entries=entries; this.vehicles=vehicles; this.clock=clock; this.vikash=vikash;
    }
    @Transactional
    public FuelEntryDtos.View create(UUID vehicleId, FuelEntryDtos.Create input) {
        Vehicle vehicle=vehicles.lockOwned(vehicleId);
        FuelCommand command=FuelCommand.normalize(vehicleId,input);
        var existing=entries.findById(command.id());
        if (existing.isPresent()) {
            FuelEntry entry=existing.get();
            if (!entry.vehicleId().equals(vehicleId) || !entry.createRequestHash().equals(command.hash())
                || !Objects.equals(entry.createViKashHash(),vikash.selectionHash(input.vikash())))
                throw new ApiException(409,"IDEMPOTENCY_CONFLICT","UUID j\u00e1 utilizado com outro comando.");
            return vikash.decorate(entry.view(true));
        }
        if (entries.wasDeleted(command.id()))
            throw new ApiException(409,"ENTRY_DELETED","UUID de abastecimento excluído não pode ser reutilizado.");
        command.requireLocation();
        command.validateAmounts();
        if (vehicle.archivedAt() != null) throw new ApiException(409,"VEHICLE_ARCHIVED","Ve\u00edculo arquivado.");
        if (!vehicle.allowedFuels().contains(command.fuelType())) throw DomainValues.invalid("fuelType","Combust\u00edvel n\u00e3o permitido pelo ve\u00edculo.");
        if (command.occurredAt().isAfter(clock.instant().plusSeconds(300))) throw DomainValues.invalid("occurredAt","Data excede toler\u00e2ncia futura de cinco minutos.");
        var previous=entries.findFirstByVehicleIdAndOccurredAtLessThanOrderByOccurredAtDescIdDesc(vehicleId,command.occurredAt());
        var next=entries.findFirstByVehicleIdAndOccurredAtGreaterThanOrderByOccurredAtAscIdAsc(vehicleId,command.occurredAt());
        validateHistory(command,previous,next,entries.findByVehicleIdAndOccurredAt(vehicleId,command.occurredAt()));
        try {
            FuelEntry entry=new FuelEntry(command); entry.createViKashHash(vikash.selectionHash(input.vikash()));
            var view=entries.saveAndFlush(entry).view(false);
            vikash.saveIntent(view,input.vikash(),true,false);
            return vikash.decorate(view);
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
        if (!Objects.equals(entry.version(),expected)) throw staleVersion();
        FuelCommand command=FuelCommand.normalize(vehicleId,entryId,input);
        // Historical adjustments remain editable until their financial values or reason change.
        if (!entry.hasSameAmounts(command)) command.validateAmounts();
        if (command.fuelType() != entry.fuelType() && !vehicle.allowedFuels().contains(command.fuelType()))
            throw DomainValues.invalid("fuelType","Combust\u00edvel n\u00e3o permitido pelo ve\u00edculo.");
        if (command.occurredAt().isAfter(clock.instant().plusSeconds(300)))
            throw DomainValues.invalid("occurredAt","Data excede toler\u00e2ncia futura de cinco minutos.");
        var previous=entries.findFirstByVehicleIdAndIdNotAndOccurredAtLessThanOrderByOccurredAtDescIdDesc(vehicleId,entryId,command.occurredAt());
        var next=entries.findFirstByVehicleIdAndIdNotAndOccurredAtGreaterThanOrderByOccurredAtAscIdAsc(vehicleId,entryId,command.occurredAt());
        validateHistory(command,previous,next,entries.findByVehicleIdAndIdNotAndOccurredAt(vehicleId,entryId,command.occurredAt()));
        entry.update(command);
        try {
            var view=entries.saveAndFlush(entry).view(false);
            vikash.saveIntent(view,input.vikash(),false,false);
            return vikash.decorate(view);
        }
        catch (ObjectOptimisticLockingFailureException error) { throw staleVersion(); }
    }
    @Transactional
    public void delete(UUID vehicleId, UUID entryId, String ifMatch) {
        vehicles.lockOwned(vehicleId);
        FuelEntry entry=entries.findByIdAndVehicleId(entryId,vehicleId).orElseThrow(VehicleService::notFound);
        long expected=expectedVersion(ifMatch);
        if (!Objects.equals(entry.version(),expected)) throw staleVersion();
        entry.delete(clock.instant());
        try {
            entries.saveAndFlush(entry);
            vikash.saveIntent(entry.view(false),null,false,true);
        }
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
        return new ApiException(412,"PRECONDITION_FAILED","Abastecimento alterado; consulte novamente antes de continuar.");
    }
    private static void validateHistory(FuelCommand command, Optional<FuelEntry> previous, Optional<FuelEntry> next, List<FuelEntry> ties) {
        if (previous.isPresent() && previous.get().odometerKm() > command.odometerKm() || next.isPresent() && next.get().odometerKm() < command.odometerKm())
            throw DomainValues.invalid("odometerKm","Hod\u00f4metro deve ficar entre os vizinhos cronol\u00f3gicos.");
        for (FuelEntry same:ties) {
            if (same.odometerKm() != command.odometerKm())
                throw DomainValues.invalid("occurredAt","Ordem amb\u00edgua no mesmo instante; corrija a hora.");
        }
    }
    @Transactional(readOnly=true)
    public FuelEntryDtos.View get(UUID vehicleId, UUID entryId) {
        vehicles.owned(vehicleId);
        return vikash.decorate(entries.findByIdAndVehicleId(entryId,vehicleId).orElseThrow(VehicleService::notFound).view(false));
    }
    @Transactional(readOnly=true)
    public FuelEntryDtos.Page list(UUID vehicleId, LocalDate from, LocalDate to, String timezone,
        FuelType fuelType, FuelEntryFilters bounds, int page, int size) {
        return list(vehicleId,from,to,timezone,fuelType,bounds,page,size,null,null,null);
    }
    @Transactional(readOnly=true)
    public FuelEntryDtos.Page list(UUID vehicleId, LocalDate from, LocalDate to, String timezone,
        FuelType fuelType, FuelEntryFilters bounds, int page, int size,
        Instant occurredFrom, Instant occurredTo, UUID entryId) {
        vehicles.owned(vehicleId);
        ZoneId zone=DomainValues.zone(timezone);
        if (page < 0 || size < 1 || size > 20) throw new ApiException(400,"INVALID_PAGINATION","page >= 0 e size entre 1 e 20.");
        if (from != null && to != null && from.isAfter(to)) throw DomainValues.invalid("to","Fim anterior ao in\u00edcio.");
        if (occurredFrom != null && occurredTo != null && occurredFrom.isAfter(occurredTo)) throw DomainValues.invalid("occurredTo","Fim anterior ao início.");
        Instant start=from == null ? null : from.atStartOfDay(zone).toInstant();
        Instant end;
        try { end=to == null ? null : to.plusDays(1).atStartOfDay(zone).toInstant(); }
        catch (DateTimeException e) { throw DomainValues.invalid("to","Data final fora da faixa suportada."); }
        Specification<FuelEntry> filter=(root,query,builder) -> {
            var predicates=new ArrayList<Predicate>();
            predicates.add(builder.equal(root.get("vehicleId"),vehicleId));
            if(occurredFrom != null) predicates.add(builder.greaterThan(root.get("occurredAt"),occurredFrom));
            if(occurredTo != null) predicates.add(builder.lessThanOrEqualTo(root.get("occurredAt"),occurredTo));
            if(entryId != null) predicates.add(builder.equal(root.get("id"),entryId));
            if(start != null) predicates.add(builder.greaterThanOrEqualTo(root.get("occurredAt"),start));
            if(end != null) predicates.add(builder.lessThan(root.get("occurredAt"),end));
            if(fuelType != null) predicates.add(builder.equal(root.get("fuelType"),fuelType));
            if(bounds.minTotalPaid() != null) predicates.add(builder.greaterThanOrEqualTo(root.get("paidTotal"),bounds.minTotalPaid()));
            if(bounds.maxTotalPaid() != null) predicates.add(builder.lessThanOrEqualTo(root.get("paidTotal"),bounds.maxTotalPaid()));
            if(bounds.minLiters() != null) predicates.add(builder.greaterThanOrEqualTo(root.get("liters"),bounds.minLiters()));
            if(bounds.maxLiters() != null) predicates.add(builder.lessThanOrEqualTo(root.get("liters"),bounds.maxLiters()));
            if(bounds.minPricePerLiter() != null) predicates.add(builder.greaterThanOrEqualTo(root.get("unitPrice"),bounds.minPricePerLiter()));
            if(bounds.maxPricePerLiter() != null) predicates.add(builder.lessThanOrEqualTo(root.get("unitPrice"),bounds.maxPricePerLiter()));
            return builder.and(predicates.toArray(Predicate[]::new));
        };
        var result=entries.findAll(filter,PageRequest.of(page,size,Sort.by(Sort.Direction.DESC,"occurredAt","id")));
        var months=entries.monthlyTotals(filter,zone.getId());
        var paidTotal=months.stream().map(m -> m.paidTotal()).reduce(BigDecimal.ZERO,BigDecimal::add);
        var purchasedLiters=months.stream().map(m -> m.purchasedLiters()).reduce(BigDecimal.ZERO,BigDecimal::add);
        var summary=new FuelEntryDtos.Summary(paidTotal.setScale(2).toPlainString(),purchasedLiters.setScale(3).toPlainString());
        var monthlyCounts=months.stream().map(m -> new FuelEntryDtos.MonthlyCount(m.month(),m.purchaseCount())).toList();
        return new FuelEntryDtos.Page(result.getContent().stream().map(e -> e.view(false)).toList(),page,size,
            result.getTotalElements(),result.getTotalPages(),summary,monthlyCounts);
    }
}
