import React, { useEffect, useRef } from 'react';
import * as Blockly from 'blockly';
import 'blockly/blocks';

let derivBlocksRegistered = false;

function registerDerivBotBlocks() {
  if (derivBlocksRegistered) return;
  derivBlocksRegistered = true;

  const defBlock = (type: string, initFn: (this: Blockly.Block) => void) => {
    if (!Blockly.Blocks[type]) {
      Blockly.Blocks[type] = { init: initFn };
    }
  };

  defBlock('trade_definition', function () {
    this.appendDummyInput().appendField('1. Trade Parameters');
    this.appendStatementInput('TRADE_OPTIONS');
    this.appendDummyInput().appendField('Run once at start:');
    this.appendStatementInput('INITIALIZATION');
    this.appendDummyInput().appendField('Trade options:');
    this.appendStatementInput('SUBMARKET');
    this.setColour(220);
    this.setDeletable(false);
  });

  defBlock('trade_definition_market', function () {
    this.appendDummyInput()
      .appendField('Market:')
      .appendField(
        new Blockly.FieldDropdown([
          ['Derived (Synthetics)', 'synthetic_index'],
          ['Forex', 'forex'],
          ['Commodities', 'commodities'],
          ['Cryptocurrencies', 'cryptocurrency']
        ]),
        'MARKET_LIST'
      )
      .appendField(
        new Blockly.FieldDropdown([
          ['Continuous Indices', 'random_index'],
          ['Daily Reset Indices', 'random_daily'],
          ['Jump Indices', 'jump_index'],
          ['Major Pairs', 'major_pairs'],
          ['Metals', 'metals']
        ]),
        'SUBMARKET_LIST'
      )
      .appendField(
        new Blockly.FieldDropdown([
          ['Volatility 100', 'R_100'],
          ['Volatility 75', 'R_75'],
          ['Volatility 50', 'R_50'],
          ['Volatility 25', 'R_25'],
          ['Volatility 10', 'R_10'],
          ['Volatility 100 (1s)', '1HZ100V'],
          ['Volatility 90 (1s)', '1HZ90V'],
          ['Volatility 10 (1s)', '1HZ10V'],
          ['Jump 10', 'JD10'],
          ['Jump 25', 'JD25'],
          ['EUR/USD', 'frxEURUSD']
        ]),
        'SYMBOL_LIST'
      );
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour(210);
  });

  defBlock('trade_definition_tradetype', function () {
    this.appendDummyInput()
      .appendField('Trade Type:')
      .appendField(
        new Blockly.FieldDropdown([
          ['Up/Down', 'callput'],
          ['Digits', 'digits'],
          ['Accumulators', 'accumulator'],
          ['Multipliers', 'multiplier']
        ]),
        'TRADETYPECAT_LIST'
      )
      .appendField(
        new Blockly.FieldDropdown([
          ['Rise/Fall', 'callput'],
          ['Over/Under', 'overunder'],
          ['Even/Odd', 'evenodd'],
          ['Matches/Differs', 'matchdiff'],
          ['Accumulator', 'accumulator']
        ]),
        'TRADETYPE_LIST'
      );
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour(210);
  });

  defBlock('trade_definition_contracttype', function () {
    this.appendDummyInput()
      .appendField('Contract Type:')
      .appendField(
        new Blockly.FieldDropdown([
          ['Both', 'both'],
          ['Rise', 'CALL'],
          ['Fall', 'PUT'],
          ['Over', 'DIGITOVER'],
          ['Under', 'DIGITUNDER'],
          ['Even', 'DIGITEVEN'],
          ['Odd', 'DIGITODD'],
          ['Accumulator', 'ACCU']
        ]),
        'TYPE_LIST'
      );
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour(210);
  });

  defBlock('trade_definition_candleinterval', function () {
    this.appendDummyInput()
      .appendField('Default Candle Interval:')
      .appendField(
        new Blockly.FieldDropdown([
          ['1 minute', '60'],
          ['2 minutes', '120'],
          ['3 minutes', '180'],
          ['5 minutes', '300'],
          ['15 minutes', '900'],
          ['1 hour', '3600']
        ]),
        'CANDLEINTERVAL_LIST'
      );
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour(210);
  });

  defBlock('trade_definition_restartbuysell', function () {
    this.appendDummyInput()
      .appendField('Restart buy/sell on error:')
      .appendField(
        new Blockly.FieldDropdown([
          ['No', 'FALSE'],
          ['Yes', 'TRUE']
        ]),
        'TIME_MACHINE_ENABLED'
      );
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour(210);
  });

  defBlock('trade_definition_restartonerror', function () {
    this.appendDummyInput()
      .appendField('Restart last trade on error:')
      .appendField(
        new Blockly.FieldDropdown([
          ['Yes', 'TRUE'],
          ['No', 'FALSE']
        ]),
        'RESTARTONERROR'
      );
    this.setPreviousStatement(true);
    this.setNextStatement(false);
    this.setColour(210);
  });

  defBlock('trade_definition_tradeoptions', function () {
    this.appendDummyInput()
      .appendField('Duration:')
      .appendField(
        new Blockly.FieldDropdown([
          ['Ticks', 't'],
          ['Seconds', 's'],
          ['Minutes', 'm'],
          ['Hours', 'h'],
          ['Days', 'd']
        ]),
        'DURATIONTYPE_LIST'
      );
    this.appendValueInput('DURATION').setCheck('Number');
    this.appendValueInput('AMOUNT').setCheck('Number').appendField('Stake:');
    this.appendDummyInput().appendField(new Blockly.FieldLabelSerializable('USD'), 'CURRENCY_LIST');
    this.appendValueInput('PREDICTION').setCheck('Number').appendField('Prediction:');
    this.appendValueInput('BARRIEROFFSET').setCheck('Number').appendField('Barrier:');
    this.setInputsInline(true);
    this.setPreviousStatement(true);
    this.setNextStatement(false);
    this.setColour(205);
  });

  defBlock('trade_definition_accumulator', function () {
    this.appendDummyInput()
      .appendField('Growth Rate:')
      .appendField(
        new Blockly.FieldDropdown([
          ['1%', '0.01'],
          ['2%', '0.02'],
          ['3%', '0.03'],
          ['4%', '0.04'],
          ['5%', '0.05']
        ]),
        'GROWTHRATE_LIST'
      );
    this.appendValueInput('AMOUNT').setCheck('Number').appendField('Stake:');
    this.appendStatementInput('ACCUMULATOR_PARAMS').appendField('Take Profit / Params:');
    this.setPreviousStatement(true);
    this.setNextStatement(false);
    this.setColour(205);
  });

  defBlock('accumulator_take_profit', function () {
    this.appendValueInput('AMOUNT').setCheck('Number').appendField('Take Profit:');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour(205);
  });

  defBlock('before_purchase', function () {
    this.appendDummyInput().appendField('2. Purchase conditions');
    this.appendStatementInput('BEFOREPURCHASE_STACK');
    this.setColour(170);
    this.setDeletable(false);
  });

  defBlock('purchase', function () {
    this.appendDummyInput()
      .appendField('Purchase')
      .appendField(
        new Blockly.FieldDropdown([
          ['Rise (CALL)', 'CALL'],
          ['Fall (PUT)', 'PUT'],
          ['Over (DIGITOVER)', 'DIGITOVER'],
          ['Under (DIGITUNDER)', 'DIGITUNDER'],
          ['Even (DIGITEVEN)', 'DIGITEVEN'],
          ['Odd (DIGITODD)', 'DIGITODD'],
          ['Match (DIGITMATCH)', 'DIGITMATCH'],
          ['Differs (DIGITDIFF)', 'DIGITDIFF'],
          ['Accumulator (ACCU)', 'ACCU']
        ]),
        'PURCHASE_LIST'
      );
    this.setPreviousStatement(true);
    this.setNextStatement(false);
    this.setColour(170);
  });

  defBlock('during_purchase', function () {
    this.appendDummyInput().appendField('3. Sell conditions');
    this.appendStatementInput('DURING_PURCHASE_STACK');
    this.setColour(195);
  });

  defBlock('sell_at_market', function () {
    this.appendDummyInput().appendField('Sell at market');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour(195);
  });

  defBlock('check_sell', function () {
    this.appendDummyInput().appendField('Sell is available');
    this.setOutput(true, 'Boolean');
    this.setColour(195);
  });

  defBlock('after_purchase', function () {
    this.appendDummyInput().appendField('4. Restart trading conditions');
    this.appendStatementInput('AFTERPURCHASE_STACK');
    this.setColour(290);
  });

  defBlock('trade_again', function () {
    this.appendDummyInput().appendField('Trade again');
    this.setPreviousStatement(true);
    this.setNextStatement(false);
    this.setColour(290);
  });

  defBlock('contract_check_result', function () {
    this.appendDummyInput()
      .appendField('Result is')
      .appendField(
        new Blockly.FieldDropdown([
          ['win', 'win'],
          ['loss', 'loss']
        ]),
        'CHECK_RESULT'
      );
    this.setOutput(true, 'Boolean');
    this.setColour(290);
  });

  defBlock('read_details', function () {
    this.appendDummyInput()
      .appendField('Contract Detail:')
      .appendField(
        new Blockly.FieldDropdown([
          ['Profit', '4'],
          ['Buy Price', '2'],
          ['Payout', '3'],
          ['Contract Type', '11']
        ]),
        'DETAIL_INDEX'
      );
    this.setOutput(true, null);
    this.setColour(290);
  });

  defBlock('tick_analysis', function () {
    this.appendDummyInput().appendField('Run on every tick');
    this.appendStatementInput('TICKANALYSIS_STACK');
    this.setColour(260);
  });

  defBlock('notify', function () {
    this.appendDummyInput()
      .appendField('Notify')
      .appendField(
        new Blockly.FieldDropdown([
          ['info', 'info'],
          ['success', 'success'],
          ['warn', 'warn'],
          ['error', 'error']
        ]),
        'NOTIFICATION_TYPE'
      )
      .appendField('sound:')
      .appendField(
        new Blockly.FieldDropdown([
          ['silent', 'silent'],
          ['announcement', 'announcement'],
          ['earned-money', 'earned-money'],
          ['job-done', 'job-done']
        ]),
        'NOTIFICATION_SOUND'
      );
    this.appendValueInput('MESSAGE');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour(160);
  });

  defBlock('text_statement', function () {
    this.appendValueInput('TEXT').appendField('item');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour(160);
  });

  defBlock('math_number_positive', function () {
    this.appendDummyInput().appendField(new Blockly.FieldNumber(1, 0), 'NUM');
    this.setOutput(true, 'Number');
    this.setColour(230);
  });

  defBlock('stat', function () {
    this.appendDummyInput().appendField('Tick Stats');
    this.setOutput(true, 'Number');
    this.setColour(230);
  });
}

