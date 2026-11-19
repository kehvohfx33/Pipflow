import React from 'react';
import {
  Crosshair,
  TrendingUp,
  Minus,
  GitBranch,
  PenTool,
  Type,
  Ruler,
  ZoomIn,
  Magnet,
  Lock,
  Eye,
  Trash2
} from 'lucide-react';

export type DrawingTool = 'crosshair' | 'trendline' | 'hline' | 'fib' | 'brush' | 'text' | 'measure';

export const DrawingToolbar: React.FC<{
  activeTool: DrawingTool;
  onSelect: (tool: DrawingTool) => void;
  showDrawings: boolean;
  onToggleShow: () => void;
  onClearDrawings: () => void;
}> = ({ activeTool, onSelect, showDrawings, onToggleShow, onClearDrawings }) => {
  const tools: Array<{ id: DrawingTool; icon: React.ComponentType<{ className?: string }>; label: string }> = [
    { id: 'crosshair', icon: Crosshair, label: 'Crosshair' },
    { id: 'trendline', icon: TrendingUp, label: 'Trend Line' },
    { id: 'hline', icon: Minus, label: 'Horizontal Price Line' },
    { id: 'fib', icon: GitBranch, label: 'Channel / Fib' },
    { id: 'brush', icon: PenTool, label: 'Annotate' },
    { id: 'text', icon: Type, label: 'Price Label' },
    { id: 'measure', icon: Ruler, label: 'Measure' }
  ];

  return (
    <div className="w-11 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col items-center py-2 gap-1.5 shrink-0">
      {tools.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onSelect(t.id)}
          title={t.label}
          className={`p-2 rounded-lg transition ${
            activeTool === t.id
              ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-sky-400'
              : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <t.icon className="w-4 h-4" />
        </button>
      ))}
      <div className="w-6 h-px bg-slate-200 dark:bg-slate-800 my-1" />
      <button type="button" title="Zoom" className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
        <ZoomIn className="w-4 h-4" />
      </button>
      <button type="button" title="Magnet" className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
        <Magnet className="w-4 h-4" />
      </button>
      <button type="button" title="Lock Drawings" className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
        <Lock className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={onToggleShow}
        title={showDrawings ? 'Hide Drawings' : 'Show Drawings'}
        className={`p-2 rounded-lg ${showDrawings ? 'text-blue-600' : 'text-slate-400'}`}
      >
        <Eye className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={onClearDrawings}
        title="Clear All Price Lines"
        className="p-2 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
};
