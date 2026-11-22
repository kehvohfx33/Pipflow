import type { VirtualOrderItem } from '../components/trading/OrderTicket';

export type ContractMarkerType = 'TickContract' | 'NonTickContract' | 'AccumulatorContract';
export type MarkerDirection = 'up' | 'down';

export interface MarkerPoint {
  epoch: number;
  quote?: number | null;
  type: string;
  direction?: MarkerDirection;
  text?: string;
  textType?: string;
  displayOffsetY?: number;
  color?: string;
}

export interface ContractMarker {
  type: ContractMarkerType;
  markers: MarkerPoint[];
  props: {
    isProfit: boolean;
    isRunning: boolean;
    contractMarkerLeftPadding: number;
    markerLabel: string | null;
  };
  direction: MarkerDirection;
  profitAndLossText: string | null;
  currentEpoch: number | null;
}

const ACCUMULATOR_TYPES = new Set(['ACCU']);
const UP_CONTRACTS = new Set(['CALL', 'CALLE', 'MULTUP']);
const DOWN_CONTRACTS = new Set(['PUT', 'PUTE', 'MULTDOWN']);

function getMarkerContractType(contractType: string, tickCount: number): ContractMarkerType {
  if (ACCUMULATOR_TYPES.has(contractType)) {
    return 'AccumulatorContract';
  }
  return tickCount > 0 ? 'TickContract' : 'NonTickContract';
}

function getMarkerDirection(contractType: string, side?: string): MarkerDirection {
  if (UP_CONTRACTS.has(contractType)) return 'up';
  if (DOWN_CONTRACTS.has(contractType)) return 'down';
  if (side === 'SELL') return 'down';
  return 'up';
}

function formatProfitLossText(profit: number, currency = 'USD'): string | null {
  if (!Number.isFinite(profit)) return null;
  const sign = profit >= 0 ? '+' : '-';
  return `${sign}${Math.abs(profit).toFixed(2)} ${currency}`;
}

export interface LiveContractSnapshot {
  currentSpot?: number;
  profit?: number;
  bidPrice?: number;
}