const DEFAULT_TOOLBOX = {
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category',
      name: 'Trade Parameters',
      colour: '#3b82f6',
      contents: [
        { kind: 'block', type: 'trade_definition' },
        { kind: 'block', type: 'trade_definition_market' },
        { kind: 'block', type: 'trade_definition_tradetype' },
        { kind: 'block', type: 'trade_definition_contracttype' },
        { kind: 'block', type: 'trade_definition_tradeoptions' },
        { kind: 'block', type: 'trade_definition_accumulator' },
        { kind: 'block', type: 'accumulator_take_profit' }
      ]
    },
    {
      kind: 'category',
      name: 'Purchase & Sell',
      colour: '#10b981',
      contents: [
        { kind: 'block', type: 'before_purchase' },
        { kind: 'block', type: 'purchase' },
        { kind: 'block', type: 'during_purchase' },
        { kind: 'block', type: 'sell_at_market' },
        { kind: 'block', type: 'check_sell' }
      ]
    },
    {
      kind: 'category',
      name: 'After Purchase',
      colour: '#8b5cf6',
      contents: [
        { kind: 'block', type: 'after_purchase' },
        { kind: 'block', type: 'trade_again' },
        { kind: 'block', type: 'contract_check_result' },
        { kind: 'block', type: 'read_details' }
      ]
    },
    {
      kind: 'category',
      name: 'Logic & Math',
      colour: '#f59e0b',
      contents: [
        { kind: 'block', type: 'controls_if' },
        { kind: 'block', type: 'logic_compare' },
        { kind: 'block', type: 'logic_operation' },
        { kind: 'block', type: 'logic_boolean' },
        { kind: 'block', type: 'math_number' },
        { kind: 'block', type: 'math_arithmetic' },
        { kind: 'block', type: 'math_round' }
      ]
    },
    {
      kind: 'category',
      name: 'Analysis & Text',
      colour: '#06b6d4',
      contents: [
        { kind: 'block', type: 'tick_analysis' },
        { kind: 'block', type: 'notify' },
        { kind: 'block', type: 'text' },
        { kind: 'block', type: 'variables_get' },
        { kind: 'block', type: 'variables_set' }
      ]
    }
  ]
};

