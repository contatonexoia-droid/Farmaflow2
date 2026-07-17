import { DeliverySettingsConfig } from '../types';

export interface DeliveryCalculationResult {
  fee: number;
  isFreeDelivery: boolean;
  message?: string;
  success: boolean;
}

export function calculateDeliveryFee(
  distanceKm: number,
  orderTotal: number,
  settings: DeliverySettingsConfig
): DeliveryCalculationResult {
  if (!settings || !settings.enabled) {
    return { fee: 0, isFreeDelivery: true, success: true };
  }

  // Check for Free Delivery by order amount
  if (settings.minOrderForFreeDelivery && orderTotal >= settings.minOrderForFreeDelivery) {
    return { fee: 0, isFreeDelivery: true, success: true };
  }

  if (!settings.type || settings.type === 'fixed') {
    return { fee: settings.fee || 0, isFreeDelivery: false, success: true };
  }

  if (settings.type === 'dynamic' && settings.ranges && settings.ranges.length > 0) {
    // Sort ranges by minKm just to be sure
    const sortedRanges = [...settings.ranges].sort((a, b) => a.minKm - b.minKm);
    
    for (const range of sortedRanges) {
      if (distanceKm >= range.minKm && distanceKm <= range.maxKm) {
        return { fee: range.fee, isFreeDelivery: false, success: true };
      }
    }
    
    // Check if distance is greater than the maxKm of the last range
    const maxRange = sortedRanges[sortedRanges.length - 1];
    if (distanceKm > maxRange.maxKm) {
      return { 
        fee: 0, 
        isFreeDelivery: false, 
        success: false, 
        message: "Fora da área de entrega." 
      };
    }
    
    // Distance unmapped (e.g., hole between ranges)
    return {
      fee: 0,
      isFreeDelivery: false,
      success: false,
      message: "Não foi possível calcular a taxa para esta distância (Faixa não mapeada)."
    };
  }

  return { fee: 0, isFreeDelivery: true, success: true }; // default fallback
}
