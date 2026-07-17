export interface DistanceResult {
  distanceKm: number;
  success: boolean;
  message?: string;
  isFallback?: boolean;
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function cleanAddressForGeocoding(address: string): string {
  // Remove "- CEP: XXXXXXXX" or "- CEP: XXXXX-XXX" or "CEP: XXXXXXXX" or similar variants
  let cleaned = address.replace(/\s*-\s*CEP:\s*\d{5}-?\d{3}/i, "");
  cleaned = cleaned.replace(/\s*-\s*CEP:\s*\d+/i, "");
  cleaned = cleaned.replace(/CEP:\s*\d{5}-?\d{3}/i, "");
  cleaned = cleaned.replace(/CEP:\s*\d+/i, "");
  return cleaned.replace(/\s+/g, " ").trim();
}

async function geocodeNominatimSingle(address: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const cleanAddress = address.replace(/\s+/g, " ").trim();
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleanAddress)}&limit=1`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "FarmaFlowDeliveryFeeCalculator/1.0"
      }
    });
    const data = await res.json() as any;
    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon)
      };
    }
    return null;
  } catch (e) {
    console.error("[Nominatim Single Error]:", e);
    return null;
  }
}

async function geocodeNominatim(address: string): Promise<{ lat: number; lon: number } | null> {
  const baseCleaned = cleanAddressForGeocoding(address);
  console.log(`[Nominatim Geocoding] Tentando passo 1 com: "${baseCleaned}"`);
  
  // Passo 1: Endereço limpo padrão
  let result = await geocodeNominatimSingle(baseCleaned);
  if (result) return result;

  // Passo 2: Se falhar e tiver número/bairro separado (ex: "Rua Bangu, 131 - Nova Cidade, Rio das Ostras - RJ"),
  // tentamos remover a parte do número para obter o logradouro geral
  const withNoNumberPattern = baseCleaned.replace(/,\s*[^,]+-\s*/, ", ");
  if (withNoNumberPattern !== baseCleaned) {
    console.log(`[Nominatim Fallback] Passo 2: tentando "${withNoNumberPattern}"`);
    result = await geocodeNominatimSingle(withNoNumberPattern);
    if (result) return result;
  }

  // Passo 3: Tenta remover apenas dígitos após a vírgula do número
  const withDigitsRemoved = baseCleaned.replace(/,\s*\d+/, "");
  if (withDigitsRemoved !== baseCleaned) {
    console.log(`[Nominatim Fallback] Passo 3: tentando "${withDigitsRemoved}"`);
    result = await geocodeNominatimSingle(withDigitsRemoved);
    if (result) return result;
  }

  // Passo 4: Tenta apenas "Rua, Cidade"
  const parts = baseCleaned.split(",");
  if (parts.length > 2) {
    const street = parts[0].trim();
    const cityState = parts[parts.length - 1].trim();
    const streetCity = `${street}, ${cityState}`;
    console.log(`[Nominatim Fallback] Passo 4: tentando "${streetCity}"`);
    result = await geocodeNominatimSingle(streetCity);
    if (result) return result;
  }

  // Passo 5: Tenta apenas Bairro, Cidade (se tiver traço separando)
  const partsDash = baseCleaned.split("-").map(s => s.trim());
  if (partsDash.length >= 2) {
     const neighborhoodCity = partsDash[1];
     console.log(`[Nominatim Fallback] Passo 5: tentando "${neighborhoodCity}"`);
     result = await geocodeNominatimSingle(neighborhoodCity);
     if (result) return result;
     
     // Passo 6: Tenta apenas a Cidade e Estado
     if (partsDash.length >= 3) {
       const cityStateFallback = `${partsDash[1].split(',')[1] || partsDash[1]}, ${partsDash[2]}`;
       console.log(`[Nominatim Fallback] Passo 6: tentando "${cityStateFallback}"`);
       result = await geocodeNominatimSingle(cityStateFallback);
       if (result) return result;
     }
  }

  // Passo 7: Fallback agressivo pegando apenas as duas últimas palavras antes dos CEPs/etc
  const words = baseCleaned.split(/[,\s-]+/);
  if (words.length >= 2) {
    const lastTwo = `${words[words.length-2]} ${words[words.length-1]}`;
    console.log(`[Nominatim Fallback] Passo 7: tentando "${lastTwo}"`);
    result = await geocodeNominatimSingle(lastTwo);
    if (result) return result;
  }

  console.warn(`[Nominatim Geocoding] Falha total ao geocodificar: "${address}"`);
  return null;
}

async function calculateDistanceNominatim(
  originAddress: string,
  destinationAddress: string
): Promise<DistanceResult> {
  console.log(`[Nominatim Fallback] Calculando rota de "${originAddress}" para "${destinationAddress}"`);
  
  const originCoords = await geocodeNominatim(originAddress);
  if (!originCoords) {
    return {
      success: false,
      distanceKm: 0,
      message: "Não foi possível geocodificar o endereço de origem via Nominatim."
    };
  }

  const destCoords = await geocodeNominatim(destinationAddress);
  if (!destCoords) {
    return {
      success: false,
      distanceKm: 0,
      message: "Não foi possível geocodificar o endereço de destino via Nominatim."
    };
  }

  const straightDistance = haversineDistance(
    originCoords.lat,
    originCoords.lon,
    destCoords.lat,
    destCoords.lon
  );

  // Estimamos a distância de tráfego real aplicando um fator multiplicador padrão (1.25)
  const distanceKm = parseFloat((straightDistance * 1.25).toFixed(2));
  console.log(`[Nominatim Fallback] Sucesso: Linha reta: ${straightDistance.toFixed(2)} km, Estimado: ${distanceKm} km`);

  return {
    success: true,
    distanceKm
  };
}

export async function calculateDeliveryDistance(
  originAddress: string,
  destinationAddress: string
): Promise<DistanceResult> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.log("[Maps API] Chave do Google Maps não configurada. Usando fallback do Nominatim...");
    return calculateDistanceNominatim(originAddress, destinationAddress);
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(
      originAddress
    )}&destinations=${encodeURIComponent(
      destinationAddress
    )}&key=${apiKey}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status === "OK" && data.rows[0].elements[0].status === "OK") {
      const distanceMeters = data.rows[0].elements[0].distance.value;
      const distanceKm = distanceMeters / 1000;
      return {
        success: true,
        distanceKm,
      };
    } else {
       console.warn(`[Maps API] Status inválido (${data.status}). Usando fallback do Nominatim...`);
       return calculateDistanceNominatim(originAddress, destinationAddress);
    }
  } catch (error: any) {
    console.error("Erro na API do Google Maps, usando fallback do Nominatim...", error);
    return calculateDistanceNominatim(originAddress, destinationAddress);
  }
}
