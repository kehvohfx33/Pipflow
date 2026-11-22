# Deriv Application Archives Mapping

All original root-level `.zip` archives remain preserved untouched in the repository root. The four canonical Deriv application archives have been extracted into dedicated modules under `apps/` and integrated into the unified **Pipflowtrade.site** workspace.

## 1. Root Archives Inventory

| Root Archive | Size | Extracted Location | Role | Notes |
|---|---|---|---|---|
| `BOT.zip` | 9,113,259 B | `apps/deriv-bot/` | Primary Deriv Bot Builder source (1,379 files) | Preserved untouched in root |
| `accumulators-app (1).zip` | 639,457 B | `apps/deriv-accumulators/` | Primary Accumulators source (146 files) | Preserved untouched in root (no file named `Accumu.zip` exists in repo; this is the active Accumulators archive) |
| `digits-no-chart-app.zip` | 588,628 B | `apps/deriv-digits/` | Primary Digits (No-Chart) source (142 files) | Preserved untouched in root |
| `rise-fall-app.zip` | 641,473 B | `apps/deriv-rise-fall/` | Primary Rise / Fall source (148 files) | Preserved untouched in root |
| `Bot_app.zip` | 9,113,249 B | Reference archive (unextracted duplicate of Deriv Bot) | Alternate Bot snapshot | Preserved untouched in root |
| `accumulators-app.zip` | 639,455 B | Reference archive (unextracted duplicate of Accumulators) | Alternate Accumulators snapshot | Preserved untouched in root |

## 2. Extracted Modules & Unified Pipflowtrade.site Integration

| Source App | Extracted Module | Key Original Components & Chart Config | Unified Route / Section | Unified Components & Services | Integration Status |
|---|---|---|---|---|---|
| **Deriv Bot** | `apps/deriv-bot/` | `src/pages/bot-builder/`, `src/xml/*.xml`, Blockly workspace blocks (`deriv_trade_definition`, `purchase_conditions`), `@deriv-com/smartcharts-champion`, Rsbuild config | `#/?tab=bot_builder` & `#/?tab=freebots` | `BotBuilderPage.tsx`, `TradingBotsPage.tsx`, `DerivBlocklyWorkspace.tsx`, `apps/web/src/data/bot-xml/*.xml` (16 XML templates), `/api/bots/*` | Integrated with shared Auth, Blockly XML loader/saver, live bot runner & DB persistence |
| **Deriv Accumulators** | `apps/deriv-accumulators/` | `components/accumulator-view.tsx`, `components/custom/smart-chart.tsx`, `lib/chart-markers.ts`, `hooks/use-accumulator-trading.ts`, SmartCharts `@deriv-com/smartcharts-champion` with `ToolbarWidget`, `ChartMode`, `StudyLegend`, `Views`, `DrawTools`, `Share`, `barriers`, `contracts_array` | `#/?tab=accumulators` (also accessible via Unified DTrader / Terminal) | `AccumulatorsPage.tsx`, `SmartChartWrapper.tsx`, `apps/web/src/utils/chartMarkers.ts`, `PositionsCards.tsx`, `/api/deriv/proposal`, `/api/orders` | Integrated with genuine SmartCharts, live ACCU high/low barrier shading (`ChartBarrier`), and `contracts_array` contract markers |
| **Deriv Digits (No Chart)** | `apps/deriv-digits/` | `components/digits-view.tsx`, `components/digit-stats-bar.tsx`, `components/current-tick-display.tsx`, `components/trade-controls.tsx`, `hooks/use-digits-trading.ts` (intentional no-chart tick frequency architecture) | `#/?tab=digits` & `#/?tab=analysistool` | `DigitsPage.tsx`, `DigitStatsPanel.tsx`, `AnalysisToolPage.tsx`, `PositionsCards.tsx`, `derivBrowserWs.ts` | Integrated with live 0–9 last-digit heatmap, configurable tick window (50–1000 ticks), Even/Odd, Over/Under, Matches/Differs proposals & execution |
| **Deriv Rise / Fall** | `apps/deriv-rise-fall/` | `components/rise-fall-view.tsx`, `components/rise-fall-chart.tsx`, `components/custom/smart-chart.tsx`, `lib/chart-markers.ts`, `hooks/use-rise-fall-trading.ts` (`CALL`/`CALLE`/`PUT`/`PUTE`, Duration & GMT End Time) | `#/?tab=rise_fall` | `RiseFallPage.tsx`, `SmartChartWrapper.tsx`, `apps/web/src/utils/chartMarkers.ts`, `PositionsCards.tsx`, `/api/deriv/proposal`, `/api/orders` | Integrated with genuine SmartCharts, `contracts_array` tick/non-tick contract markers, Allow Equals, Duration & GMT End Time selector |

## 3. Chart Asset & Engine Parity

- `@deriv-com/smartcharts-champion` static assets are copied into `public/` via `scripts/copy-smartcharts-assets.js` (`postinstall` & `prebuild`).
- `SmartChartWrapper.tsx` configures `setSmartChartsPublicPath('/')`, live `getQuotes`, `subscribeQuotes`, and `unsubscribeQuotes` against Official Deriv WebSockets (`wss://ws.derivws.com/websockets/v3`), preserving the genuine SmartCharts toolbar (`ChartMode`, `StudyLegend`, `Views`, `DrawTools`, `Share`), `ChartTitle`, `barriers`, and `contracts_array`.
- Dedicated multi-asset MT5 candlestick mode (`MT5TradingView.tsx` using `lightweight-charts`) remains preserved separately under `#/?tab=trading_view` and `#/?tab=charts`.