export interface ExtractedBotXmlSummary {
  symbol?: string;
  contractType?: string;
  duration?: number;
  durationUnit?: 't' | 's' | 'm' | 'h' | 'd';
  stake?: number;
  growthRate?: number;
}

export function extractBotSummaryFromXml(xmlText: string): ExtractedBotXmlSummary {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const symbolEl = doc.querySelector('field[name="SYMBOL_LIST"]');
    const purchaseEl = doc.querySelector('field[name="PURCHASE_LIST"]');
    const durUnitEl = doc.querySelector('field[name="DURATIONTYPE_LIST"]');
    const growthEl = doc.querySelector('field[name="GROWTHRATE_LIST"]');
    const durValEl = doc.querySelector('value[name="DURATION"] field[name="NUM"]');
    const amtValEl = doc.querySelector('value[name="AMOUNT"] field[name="NUM"]');
    return {
      symbol: symbolEl?.textContent?.trim() || undefined,
      contractType: purchaseEl?.textContent?.trim() || undefined,
      durationUnit: (durUnitEl?.textContent?.trim() as 't' | 's' | 'm' | 'h' | 'd') || undefined,
      duration: durValEl ? Number(durValEl.textContent) : undefined,
      stake: amtValEl ? Number(amtValEl.textContent) : undefined,
      growthRate: growthEl ? Number(growthEl.textContent) : undefined
    };
  } catch {
    return {};
  }
}

