/*
 * Copyright 2020, OpenRemote Inc.
 *
 * See the CONTRIBUTORS.txt file in the distribution for a
 * full listing of individual contributors.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */
package org.openremote.model.asset.impl;

import org.openremote.model.asset.AssetDescriptor;
import org.openremote.model.attribute.MetaItem;
import org.openremote.model.value.AttributeDescriptor;
import org.openremote.model.value.MetaItemType;
import org.openremote.model.value.ValueType;

import javax.persistence.Entity;
import java.util.Optional;

@Entity
public class ElectricityStorageAsset extends ElectricityAsset<ElectricityStorageAsset> {

    public static final AttributeDescriptor<Integer> CHARGE_CYCLES = new AttributeDescriptor<>("chargeCycles", ValueType.POSITIVE_INTEGER,
        new MetaItem<>(MetaItemType.READ_ONLY)
    );

    public static final AttributeDescriptor<Double> POWER_IMPORT_MIN = ElectricityAsset.POWER_IMPORT_MIN.withOptional(true);
    public static final AttributeDescriptor<Double> POWER_EXPORT_MIN = ElectricityAsset.POWER_EXPORT_MIN.withOptional(true);
    public static final AttributeDescriptor<Double> CARBON_IMPORT = ElectricityAsset.CARBON_IMPORT.withOptional(true);
    public static final AttributeDescriptor<Double> CARBON_EXPORT = ElectricityAsset.CARBON_EXPORT.withOptional(true);
    public static final AttributeDescriptor<Integer> CARBON_IMPORT_TOTAL = ElectricityAsset.CARBON_IMPORT_TOTAL.withOptional(true);
    public static final AttributeDescriptor<Integer> CARBON_EXPORT_TOTAL = ElectricityAsset.CARBON_EXPORT_TOTAL.withOptional(true);

    public static final AssetDescriptor<ElectricityStorageAsset> DESCRIPTOR = new AssetDescriptor<>("battery-charging", "1B7C89", ElectricityStorageAsset.class);

    /**
     * For use by hydrators (i.e. JPA/Jackson)
     */
    ElectricityStorageAsset() {
        this(null);
    }

    public ElectricityStorageAsset(String name) {
        super(name);
    }

    public Optional<Integer> getChargeCycles() {
        return getAttributes().getValue(CHARGE_CYCLES);
    }

    public ElectricityStorageAsset setChargeCycles(Integer value) {
        getAttributes().getOrCreate(CHARGE_CYCLES).setValue(value);
        return this;
    }
}
