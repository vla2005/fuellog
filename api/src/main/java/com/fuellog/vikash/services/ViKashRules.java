package com.fuellog.vikash.services;

import com.fuellog.platform.validation.DomainValues;
import com.fuellog.vikash.dtos.ViKashDtos.*;
import java.math.BigDecimal;

public final class ViKashRules {
    private ViKashRules() {}
    public static void validate(Choices c, Catalog catalog, BigDecimal paidTotal) {
        if (c == null) throw DomainValues.invalid("vikash","Selecione os dados de envio ao ViKash.");
        if (!"1".equals(catalog.apiVersion()) || !"BRL".equals(catalog.currency()) || catalog.installments() == null)
            throw DomainValues.invalid("vikash","Catálogo ViKash incompatível. Tente novamente mais tarde.");
        if (catalog.categories().stream().noneMatch(v -> v.id().equals(c.categoryId())))
            throw DomainValues.invalid("vikash.categoryId","Categoria indisponível. Selecione outra categoria.");
        if (!catalog.paymentMethods().contains(c.paymentMethod()))
            throw DomainValues.invalid("vikash.paymentMethod","Pagamento indisponível. Selecione outra forma.");
        boolean credit="CREDIT_CARD".equals(c.paymentMethod());
        if (credit) {
            if (c.accountId() != null) throw DomainValues.invalid("vikash.accountId","Crédito não usa conta. Selecione somente cartão.");
            if (catalog.cards().stream().noneMatch(v -> v.uuid().equals(c.cardId())))
                throw DomainValues.invalid("vikash.cardId","Cartão indisponível. Selecione outro cartão.");
        } else {
            if (catalog.accounts().stream().noneMatch(v -> v.uuid().equals(c.accountId())) || c.cardId() != null)
                throw DomainValues.invalid("vikash.accountId","Conta indisponível. Selecione somente uma conta ou carteira.");
        }
        if (c.installments() == null || c.installments() < catalog.installments().min() || c.installments() > catalog.installments().max()
            || !credit && c.installments() != 1)
            throw DomainValues.invalid("vikash.installments","Selecione um parcelamento válido para esse pagamento.");
        if (credit && paidTotal != null && paidTotal.movePointRight(2).compareTo(BigDecimal.valueOf(c.installments())) < 0)
            throw DomainValues.invalid("vikash.installments","Cada parcela deve ter pelo menos R$ 0,01.");
    }
}
