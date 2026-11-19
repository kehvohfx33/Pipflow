import React from 'react';
import { ShieldCheck, Sliders, Sun, Moon, DollarSign } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

export const SettingsPage: React.FC = () => {
  const { user, darkTheme, setDarkTheme, currency, setCurrency, activeDerivAccount } = useAuth();

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-5">
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-1.5">
        <h1 className="font-bold text-lg flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-500" />
          <span>Profile &amp; Workspace Preferences</span>
        </h1>
        <p className="text-xs text-slate-500">
          Signed in as{' '}
          <span className="font-semibold text-slate-800 dark:text-slate-200">
            {user?.full_name || user?.email}
          </span>{' '}
          ({user?.email})
        </p>
      </div>

      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <div className="flex items-center gap-2 font-bold text-sm">
          <Sliders className="w-4 h-4 text-blue-600" />
          <span>Trading Display Settings</span>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
          <div className="py-3 flex items-center justify-between">
            <div>
              <div className="font-semibold">Active Trading Mode</div>
              <div className="text-slate-500">
                Switch between Real and Demo accounts from the balance selector in the top bar.
              </div>
            </div>
            <span
              className={`px-2.5 py-1 rounded-md font-bold uppercase ${
                activeDerivAccount?.account_type === 'real'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                  : 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
              }`}
            >
              {activeDerivAccount?.account_type === 'real' ? 'Real Mode' : 'Demo Mode'}
            </span>
          </div>

          <div className="py-3 flex items-center justify-between">
            <div>
              <div className="font-semibold flex items-center gap-1.5">
                {darkTheme ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
                <span>Workspace Theme</span>
              </div>
              <div className="text-slate-500">Toggle between Light and Dark trading interfaces.</div>
            </div>
            <button
              type="button"
              onClick={() => setDarkTheme(!darkTheme)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              {darkTheme ? 'Dark Mode' : 'Light Mode'}
            </button>
          </div>

          <div className="py-3 flex items-center justify-between">
            <div>
              <div className="font-semibold flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                <span>Display Currency</span>
              </div>
              <div className="text-slate-500">Display workspace balances in USD or KSH.</div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCurrency('USD')}
                className={`px-3 py-1 rounded-md font-bold ${
                  currency === 'USD'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                USD
              </button>
              <button
                type="button"
                onClick={() => setCurrency('KSH')}
                className={`px-3 py-1 rounded-md font-bold ${
                  currency === 'KSH'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                KSH
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
