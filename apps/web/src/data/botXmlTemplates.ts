import xml1326 from './bot-xml/1_3_2_6.xml?raw';
import xmlAccuDalembert from './bot-xml/accumulators_dalembert.xml?raw';
import xmlAccuDalembertReset from './bot-xml/accumulators_dalembert_on_stat_reset.xml?raw';
import xmlAccuMartingale from './bot-xml/accumulators_martingale.xml?raw';
import xmlAccuMartingaleReset from './bot-xml/accumulators_martingale_on_stat_reset.xml?raw';
import xmlAccuRevDalembert from './bot-xml/accumulators_reverse_dalembert.xml?raw';
import xmlAccuRevDalembertReset from './bot-xml/accumulators_reverse_dalembert_on_stat_reset.xml?raw';
import xmlAccuRevMartingale from './bot-xml/accumulators_reverse_martingale.xml?raw';
import xmlAccuRevMartingaleReset from './bot-xml/accumulators_reverse_martingale_on_stat_reset.xml?raw';
import xmlDalembert from './bot-xml/dalembert.xml?raw';
import xmlDalembertMax from './bot-xml/dalembert_max-stake.xml?raw';
import xmlMartingale from './bot-xml/martingale.xml?raw';
import xmlMartingaleMax from './bot-xml/martingale_max-stake.xml?raw';
import xmlOscarsGrind from './bot-xml/oscars_grind.xml?raw';
import xmlOscarsGrindMax from './bot-xml/oscars_grind_max-stake.xml?raw';
import xmlReverseDalembert from './bot-xml/reverse_dalembert.xml?raw';
import xmlReverseMartingale from './bot-xml/reverse_martingale.xml?raw';

export interface BotXmlTemplate {
  id: string;
  name: string;
  category: 'Quick Strategy' | 'Accumulators' | 'Classic Money Management';
  defaultSymbol: string;
  contractType: string;
  description: string;
  xml: string;
}

