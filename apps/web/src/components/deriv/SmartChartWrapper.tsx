import React, { Component, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChartMode,
  ChartTitle,
  DrawTools,
  Share,
  setSmartChartsPublicPath,
  SmartChart,
  StudyLegend,
  ToolbarWidget,
  Views
} from '@deriv-com/smartcharts-champion';
import '@deriv-com/smartcharts-champion/dist/smartcharts.css';
import {
  fetchDerivSmartChartData,
  sendPublicDerivRawRequest,
  subscribeSmartChartsQuotes,
  unsubscribeSmartChartsQuotes
} from '../../services/derivBrowserWs';
import { useAuth } from '../../contexts/AuthContext';

setSmartChartsPublicPath('/');

export interface ChartBarrier {
  shade?: string;
  color?: string;
  shadeColor?: string;
  foregroundColor?: string;
  high?: number | string;
  low?: number | string;
  relative?: boolean;
  draggable?: boolean;
  hideBarrierLine?: boolean;
  hideOffscreenBarrier?: boolean;
  hideOffscreenLine?: boolean;
  hidePriceLabel?: boolean;
}

interface SmartChartErrorBoundaryState {
  hasError: boolean;
}

class SmartChartErrorBoundary extends Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  SmartChartErrorBoundaryState
> {
  constructor(props: { fallback: React.ReactNode; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

interface SmartChartWrapperProps {
  chartId?: string;
  symbol: string;
  onSymbolChange?: (symbol: string) => void;
  defaultGranularity?: number;
  barriers?: ChartBarrier[];
  contractsArray?: unknown[];
  heightClass?: string;
  fallbackSpot?: number;
}

export const SmartChartWrapper: React.FC<SmartChartWrapperProps> = ({
  chartId = 'pipflow-smartchart',
  symbol,
  onSymbolChange,
  defaultGranularity = 0,
  barriers,
  contractsArray,
  heightClass = 'h-[420px] sm:h-[500px]',
  fallbackSpot
}) => {
  const { darkTheme } = useAuth();
  const [chartType, setChartType] = useState<string>('line');
  const [granularity, setGranularity] = useState<number>(defaultGranularity);
  const [isReadyToMount, setIsReadyToMount] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  const [chartData, setChartData] = useState<{
    activeSymbols: Array<{
      symbol: string;
      display_name: string;
      exchange_is_open: 0 | 1;
      is_trading_suspended: 0 | 1;
      market: string;
      market_display_name: string;
      pip: number;
      subgroup: string;
      subgroup_display_name: string;
      submarket: string;
      submarket_display_name: string;
      symbol_type: string;
    }>;
    tradingTimes: Record<string, { isOpen: boolean; openTime: string; closeTime: string }>;
  }>();

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) =>
          regs
            .filter((r) => r.active?.scriptURL.includes('flutter_service_worker'))
            .forEach((r) => r.unregister())
        )
        .catch(() => {});
    }
    setIsReadyToMount(true);
    let cancelled = false;
    fetchDerivSmartChartData()
      .then((data) => {
        if (!cancelled && data.activeSymbols.length > 0) {
          setChartData(data);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const getQuotes = useCallback(
    async ({
      symbol: reqSymbol,
      granularity: reqGran,
      count,
      start,
      end
    }: {
      symbol: string;
      granularity?: number;
      count?: number;
      start?: number;
      end?: number;
    }) => {
      const payload: Record<string, unknown> = {
        ticks_history: reqSymbol,
        style: reqGran ? 'candles' : 'ticks',
        count: count ?? 800,
        end: end ? String(end) : 'latest',
        adjust_start_time: 1
      };
      if (reqGran) payload.granularity = reqGran;
      if (start) payload.start = String(start);
      return sendPublicDerivRawRequest(payload);
    },
    []
  );

  const subscribeQuotes = useCallback(
    (
      params: { symbol: string; granularity?: number; style?: string },
      callback: (data: unknown) => void
    ) => subscribeSmartChartsQuotes(params, callback),
    []
  );

  const unsubscribeQuotes = useCallback(
    (request?: { symbol?: string; granularity?: number }, callback?: (data: unknown) => void) =>
      unsubscribeSmartChartsQuotes(request, callback),
    []
  );

  const chartSettings = useMemo(
    () => ({
      language: 'en',
      isHighestLowestMarkerEnabled: false,
      theme: darkTheme ? 'dark' : 'light'
    }),
    [darkTheme]
  );

  const toolbarWidget = useCallback(
    () => (
      <ToolbarWidget>
        <ChartMode
          onChartType={(t: string) => setChartType(t)}
          onGranularity={(g: number) => setGranularity(g)}
        />
        {!isMobile && <StudyLegend />}
        {!isMobile && (
          <Views
            onChartType={(t: string) => setChartType(t)}
            onGranularity={(g: number) => setGranularity(g)}
          />
        )}
        <DrawTools />
        {!isMobile && <Share />}
      </ToolbarWidget>
    ),
    [isMobile]
  );

  const topWidgets = useCallback(
    () => <ChartTitle onChange={onSymbolChange} />,
    [onSymbolChange]
  );

  const fallbackUI = (
    <div
      className={`${heightClass} w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center p-6 text-center space-y-2`}
    >
      <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Deriv Live Feed</div>
      <div className="text-2xl font-mono font-extrabold text-slate-900 dark:text-white">
        {symbol} {fallbackSpot ? `· ${fallbackSpot}` : ''}
      </div>
      <p className="text-xs text-slate-500 max-w-sm">
        Interactive SmartCharts canvas initializing. You can continue using TradingView MT5 mode or place trades cleanly below.
      </p>
    </div>
  );

  if (!isReadyToMount || !chartData) {
    return fallbackUI;
  }

  return (
    <SmartChartErrorBoundary fallback={fallbackUI}>
      <div
        className={`relative w-full ${heightClass} min-h-[320px] overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1526]`}
      >
        <SmartChart
          key={`${chartId}-${symbol}`}
          id={chartId}
          symbol={symbol}
          chartType={chartType}
          granularity={granularity}
          chartData={chartData}
          chartControlsWidgets={null}
          chartStatusListener={() => {}}
          clearChart={false}
          drawingToolFloatingMenuPosition={isMobile ? { x: 80, y: 80 } : { x: 200, y: 180 }}
          enabledChartFooter={false}
          enabledNavigationWidget={!isMobile}
          getQuotes={getQuotes}
          subscribeQuotes={subscribeQuotes}
          unsubscribeQuotes={unsubscribeQuotes}
          isConnectionOpened
          isLive
          isMobile={isMobile}
          isVerticalScrollEnabled={false}
          maxTick={isMobile ? (granularity === 0 ? 10 : 28) : undefined}
          settings={chartSettings}
          onSettingsChange={() => {}}
          stateChangeListener={() => {}}
          toolbarWidget={toolbarWidget}
          topWidgets={topWidgets}
          {...(barriers && barriers.length > 0 ? { barriers } : {})}
          contracts_array={contractsArray ?? []}
        />
      </div>
    </SmartChartErrorBoundary>
  );
};