interface DerivBlocklyWorkspaceProps {
  xmlContent: string;
  onXmlChange?: (nextXml: string) => void;
  darkTheme?: boolean;
  heightClass?: string;
}

export const DerivBlocklyWorkspace: React.FC<DerivBlocklyWorkspaceProps> = ({
  xmlContent,
  onXmlChange,
  darkTheme = false,
  heightClass = 'h-[520px]'
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    registerDerivBotBlocks();
    if (!containerRef.current) return;

    const workspace = Blockly.inject(containerRef.current, {
      toolbox: DEFAULT_TOOLBOX,
      zoom: { controls: true, wheel: true, startScale: 0.85, maxScale: 1.5, minScale: 0.4, scaleSpeed: 1.15 },
      trashcan: true,
      grid: { spacing: 22, length: 3, colour: darkTheme ? '#1e293b' : '#e2e8f0', snap: true }
    });
    workspaceRef.current = workspace;

    const listener = () => {
      if (loadingRef.current || !onXmlChange) return;
      try {
        const dom = Blockly.Xml.workspaceToDom(workspace);
        onXmlChange(Blockly.Xml.domToText(dom));
      } catch {
        // ignore transient mutations
      }
    };
    workspace.addChangeListener(listener);

    const resizeObserver = new ResizeObserver(() => {
      Blockly.svgResize(workspace);
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      workspace.removeChangeListener(listener);
      workspace.dispose();
      workspaceRef.current = null;
    };
  }, [darkTheme]);

  useEffect(() => {
    const ws = workspaceRef.current;
    if (!ws || !xmlContent) return;
    try {
      const currentXml = Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(ws));
      if (currentXml === xmlContent) return;
    } catch {
      // proceed with load
    }

    loadingRef.current = true;
    try {
      ws.clear();
      const dom = Blockly.utils.xml.textToDom(xmlContent);
      Blockly.Xml.domToWorkspace(dom, ws);
      Blockly.svgResize(ws);
    } catch (err) {
      console.warn('[DerivBlockly] Failed to load XML cleanly:', err);
    } finally {
      loadingRef.current = false;
    }
  }, [xmlContent]);

  return (
    <div
      ref={containerRef}
      className={`w-full ${heightClass} rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-[#0b1526]`}
    />
  );
};
