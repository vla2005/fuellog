package com.fuellog.vikash;

import static org.assertj.core.api.Assertions.*;
import com.fuellog.vikash.dtos.ViKashDtos.*;
import com.fuellog.vikash.services.ViKashRules;
import com.fuellog.vikash.services.ViKashEncryption;
import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.Test;

class ViKashRulesTest {
    private final Catalog catalog=new Catalog("1",List.of(new Category("default:1","Combustível","DEFAULT")),
        List.of(new Account("account","Carteira","CARTEIRA")),List.of(new Card("card","Cartão")),
        List.of("PIX","CREDIT_CARD"),new Installments(1,120,true),"BRL");
    @Test void creditRequiresCardAndEnoughCentsForEveryInstallment() {
        var credit=new Choices("default:1","CREDIT_CARD",null,"card",3);
        assertThatCode(() -> ViKashRules.validate(credit,catalog,new BigDecimal("0.03"))).doesNotThrowAnyException();
        assertThatThrownBy(() -> ViKashRules.validate(credit,catalog,new BigDecimal("0.02"))).hasMessageContaining("parcela");
        assertThatThrownBy(() -> ViKashRules.validate(new Choices("default:1","CREDIT_CARD","account","card",1),catalog,null)).hasMessageContaining("conta");
        assertThatThrownBy(() -> ViKashRules.validate(new Choices("default:1","PIX",null,"card",1),catalog,null)).hasMessageContaining("conta");
    }
    @Test void unavailableReferencesAndUnsupportedPaymentAreRejected() {
        assertThatThrownBy(() -> ViKashRules.validate(new Choices("default:2","PIX","account",null,1),catalog,null)).hasMessageContaining("Categoria");
        assertThatThrownBy(() -> ViKashRules.validate(new Choices("default:1","PIX","archived",null,1),catalog,null)).hasMessageContaining("Conta");
        assertThatThrownBy(() -> ViKashRules.validate(new Choices("default:1","OTHER","account",null,1),catalog,null)).hasMessageContaining("Pagamento");
    }
    @Test void secretsAreRandomizedAuthenticatedAndBoundToConnection() {
        var crypto=new ViKashEncryption(Base64.getEncoder().encodeToString(new byte[32]));
        UUID connection=UUID.randomUUID();
        String first=crypto.encrypt(connection,"external-secret"), second=crypto.encrypt(connection,"external-secret");
        assertThat(first).isNotEqualTo(second).doesNotContain("external-secret");
        assertThat(crypto.decrypt(connection,first)).isEqualTo("external-secret");
        assertThatThrownBy(() -> crypto.decrypt(UUID.randomUUID(),first)).isInstanceOf(IllegalStateException.class);
        assertThat(new ViKashEncryption("").configured()).isFalse();
    }
}