export function calculateContractMarkersFromOrders(params: {
  orders: VirtualOrderItem[];
  activeSymbol?: string;
  liveContracts?: Record<string, LiveContractSnapshot>;
  livePricesMap?: Record<string, number>;
  isMobile?: boolean;
  currency?: string;
}): ContractMarker[] {
  const {
    orders,
    activeSymbol,
    liveContracts = {},
    livePricesMap = {},
    isMobile = false,
    currency = 'USD'
  } = params;

  if (!activeSymbol || orders.length === 0) return [];

  const filtered = orders.filter((o) => o.symbol === activeSymbol);
  if (filtered.length === 0) return [];

  const sorted = [...filtered].sort((a, b) => {
    const aMs = a.opened_at ? new Date(a.opened_at).getTime() : 0;
    const bMs = b.opened_at ? new Date(b.opened_at).getTime() : 0;
    return bMs - aMs;
  });

  const contractMarkerLeftPadding = isMobile ? 10 : 100;
  const nowEpoch = Math.floor(Date.now() / 1000);
  const result: ContractMarker[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const order = sorted[i];
    const isLastContract = i === 0;
    const contractType = String(order.contract_type || (order.side === 'SELL' ? 'PUT' : 'CALL')).toUpperCase();
    const meta = (order as VirtualOrderItem & { contract_meta?: Record<string, unknown> }).contract_meta || {};
    const tickCount = Number(meta.tick_count ?? (meta.durationUnit === 't' ? meta.duration : 0) ?? 0);
    const type = getMarkerContractType(contractType, tickCount);
    const direction = getMarkerDirection(contractType, order.side);

    const isRunning = order.status === 'OPEN';
    const liveSnap = liveContracts[order.id];
    const entryQuote = Number(order.entry_price ?? 0);
    const currentQuote = Number(liveSnap?.currentSpot ?? livePricesMap[order.symbol] ?? entryQuote);
    const closedExitQuote = order.exit_price !== null && order.exit_price !== undefined ? Number(order.exit_price) : null;

    let profit = Number(order.pnl ?? 0);
    if (isRunning) {
      if (liveSnap?.profit !== undefined && Number.isFinite(Number(liveSnap.profit))) {
        profit = Number(liveSnap.profit);
      } else if (entryQuote > 0 && currentQuote > 0) {
        const pct = order.side === 'BUY' ? (currentQuote - entryQuote) / entryQuote : (entryQuote - currentQuote) / entryQuote;
        profit = Number((Number(order.stake) * pct * 100).toFixed(2));
      }
    }

    const profitAndLossText = formatProfitLossText(profit, currency);
    const isProfit = profit >= 0;

    const openedMs = order.opened_at ? new Date(order.opened_at).getTime() : Date.now();
    const dateStartEpoch = Number.isFinite(openedMs) ? Math.floor(openedMs / 1000) : nowEpoch;
    const closedMs = order.closed_at ? new Date(order.closed_at).getTime() : NaN;
    const exitEpoch = Number.isFinite(closedMs) ? Math.floor(closedMs / 1000) : dateStartEpoch + Math.max(1, tickCount || 5);
    const expiryEpoch = Number(meta.date_expiry ?? (tickCount > 0 ? dateStartEpoch + tickCount : dateStartEpoch + 60));

    const markers: MarkerPoint[] = [];
    if (entryQuote > 0) {
      markers.push({
        epoch: dateStartEpoch,
        quote: entryQuote,
        type: 'entrySpot',
        direction
      });
    }

    const isAccumulator = type === 'AccumulatorContract';
    const isTickContract = type === 'TickContract';

    if (!isAccumulator) {
      if (!isRunning) {
        if (closedExitQuote !== null) {
          markers.push({
            epoch: exitEpoch,
            quote: closedExitQuote,
            type: 'exitSpot',
            direction
          });
          if (profitAndLossText !== null) {
            const exitAboveEntry = entryQuote > 0 ? closedExitQuote >= entryQuote : true;
            markers.push({
              epoch: exitEpoch,
              quote: closedExitQuote,
              type: 'profitAndLossLabel',
              direction,
              displayOffsetY: exitAboveEntry ? -24 : 24
            });
          }
        }
      } else {
        if (entryQuote > 0) {
          markers.push({
            epoch: dateStartEpoch,
            quote: entryQuote,
            type: 'startTimeCollapsed',
            direction
          });
        }
        if (isLastContract) {
          markers.push({
            epoch: dateStartEpoch,
            ...(entryQuote > 0 ? { quote: entryQuote } : {}),
            type: 'startTime',
            direction
          });
        }
        if (entryQuote > 0) {
          const tickPassed = Math.min(tickCount || 1, Math.max(0, nowEpoch - dateStartEpoch));
          markers.push({
            epoch: dateStartEpoch,
            quote: entryQuote,
            type: 'contractMarker',
            direction,
            ...(isTickContract ? { text: `${tickPassed}/${tickCount}`, textType: 'counter' } : {})
          });
        }
        markers.push({
          epoch: expiryEpoch,
          quote: entryQuote || 0,
          type: 'exitTimeCollapsed',
          direction
        });
      }
    } else if (!isRunning) {
      if (closedExitQuote !== null) {
        markers.push({
          epoch: exitEpoch,
          quote: closedExitQuote,
          type: 'exitSpot',
          direction
        });
        if (profitAndLossText !== null) {
          const exitAboveEntry = entryQuote > 0 ? closedExitQuote >= entryQuote : true;
          markers.push({
            epoch: exitEpoch,
            quote: closedExitQuote,
            type: 'profitAndLossLabel',
            direction,
            displayOffsetY: exitAboveEntry ? -24 : 24
          });
        }
      }
    } else if (isLastContract) {
      markers.push({
        epoch: dateStartEpoch,
        quote: entryQuote || 0,
        type: 'startTime',
        direction
      });
    }

    result.push({
      type,
      markers,
      props: {
        isProfit,
        isRunning,
        contractMarkerLeftPadding,
        markerLabel: null
      },
      direction,
      profitAndLossText,
      currentEpoch: nowEpoch
    });
  }

  return result;
}
