import { tool } from "ai";
import { z } from "zod";

/** WMO weather interpretation codes → short human label. */
const WMO: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  80: "Rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Thunderstorm with heavy hail",
};

export type WeatherResult = {
  location: string;
  temperature: number;
  unit: string;
  apparentTemperature?: number;
  humidity?: number;
  windSpeed?: number;
  windUnit?: string;
  weatherCode: number;
  condition: string;
  isDay: boolean;
};

export type WeatherError = { error: string };

/**
 * Real weather lookup via Open-Meteo (no API key required): geocode the place
 * name, then read the current conditions. Server-executed backend tool.
 */
export const getWeather = tool({
  description:
    "Get the current weather for a place by name (city, town, region). Use this whenever the user asks about weather, temperature, or conditions somewhere.",
  inputSchema: z.object({
    location: z
      .string()
      .min(1)
      .describe("Place name to look up, e.g. 'Paris', 'Tokyo', 'New York'"),
  }),
  execute: async ({ location }, { abortSignal }): Promise<WeatherResult | WeatherError> => {
    try {
      const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
      geoUrl.searchParams.set("name", location);
      geoUrl.searchParams.set("count", "1");
      const geo = await fetch(geoUrl, { signal: abortSignal }).then((r) => r.json());
      const place = geo?.results?.[0];
      if (!place) return { error: `No location found for "${location}".` };

      const wxUrl = new URL("https://api.open-meteo.com/v1/forecast");
      wxUrl.searchParams.set("latitude", String(place.latitude));
      wxUrl.searchParams.set("longitude", String(place.longitude));
      wxUrl.searchParams.set(
        "current",
        "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day",
      );
      const wx = await fetch(wxUrl, { signal: abortSignal }).then((r) => r.json());
      const c = wx?.current;
      const units = wx?.current_units ?? {};
      if (!c) return { error: `Weather is unavailable for "${location}" right now.` };

      const code = Number(c.weather_code ?? 0);
      const parts = [place.name, place.admin1, place.country].filter(Boolean);
      return {
        location: parts.join(", "),
        temperature: c.temperature_2m,
        unit: units.temperature_2m ?? "°C",
        apparentTemperature: c.apparent_temperature,
        humidity: c.relative_humidity_2m,
        windSpeed: c.wind_speed_10m,
        windUnit: units.wind_speed_10m ?? "km/h",
        weatherCode: code,
        condition: WMO[code] ?? "Unknown",
        isDay: c.is_day === 1,
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw err;
      return { error: `Could not fetch weather for "${location}".` };
    }
  },
});
