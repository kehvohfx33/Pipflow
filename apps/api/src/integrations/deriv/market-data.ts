import { DerivClient } from './deriv-client';
import { DerivMessage } from './websocket';

export interface NormalizedSymbol {
  symbol: string;
  display_name: string;
  market: string;
  submarket: string;
  pip_size: number;
  is_trading_suspended: boolean;
  exchange_is_open: boolean;
}

interface ActiveSymbolsResponse extends DerivMessage {
  active_symbols?: Array<Record<string, unknown>>;
}

export const OFFICIAL_DERIV_SYMBOLS_CATALOG: NormalizedSymbol[] = [
  // Synthetic Indices - Continuous & 1s
  { symbol: 'R_10', display_name: 'Volatility 10 Index', market: 'synthetic_index', submarket: 'random_index', pip_size: 0.001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: '1HZ10V', display_name: 'Volatility 10 (1s) Index', market: 'synthetic_index', submarket: 'random_index', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'R_25', display_name: 'Volatility 25 Index', market: 'synthetic_index', submarket: 'random_index', pip_size: 0.001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: '1HZ25V', display_name: 'Volatility 25 (1s) Index', market: 'synthetic_index', submarket: 'random_index', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'R_50', display_name: 'Volatility 50 Index', market: 'synthetic_index', submarket: 'random_index', pip_size: 0.0001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: '1HZ50V', display_name: 'Volatility 50 (1s) Index', market: 'synthetic_index', submarket: 'random_index', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'R_75', display_name: 'Volatility 75 Index', market: 'synthetic_index', submarket: 'random_index', pip_size: 0.0001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: '1HZ75V', display_name: 'Volatility 75 (1s) Index', market: 'synthetic_index', submarket: 'random_index', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },
  { symbol: '1HZ90V', display_name: 'Volatility 90 (1s) Index', market: 'synthetic_index', submarket: 'random_index', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'R_100', display_name: 'Volatility 100 Index', market: 'synthetic_index', submarket: 'random_index', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },
  { symbol: '1HZ100V', display_name: 'Volatility 100 (1s) Index', market: 'synthetic_index', submarket: 'random_index', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },
  { symbol: '1HZ150V', display_name: 'Volatility 150 (1s) Index', market: 'synthetic_index', submarket: 'random_index', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },
  { symbol: '1HZ200V', display_name: 'Volatility 200 (1s) Index', market: 'synthetic_index', submarket: 'random_index', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },
  { symbol: '1HZ250V', display_name: 'Volatility 250 (1s) Index', market: 'synthetic_index', submarket: 'random_index', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },
  { symbol: '1HZ300V', display_name: 'Volatility 300 (1s) Index', market: 'synthetic_index', submarket: 'random_index', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },
  // Jump Indices
  { symbol: 'JD10', display_name: 'Jump 10 Index', market: 'synthetic_index', submarket: 'jump_index', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'JD25', display_name: 'Jump 25 Index', market: 'synthetic_index', submarket: 'jump_index', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'JD50', display_name: 'Jump 50 Index', market: 'synthetic_index', submarket: 'jump_index', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'JD75', display_name: 'Jump 75 Index', market: 'synthetic_index', submarket: 'jump_index', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'JD100', display_name: 'Jump 100 Index', market: 'synthetic_index', submarket: 'jump_index', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },
  // Crash & Boom
  { symbol: 'BOOM300N', display_name: 'Boom 300 Index', market: 'synthetic_index', submarket: 'crash_index', pip_size: 0.001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'BOOM500', display_name: 'Boom 500 Index', market: 'synthetic_index', submarket: 'crash_index', pip_size: 0.0001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'BOOM1000', display_name: 'Boom 1000 Index', market: 'synthetic_index', submarket: 'crash_index', pip_size: 0.0001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'CRASH300N', display_name: 'Crash 300 Index', market: 'synthetic_index', submarket: 'crash_index', pip_size: 0.001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'CRASH500', display_name: 'Crash 500 Index', market: 'synthetic_index', submarket: 'crash_index', pip_size: 0.0001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'CRASH1000', display_name: 'Crash 1000 Index', market: 'synthetic_index', submarket: 'crash_index', pip_size: 0.0001, is_trading_suspended: false, exchange_is_open: true },
  // Step & Range Break & Daily Reset
  { symbol: 'stpRNG', display_name: 'Step Index', market: 'synthetic_index', submarket: 'step_index', pip_size: 0.1, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'RDBULL', display_name: 'Bull Market Index', market: 'synthetic_index', submarket: 'random_daily', pip_size: 0.0001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'RDBEAR', display_name: 'Bear Market Index', market: 'synthetic_index', submarket: 'random_daily', pip_size: 0.0001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'RB100', display_name: 'Range Break 100 Index', market: 'synthetic_index', submarket: 'range_break', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'RB200', display_name: 'Range Break 200 Index', market: 'synthetic_index', submarket: 'range_break', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },

  // Forex Majors
  { symbol: 'frxEURUSD', display_name: 'EUR/USD', market: 'forex', submarket: 'major_pairs', pip_size: 0.00001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'frxGBPUSD', display_name: 'GBP/USD', market: 'forex', submarket: 'major_pairs', pip_size: 0.00001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'frxUSDJPY', display_name: 'USD/JPY', market: 'forex', submarket: 'major_pairs', pip_size: 0.001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'frxUSDCHF', display_name: 'USD/CHF', market: 'forex', submarket: 'major_pairs', pip_size: 0.00001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'frxAUDUSD', display_name: 'AUD/USD', market: 'forex', submarket: 'major_pairs', pip_size: 0.00001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'frxUSDCAD', display_name: 'USD/CAD', market: 'forex', submarket: 'major_pairs', pip_size: 0.00001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'frxNZDUSD', display_name: 'NZD/USD', market: 'forex', submarket: 'major_pairs', pip_size: 0.00001, is_trading_suspended: false, exchange_is_open: true },
  // Forex Minors / Crosses
  { symbol: 'frxEURGBP', display_name: 'EUR/GBP', market: 'forex', submarket: 'minor_pairs', pip_size: 0.00001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'frxEURJPY', display_name: 'EUR/JPY', market: 'forex', submarket: 'minor_pairs', pip_size: 0.001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'frxGBPJPY', display_name: 'GBP/JPY', market: 'forex', submarket: 'minor_pairs', pip_size: 0.001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'frxAUDJPY', display_name: 'AUD/JPY', market: 'forex', submarket: 'minor_pairs', pip_size: 0.001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'frxEURAUD', display_name: 'EUR/AUD', market: 'forex', submarket: 'minor_pairs', pip_size: 0.00001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'frxEURCAD', display_name: 'EUR/CAD', market: 'forex', submarket: 'minor_pairs', pip_size: 0.00001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'frxEURCHF', display_name: 'EUR/CHF', market: 'forex', submarket: 'minor_pairs', pip_size: 0.00001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'frxGBPAUD', display_name: 'GBP/AUD', market: 'forex', submarket: 'minor_pairs', pip_size: 0.00001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'frxGBPCAD', display_name: 'GBP/CAD', market: 'forex', submarket: 'minor_pairs', pip_size: 0.00001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'frxGBPCHF', display_name: 'GBP/CHF', market: 'forex', submarket: 'minor_pairs', pip_size: 0.00001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'frxAUDCAD', display_name: 'AUD/CAD', market: 'forex', submarket: 'minor_pairs', pip_size: 0.00001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'frxAUDNZD', display_name: 'AUD/NZD', market: 'forex', submarket: 'minor_pairs', pip_size: 0.00001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'frxCADJPY', display_name: 'CAD/JPY', market: 'forex', submarket: 'minor_pairs', pip_size: 0.001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'frxCHFJPY', display_name: 'CHF/JPY', market: 'forex', submarket: 'minor_pairs', pip_size: 0.001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'frxNZDJPY', display_name: 'NZD/JPY', market: 'forex', submarket: 'minor_pairs', pip_size: 0.001, is_trading_suspended: false, exchange_is_open: true },

  // Metals & Commodities
  { symbol: 'frxXAUUSD', display_name: 'Gold / USD (XAU/USD)', market: 'commodities', submarket: 'metals', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'frxXAGUSD', display_name: 'Silver / USD (XAG/USD)', market: 'commodities', submarket: 'metals', pip_size: 0.001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'frxXPDUSD', display_name: 'Palladium / USD (XPD/USD)', market: 'commodities', submarket: 'metals', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'frxXPTUSD', display_name: 'Platinum / USD (XPT/USD)', market: 'commodities', submarket: 'metals', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },

  // Cryptocurrencies
  { symbol: 'cryBTCUSD', display_name: 'BTC/USD (Bitcoin)', market: 'cryptocurrency', submarket: 'non_stable_coin', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'cryETHUSD', display_name: 'ETH/USD (Ethereum)', market: 'cryptocurrency', submarket: 'non_stable_coin', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },

  // Basket Indices
  { symbol: 'WLDUSD', display_name: 'USD Basket Index', market: 'forex', submarket: 'forex_basket', pip_size: 0.001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'WLDEUR', display_name: 'EUR Basket Index', market: 'forex', submarket: 'forex_basket', pip_size: 0.001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'WLDGBP', display_name: 'GBP Basket Index', market: 'forex', submarket: 'forex_basket', pip_size: 0.001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'WLDAUD', display_name: 'AUD Basket Index', market: 'forex', submarket: 'forex_basket', pip_size: 0.001, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'WLDXAU', display_name: 'Gold Basket Index', market: 'commodities', submarket: 'commodity_basket', pip_size: 0.001, is_trading_suspended: false, exchange_is_open: true },

  // Global Stock Indices
  { symbol: 'OTC_SPC', display_name: 'US 500 (S&P 500)', market: 'indices', submarket: 'americas', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'OTC_NDX', display_name: 'US Tech 100 (NASDAQ)', market: 'indices', submarket: 'americas', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'OTC_DJI', display_name: 'Wall Street 30 (Dow)', market: 'indices', submarket: 'americas', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'OTC_FTSE', display_name: 'UK 100 (FTSE)', market: 'indices', submarket: 'europe_africa', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'OTC_GDAXI', display_name: 'Germany 40 (DAX)', market: 'indices', submarket: 'europe_africa', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true },
  { symbol: 'OTC_N225', display_name: 'Japan 225 (Nikkei)', market: 'indices', submarket: 'asia_oceania', pip_size: 0.01, is_trading_suspended: false, exchange_is_open: true }
];

export async function fetchActiveSymbols(client: DerivClient): Promise<NormalizedSymbol[]> {
  await client.ensureConnected();
  const res = await client.socket.send<ActiveSymbolsResponse>(
    { active_symbols: 'brief' },
    4500
  );

  const list = res.active_symbols ?? [];
  return list
    .map((item) => ({
      symbol: String(item.underlying_symbol ?? item.symbol ?? ''),
      display_name: String(item.underlying_symbol_name ?? item.display_name ?? item.symbol ?? ''),
      market: String(item.market ?? 'synthetic_index'),
      submarket: String(item.submarket ?? ''),
      pip_size: Number(item.pip_size ?? item.pip ?? 0.01),
      is_trading_suspended: Boolean(item.is_trading_suspended ?? false),
      exchange_is_open: Boolean(item.exchange_is_open ?? true)
    }))
    .filter((s) => s.symbol.length > 0);
}

export async function subscribeTicks(client: DerivClient, symbol: string) {
  return client.request({ ticks: symbol, subscribe: 1 });
}

export async function forgetSubscription(client: DerivClient, subscriptionId: string) {
  return client.request({ forget: subscriptionId });
}