export const BOT_XML_TEMPLATES: BotXmlTemplate[] = [
  {
    id: 'martingale',
    name: 'Martingale (Classic)',
    category: 'Classic Money Management',
    defaultSymbol: 'R_100',
    contractType: 'CALL',
    description: 'Doubles stake after a loss and resets to initial stake on win, with profit/loss thresholds.',
    xml: xmlMartingale
  },
  {
    id: 'martingale_max-stake',
    name: 'Martingale (Max Stake Cap)',
    category: 'Classic Money Management',
    defaultSymbol: 'R_100',
    contractType: 'CALL',
    description: 'Martingale money management capped by an explicit maximum stake threshold.',
    xml: xmlMartingaleMax
  },
  {
    id: 'dalembert',
    name: "D'Alembert",
    category: 'Classic Money Management',
    defaultSymbol: 'R_100',
    contractType: 'CALL',
    description: 'Increases stake linearly by 1 unit after each loss and decreases by 1 unit on win.',
    xml: xmlDalembert
  },
  {
    id: 'dalembert_max-stake',
    name: "D'Alembert (Max Stake Cap)",
    category: 'Classic Money Management',
    defaultSymbol: 'R_100',
    contractType: 'CALL',
    description: "D'Alembert progressive sizing bounded by a hard maximum stake cap.",
    xml: xmlDalembertMax
  },
  {
    id: 'oscars_grind',
    name: "Oscar's Grind",
    category: 'Classic Money Management',
    defaultSymbol: 'R_100',
    contractType: 'CALL',
    description: 'Targets 1 unit profit per cycle, incrementing stake only on wins during recovery.',
    xml: xmlOscarsGrind
  },
  {
    id: 'oscars_grind_max-stake',
    name: "Oscar's Grind (Max Stake Cap)",
    category: 'Classic Money Management',
    defaultSymbol: 'R_100',
    contractType: 'CALL',
    description: "Oscar's Grind recovery system with maximum stake protection.",
    xml: xmlOscarsGrindMax
  },
  {
    id: '1_3_2_6',
    name: '1-3-2-6 Positive Progression',
    category: 'Quick Strategy',
    defaultSymbol: 'R_100',
    contractType: 'CALL',
    description: '4-step positive winning progression sequence (1x, 3x, 2x, 6x) resetting on any loss.',
    xml: xml1326
  },
  {
    id: 'reverse_martingale',
    name: 'Reverse Martingale (Paroli)',
    category: 'Classic Money Management',
    defaultSymbol: 'R_100',
    contractType: 'CALL',
    description: 'Compounds winning streaks while returning to base stake immediately after a loss.',
    xml: xmlReverseMartingale
  },
  {
    id: 'reverse_dalembert',
    name: "Reverse D'Alembert",
    category: 'Classic Money Management',
    defaultSymbol: 'R_100',
    contractType: 'CALL',
    description: 'Increases stake by 1 unit on wins and steps down by 1 unit after losses.',
    xml: xmlReverseDalembert
  },
  {
    id: 'accumulators_martingale',
    name: 'Accumulators Martingale',
    category: 'Accumulators',
    defaultSymbol: '1HZ10V',
    contractType: 'ACCU',
    description: 'Accumulator contracts with growth rate compounding and Martingale stake recovery.',
    xml: xmlAccuMartingale
  },
  {
    id: 'accumulators_martingale_on_stat_reset',
    name: 'Accumulators Martingale (Stat Reset)',
    category: 'Accumulators',
    defaultSymbol: '1HZ10V',
    contractType: 'ACCU',
    description: 'Accumulators Martingale strategy that waits/resets on statistical barrier resets.',
    xml: xmlAccuMartingaleReset
  },
  {
    id: 'accumulators_dalembert',
    name: "Accumulators D'Alembert",
    category: 'Accumulators',
    defaultSymbol: '1HZ10V',
    contractType: 'ACCU',
    description: "Accumulator strategy paired with controlled linear D'Alembert stake stepping.",
    xml: xmlAccuDalembert
  },
  {
    id: 'accumulators_dalembert_on_stat_reset',
    name: "Accumulators D'Alembert (Stat Reset)",
    category: 'Accumulators',
    defaultSymbol: '1HZ10V',
    contractType: 'ACCU',
    description: "Accumulator D'Alembert with statistical reset trigger conditions.",
    xml: xmlAccuDalembertReset
  },
  {
    id: 'accumulators_reverse_martingale',
    name: 'Accumulators Reverse Martingale',
    category: 'Accumulators',
    defaultSymbol: '1HZ10V',
    contractType: 'ACCU',
    description: 'Rides winning Accumulator cycles with compounded stake sizing.',
    xml: xmlAccuRevMartingale
  },
  {
    id: 'accumulators_reverse_martingale_on_stat_reset',
    name: 'Accumulators Reverse Martingale (Stat Reset)',
    category: 'Accumulators',
    defaultSymbol: '1HZ10V',
    contractType: 'ACCU',
    description: 'Accumulators Reverse Martingale with statistical reset guard.',
    xml: xmlAccuRevMartingaleReset
  },
  {
    id: 'accumulators_reverse_dalembert',
    name: "Accumulators Reverse D'Alembert",
    category: 'Accumulators',
    defaultSymbol: '1HZ10V',
    contractType: 'ACCU',
    description: "Accumulator strategy with Reverse D'Alembert positive sizing.",
    xml: xmlAccuRevDalembert
  },
  {
    id: 'accumulators_reverse_dalembert_on_stat_reset',
    name: "Accumulators Reverse D'Alembert (Stat Reset)",
    category: 'Accumulators',
    defaultSymbol: '1HZ10V',
    contractType: 'ACCU',
    description: "Accumulator Reverse D'Alembert combined with stat reset logic.",
    xml: xmlAccuRevDalembertReset
  }
];
