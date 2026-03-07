/** Country 도구 — 국가 정보 조회. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

interface CountryInfo {
  name: string; code: string; alpha3: string; dial: string; currency: string; continent: string; capital: string;
}

const COUNTRIES: CountryInfo[] = [
  { name: "United States", code: "US", alpha3: "USA", dial: "+1", currency: "USD", continent: "North America", capital: "Washington D.C." },
  { name: "South Korea", code: "KR", alpha3: "KOR", dial: "+82", currency: "KRW", continent: "Asia", capital: "Seoul" },
  { name: "Japan", code: "JP", alpha3: "JPN", dial: "+81", currency: "JPY", continent: "Asia", capital: "Tokyo" },
  { name: "China", code: "CN", alpha3: "CHN", dial: "+86", currency: "CNY", continent: "Asia", capital: "Beijing" },
  { name: "United Kingdom", code: "GB", alpha3: "GBR", dial: "+44", currency: "GBP", continent: "Europe", capital: "London" },
  { name: "Germany", code: "DE", alpha3: "DEU", dial: "+49", currency: "EUR", continent: "Europe", capital: "Berlin" },
  { name: "France", code: "FR", alpha3: "FRA", dial: "+33", currency: "EUR", continent: "Europe", capital: "Paris" },
  { name: "Italy", code: "IT", alpha3: "ITA", dial: "+39", currency: "EUR", continent: "Europe", capital: "Rome" },
  { name: "Spain", code: "ES", alpha3: "ESP", dial: "+34", currency: "EUR", continent: "Europe", capital: "Madrid" },
  { name: "Canada", code: "CA", alpha3: "CAN", dial: "+1", currency: "CAD", continent: "North America", capital: "Ottawa" },
  { name: "Australia", code: "AU", alpha3: "AUS", dial: "+61", currency: "AUD", continent: "Oceania", capital: "Canberra" },
  { name: "Brazil", code: "BR", alpha3: "BRA", dial: "+55", currency: "BRL", continent: "South America", capital: "Brasilia" },
  { name: "India", code: "IN", alpha3: "IND", dial: "+91", currency: "INR", continent: "Asia", capital: "New Delhi" },
  { name: "Russia", code: "RU", alpha3: "RUS", dial: "+7", currency: "RUB", continent: "Europe", capital: "Moscow" },
  { name: "Mexico", code: "MX", alpha3: "MEX", dial: "+52", currency: "MXN", continent: "North America", capital: "Mexico City" },
  { name: "Indonesia", code: "ID", alpha3: "IDN", dial: "+62", currency: "IDR", continent: "Asia", capital: "Jakarta" },
  { name: "Turkey", code: "TR", alpha3: "TUR", dial: "+90", currency: "TRY", continent: "Europe", capital: "Ankara" },
  { name: "Saudi Arabia", code: "SA", alpha3: "SAU", dial: "+966", currency: "SAR", continent: "Asia", capital: "Riyadh" },
  { name: "Switzerland", code: "CH", alpha3: "CHE", dial: "+41", currency: "CHF", continent: "Europe", capital: "Bern" },
  { name: "Netherlands", code: "NL", alpha3: "NLD", dial: "+31", currency: "EUR", continent: "Europe", capital: "Amsterdam" },
  { name: "Sweden", code: "SE", alpha3: "SWE", dial: "+46", currency: "SEK", continent: "Europe", capital: "Stockholm" },
  { name: "Poland", code: "PL", alpha3: "POL", dial: "+48", currency: "PLN", continent: "Europe", capital: "Warsaw" },
  { name: "Thailand", code: "TH", alpha3: "THA", dial: "+66", currency: "THB", continent: "Asia", capital: "Bangkok" },
  { name: "Singapore", code: "SG", alpha3: "SGP", dial: "+65", currency: "SGD", continent: "Asia", capital: "Singapore" },
  { name: "Vietnam", code: "VN", alpha3: "VNM", dial: "+84", currency: "VND", continent: "Asia", capital: "Hanoi" },
  { name: "Taiwan", code: "TW", alpha3: "TWN", dial: "+886", currency: "TWD", continent: "Asia", capital: "Taipei" },
  { name: "Hong Kong", code: "HK", alpha3: "HKG", dial: "+852", currency: "HKD", continent: "Asia", capital: "Hong Kong" },
  { name: "New Zealand", code: "NZ", alpha3: "NZL", dial: "+64", currency: "NZD", continent: "Oceania", capital: "Wellington" },
  { name: "Argentina", code: "AR", alpha3: "ARG", dial: "+54", currency: "ARS", continent: "South America", capital: "Buenos Aires" },
  { name: "South Africa", code: "ZA", alpha3: "ZAF", dial: "+27", currency: "ZAR", continent: "Africa", capital: "Pretoria" },
  { name: "Egypt", code: "EG", alpha3: "EGY", dial: "+20", currency: "EGP", continent: "Africa", capital: "Cairo" },
  { name: "Nigeria", code: "NG", alpha3: "NGA", dial: "+234", currency: "NGN", continent: "Africa", capital: "Abuja" },
  { name: "Kenya", code: "KE", alpha3: "KEN", dial: "+254", currency: "KES", continent: "Africa", capital: "Nairobi" },
  { name: "Israel", code: "IL", alpha3: "ISR", dial: "+972", currency: "ILS", continent: "Asia", capital: "Jerusalem" },
  { name: "UAE", code: "AE", alpha3: "ARE", dial: "+971", currency: "AED", continent: "Asia", capital: "Abu Dhabi" },
  { name: "Portugal", code: "PT", alpha3: "PRT", dial: "+351", currency: "EUR", continent: "Europe", capital: "Lisbon" },
  { name: "Norway", code: "NO", alpha3: "NOR", dial: "+47", currency: "NOK", continent: "Europe", capital: "Oslo" },
  { name: "Denmark", code: "DK", alpha3: "DNK", dial: "+45", currency: "DKK", continent: "Europe", capital: "Copenhagen" },
  { name: "Finland", code: "FI", alpha3: "FIN", dial: "+358", currency: "EUR", continent: "Europe", capital: "Helsinki" },
  { name: "Ireland", code: "IE", alpha3: "IRL", dial: "+353", currency: "EUR", continent: "Europe", capital: "Dublin" },
];

export class CountryTool extends Tool {
  readonly name = "country";
  readonly category = "data" as const;
  readonly description = "Country info utilities: lookup, search, by_dial_code, by_currency, by_continent, list.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["lookup", "search", "by_dial_code", "by_currency", "by_continent", "list"], description: "Operation" },
      code: { type: "string", description: "Country code (ISO 3166-1 alpha-2 or alpha-3)" },
      query: { type: "string", description: "Search query (name or partial)" },
      dial_code: { type: "string", description: "Dial code (e.g. +82)" },
      currency: { type: "string", description: "Currency code (e.g. USD)" },
      continent: { type: "string", description: "Continent name" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "lookup");

    switch (action) {
      case "lookup": {
        const code = String(params.code || "").toUpperCase();
        const found = COUNTRIES.find((c) => c.code === code || c.alpha3 === code);
        return found ? JSON.stringify(found) : JSON.stringify({ error: `country not found: ${code}` });
      }
      case "search": {
        const q = String(params.query || "").toLowerCase();
        const results = COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
        return JSON.stringify({ count: results.length, results });
      }
      case "by_dial_code": {
        const dial = String(params.dial_code || "");
        const results = COUNTRIES.filter((c) => c.dial === dial);
        return JSON.stringify({ count: results.length, results });
      }
      case "by_currency": {
        const cur = String(params.currency || "").toUpperCase();
        const results = COUNTRIES.filter((c) => c.currency === cur);
        return JSON.stringify({ count: results.length, results });
      }
      case "by_continent": {
        const cont = String(params.continent || "").toLowerCase();
        const results = COUNTRIES.filter((c) => c.continent.toLowerCase() === cont);
        return JSON.stringify({ count: results.length, results });
      }
      case "list": {
        return JSON.stringify({ count: COUNTRIES.length, countries: COUNTRIES.map((c) => ({ code: c.code, name: c.name })) });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }
}
