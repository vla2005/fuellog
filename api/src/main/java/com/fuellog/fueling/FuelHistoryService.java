package com.fuellog.fueling;

import com.fuellog.vehicles.VehicleService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;
import java.util.UUID;

@Service
public class FuelHistoryService {
    private final FuelEntryRepository entries;
    private final VehicleService vehicles;
    public FuelHistoryService(FuelEntryRepository entries, VehicleService vehicles) {
        this.entries=entries; this.vehicles=vehicles;
    }
    @Transactional(readOnly=true)
    public List<FuelHistory> read(UUID vehicleId) {
        vehicles.owned(vehicleId);
        return entries.findByVehicleIdOrderByOccurredAtAscIdAsc(vehicleId).stream()
            .map(e -> new FuelHistory(e.id,e.occurredAt,e.odometerKm,e.fuelType,e.liters,e.paidTotal,e.tankState,e.historyGapBefore)).toList();
    }
}
