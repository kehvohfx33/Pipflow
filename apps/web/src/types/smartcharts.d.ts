declare module '@deriv-com/smartcharts-champion' {
  import type { ComponentType, ReactElement, ReactNode } from 'react';

  export function setSmartChartsPublicPath(path: string): void;

  export interface SmartChartsSymbol {
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
  }

  export interface SmartChartChartData {
    tradingTimes: Record<string, { isOpen: boolean; openTime: string; closeTime: string }>;
    activeSymbols: SmartChartsSymbol[];
  }

  export interface SmartChartProps {
    symbol?: string;
    granularity?: number;
    chartType?: string;
    startEpoch?: number;
    endEpoch?: number;
    chartData?: SmartChartChartData;
    getQuotes?: (params: {
      symbol: string;
      granularity?: number;
      count?: number;
      start?: number;
      end?: number;
    }) => Promise<unknown>;
    subscribeQuotes?: (
      params: { symbol: string; granularity?: number; style?: string },
      callback: (data: unknown) => void
    ) => (() => void) | Promise<void>;
    unsubscribeQuotes?: (
      request?: { symbol?: string; granularity?: number },
      callback?: (data: unknown) => void
    ) => void;
    isLive?: boolean;
    settings?: Record<string, unknown>;
    onSettingsChange?: (newSettings: Record<string, unknown>) => void;
    stateChangeListener?: (state: string, option?: unknown) => void;
    chartStatusListener?: (isChartReady: boolean) => boolean | void;
    isMobile?: boolean;
    enabledChartFooter?: boolean;
    enabledNavigationWidget?: boolean;
    isVerticalScrollEnabled?: boolean;
    yAxisMargin?: { top: number; bottom: number };
    leftMargin?: number;
    topWidgets?: () => ReactElement;
    bottomWidgets?: () => ReactElement;
    toolbarWidget?: () => ReactElement;
    chartControlsWidgets?: (() => ReactElement) | null;
    id?: string;
    clearChart?: boolean;
    maxTick?: number | null;
    contracts_array?: unknown[];
    barriers?: unknown[];
    showLastDigitStats?: boolean;
    isConnectionOpened?: boolean;
    drawingToolFloatingMenuPosition?: { x: number; y: number };
    children?: ReactNode;
  }

  export const SmartChart: ComponentType<SmartChartProps>;
  export const ChartTitle: ComponentType<{ onChange?: (symbol: string) => void; [key: string]: unknown }>;
  export const ChartMode: ComponentType<{
    onChartType?: (type: string) => void;
    onGranularity?: (granularity: number) => void;
    [key: string]: unknown;
  }>;
  export const StudyLegend: ComponentType<Record<string, unknown>>;
  export const Views: ComponentType<{
    onChartType?: (type: string) => void;
    onGranularity?: (granularity: number) => void;
    [key: string]: unknown;
  }>;
  export const DrawTools: ComponentType<Record<string, unknown>>;
  export const Share: ComponentType<Record<string, unknown>>;
  export const ToolbarWidget: ComponentType<{ children?: ReactNode }>;
  export const ChartSetting: ComponentType<Record<string, unknown>>;
}

declare module '@deriv-com/smartcharts-champion/dist/smartcharts.css';
