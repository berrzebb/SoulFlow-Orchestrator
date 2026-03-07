/** Currency 도구 — 통화 정보/포맷/정적 환율 변환. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

interface CurrencyInfo { code: string; name: string; symbol: string; decimals: number; }

const CURRENCIES: CurrencyInfo[] = [
  { code: "USD", name: "US Dollar", symbol: "$", decimals: 2 },
  { code: "EUR", name: "Euro", symbol: "\u20AC", decimals: 2 },
  { code: "GBP", name: "British Pound", symbol: "\u00A3", decimals: 2 },
  { code: "JPY", name: "Japanese Yen", symbol: "\u00A5", decimals: 0 },
  { code: "KRW", name: "South Korean Won", symbol: "\u20A9", decimals: 0 },
  { code: "CNY", name: "Chinese Yuan", symbol: "\u00A5", decimals: 2 },
  { code: "INR", name: "Indian Rupee", symbol: "\u20B9", decimals: 2 },
  { code: "CAD", name: "Canadian Dollar", symbol: "CA$", decimals: 2 },
  { code: "AUD", name: "Australian Dollar", symbol: "A$", decimals: 2 },
  { code: "CHF", name: "Swiss Franc", symbol: "CHF", decimals: 2 },
  { code: "HKD", name: "Hong Kong Dollar", symbol: "HK$", decimals: 2 },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$", decimals: 2 },
  { code: "SEK", name: "Swedish Krona", symbol: "kr", decimals: 2 },
  { code: "NOK", name: "Norwegian Krone", symbol: "kr", decimals: 2 },
  { code: "DKK", name: "Danish Krone", symbol: "kr", decimals: 2 },
  { code: "NZD", name: "New Zealand Dollar", symbol: "NZ$", decimals: 2 },
  { code: "MXN", name: "Mexican Peso", symbol: "$", decimals: 2 },
  { code: "BRL", name: "Brazilian Real", symbol: "R$", decimals: 2 },
  { code: "RUB", name: "Russian Ruble", symbol: "\u20BD", decimals: 2 },
  { code: "TRY", name: "Turkish Lira", symbol: "\u20BA", decimals: 2 },
  { code: "ZAR", name: "South African Rand", symbol: "R", decimals: 2 },
  { code: "PLN", name: "Polish Zloty", symbol: "z\u0142", decimals: 2 },
  { code: "THB", name: "Thai Baht", symbol: "\u0E3F", decimals: 2 },
  { code: "TWD", name: "Taiwan Dollar", symbol: "NT$", decimals: 0 },
  { code: "IDR", name: "Indonesian Rupiah", symbol: "Rp", decimals: 0 },
  { code: "SAR", name: "Saudi Riyal", symbol: "SR", decimals: 2 },
  { code: "AED", name: "UAE Dirham", symbol: "AED", decimals: 2 },
  { code: "ILS", name: "Israeli Shekel", symbol: "\u20AA", decimals: 2 },
  { code: "VND", name: "Vietnamese Dong", symbol: "\u20AB", decimals: 0 },
  { code: "PHP", name: "Philippine Peso", symbol: "\u20B1", decimals: 2 },
  { code: "MYR", name: "Malaysian Ringgit", symbol: "RM", decimals: 2 },
  { code: "CZK", name: "Czech Koruna", symbol: "K\u010D", decimals: 2 },
  { code: "CLP", name: "Chilean Peso", symbol: "$", decimals: 0 },
  { code: "ARS", name: "Argentine Peso", symbol: "$", decimals: 2 },
  { code: "COP", name: "Colombian Peso", symbol: "$", decimals: 0 },
  { code: "EGP", name: "Egyptian Pound", symbol: "E\u00A3", decimals: 2 },
  { code: "NGN", name: "Nigerian Naira", symbol: "\u20A6", decimals: 2 },
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh", decimals: 2 },
  { code: "BTC", name: "Bitcoin", symbol: "\u20BF", decimals: 8 },
  { code: "ETH", name: "Ethereum", symbol: "\u039E", decimals: 8 },
];

// 정적 환율 (USD 기준, 참고용 근사값)
const RATES_TO_USD: Record<string, number> = {
  USD: 1, EUR: 0.92, GBP: 0.79, JPY: 149.5, KRW: 1320, CNY: 7.24,
  INR: 83.1, CAD: 1.36, AUD: 1.53, CHF: 0.88, HKD: 7.82, SGD: 1.34,
  SEK: 10.4, NOK: 10.5, DKK: 6.87, NZD: 1.62, MXN: 17.1, BRL: 4.97,
  RUB: 91.5, TRY: 30.2, ZAR: 18.6, PLN: 4.02, THB: 35.1, TWD: 31.4,
  IDR: 15600, SAR: 3.75, AED: 3.67, ILS: 3.63, VND: 24500, PHP: 55.7,
  MYR: 4.65, CZK: 22.8, CLP: 880, ARS: 350, COP: 3950, EGP: 30.9,
  NGN: 780, KES: 153, BTC: 0.000024, ETH: 0.00042,
};

export class CurrencyTool extends Tool {
  readonly name = "currency";
  readonly category = "data" as const;
  readonly description = "Currency utilities: info, format, convert, list, compare, parse.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["info", "format", "convert", "list", "compare", "parse"], description: "Operation" },
      code: { type: "string", description: "Currency code (e.g. USD)" },
      amount: { type: "number", description: "Amount to format/convert" },
      from: { type: "string", description: "Source currency (convert)" },
      to: { type: "string", description: "Target currency (convert)" },
      text: { type: "string", description: "Text with currency to parse" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "info");

    switch (action) {
      case "info": {
        const code = String(params.code || "USD").toUpperCase();
        const info = CURRENCIES.find((c) => c.code === code);
        if (!info) return JSON.stringify({ error: `unknown currency: ${code}` });
        return JSON.stringify({ ...info, rate_to_usd: RATES_TO_USD[code] });
      }
      case "format": {
        const code = String(params.code || "USD").toUpperCase();
        const amount = Number(params.amount ?? 0);
        const info = CURRENCIES.find((c) => c.code === code);
        if (!info) return JSON.stringify({ error: `unknown currency: ${code}` });
        const formatted = amount.toFixed(info.decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        return JSON.stringify({ formatted: `${info.symbol}${formatted}`, code, amount });
      }
      case "convert": {
        const from = String(params.from || "USD").toUpperCase();
        const to = String(params.to || "EUR").toUpperCase();
        const amount = Number(params.amount ?? 1);
        const from_rate = RATES_TO_USD[from];
        const to_rate = RATES_TO_USD[to];
        if (!from_rate || !to_rate) return JSON.stringify({ error: `unknown currency: ${!from_rate ? from : to}` });
        const in_usd = amount / from_rate;
        const result = in_usd * to_rate;
        const to_info = CURRENCIES.find((c) => c.code === to);
        const decimals = to_info?.decimals ?? 2;
        return JSON.stringify({
          from, to, amount,
          result: Math.round(result * 10 ** decimals) / 10 ** decimals,
          rate: Math.round((to_rate / from_rate) * 1e6) / 1e6,
          note: "static reference rates, not live",
        });
      }
      case "list": {
        return JSON.stringify({ count: CURRENCIES.length, currencies: CURRENCIES.map((c) => ({ code: c.code, name: c.name, symbol: c.symbol })) });
      }
      case "compare": {
        const from = String(params.from || "USD").toUpperCase();
        const to = String(params.to || "EUR").toUpperCase();
        const r1 = RATES_TO_USD[from], r2 = RATES_TO_USD[to];
        if (!r1 || !r2) return JSON.stringify({ error: "unknown currency" });
        const rate = r2 / r1;
        return JSON.stringify({ from, to, rate: Math.round(rate * 1e6) / 1e6, inverse: Math.round((1 / rate) * 1e6) / 1e6 });
      }
      case "parse": {
        const text = String(params.text || "");
        const re = /([A-Z]{3})\s*([\d,.]+)|([^\d\s])(\d[\d,.]*)/g;
        const found: { currency?: string; amount: number; symbol?: string }[] = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          if (m[1]) found.push({ currency: m[1], amount: Number(m[2].replace(/,/g, "")) });
          else if (m[3]) {
            const sym = m[3];
            const cur = CURRENCIES.find((c) => c.symbol === sym);
            found.push({ symbol: sym, currency: cur?.code, amount: Number(m[4].replace(/,/g, "")) });
          }
        }
        return JSON.stringify({ found });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }
}
