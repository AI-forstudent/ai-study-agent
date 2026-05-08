import { useEffect, useState } from 'react';
import { Activity, Loader2, AlertCircle, MessageSquare, Sparkles, RefreshCw } from 'lucide-react';
import { api } from '../../services/api';

// Mirrors UsageSummaryOut on the backend.
interface UsagePerEndpoint  { endpoint: string; call_count: number; input_tokens: number; output_tokens: number; credits: number; cost_usd_micros: number; }
interface UsagePerProvider  { provider: string; call_count: number; credits: number; cost_usd_micros: number; }
interface RecentEvent       { id: number; created_at: string; provider: string; model_name: string | null; endpoint: string; input_tokens: number; output_tokens: number; credits: number; cost_usd_micros: number; }
interface UsageSummary {
  tier:                 string;
  tier_label:           string;
  credits_per_period:   number | null;
  period_seconds:       number;
  period_credits:       number;
  period_cost_usd:      number;
  period_calls:         number;
  period_resets_at:     string;
  lifetime_credits:     number;
  lifetime_cost_usd:    number;
  lifetime_calls:       number;
  by_endpoint:          UsagePerEndpoint[];
  by_provider:          UsagePerProvider[];
  recent_events:        RecentEvent[];
}

const PROVIDER_LABEL: Record<string, string> = {
  openai:    'GPT',
  anthropic: 'Claude',
  gemini:    'Gemini',
};

function formatUsd(amount: number) {
  if (amount === 0) return '$0.00';
  if (amount < 0.01) return '<$0.01';
  return `$${amount.toFixed(amount < 1 ? 4 : 2)}`;
}

function formatPeriod(seconds: number) {
  if (seconds === 86_400)  return 'day';
  if (seconds === 604_800) return 'week';
  if (seconds === 2_592_000) return 'month';
  return `${Math.round(seconds / 3600)}h`;
}

export default function UsageSection() {
  const [data, setData]     = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMyUsage();
      setData(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to load usage.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  return (
    <div className="bg-white border border-[#E8E8E6] rounded-xl p-6">
      <div className="flex items-center justify-between mb-1 gap-2">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-[#F7F7F5] border border-[#E8E8E6] flex items-center justify-center shrink-0">
            <Activity className="w-3.5 h-3.5 text-[#787774]" />
          </div>
          <h2 className="text-sm font-semibold text-[#37352F]">Usage</h2>
        </div>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          title="Refresh"
          className="p-1.5 rounded-md text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </button>
      </div>
      <p className="text-xs text-[#787774] mb-5 ms-10">
        Your AI spending across chats. Pricing reflects published per-token rates per provider — actual invoices may differ.
      </p>

      {error ? (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      ) : !data ? (
        <div className="flex items-center gap-2 text-sm text-[#787774] py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="space-y-5">
          {/* ── Quota bar ─────────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between text-xs text-[#787774] mb-1.5">
              <span>
                <span className="font-medium text-[#37352F]">{data.tier_label}</span>{' '}
                · this {formatPeriod(data.period_seconds)}
              </span>
              <span>
                {data.credits_per_period === null
                  ? `${data.period_credits.toLocaleString()} credits used · Unlimited`
                  : `${data.period_credits.toLocaleString()} / ${data.credits_per_period.toLocaleString()} credits`}
              </span>
            </div>
            {data.credits_per_period !== null && (
              <div className="h-2 rounded-full bg-[#F7F7F5] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    data.period_credits / data.credits_per_period > 0.85
                      ? 'bg-red-500'
                      : data.period_credits / data.credits_per_period > 0.6
                        ? 'bg-amber-500'
                        : 'bg-indigo-500'
                  }`}
                  style={{ width: `${Math.min(100, Math.round((data.period_credits / data.credits_per_period) * 100))}%` }}
                />
              </div>
            )}
            <div className="flex items-center justify-between text-[10px] text-[#C4C4C4] mt-1.5">
              <span>{data.period_calls} call{data.period_calls === 1 ? '' : 's'} · {formatUsd(data.period_cost_usd)}</span>
              <span>resets {new Date(data.period_resets_at).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</span>
            </div>
          </div>

          {/* ── By provider ────────────────────────────────────────────── */}
          {data.by_provider.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#C4C4C4] mb-2">
                By provider
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {data.by_provider.map(p => (
                  <div key={p.provider} className="bg-[#F7F7F5] border border-[#E8E8E6] rounded-lg p-3">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-[#37352F]">
                      <Sparkles className="w-3 h-3 text-indigo-500" />
                      {PROVIDER_LABEL[p.provider] ?? p.provider}
                    </div>
                    <div className="text-lg font-semibold text-[#37352F] mt-1">
                      {formatUsd(p.cost_usd_micros / 1_000_000)}
                    </div>
                    <div className="text-[10px] text-[#787774]">
                      {p.call_count} call{p.call_count === 1 ? '' : 's'} · {p.credits.toLocaleString()} credits
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Lifetime totals ────────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-white border border-[#E8E8E6] rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wide text-[#C4C4C4]">Total calls</p>
              <p className="text-sm font-semibold text-[#37352F] mt-1">{data.lifetime_calls.toLocaleString()}</p>
            </div>
            <div className="bg-white border border-[#E8E8E6] rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wide text-[#C4C4C4]">Total credits</p>
              <p className="text-sm font-semibold text-[#37352F] mt-1">{data.lifetime_credits.toLocaleString()}</p>
            </div>
            <div className="bg-white border border-[#E8E8E6] rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wide text-[#C4C4C4]">Total spend</p>
              <p className="text-sm font-semibold text-[#37352F] mt-1">{formatUsd(data.lifetime_cost_usd)}</p>
            </div>
          </div>

          {/* ── Recent events ─────────────────────────────────────────── */}
          {data.recent_events.length > 0 ? (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#C4C4C4] mb-2">
                Recent calls
              </p>
              <div className="border border-[#E8E8E6] rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-[#F7F7F5] text-[#787774]">
                    <tr>
                      <th className="text-start font-medium px-3 py-2">When</th>
                      <th className="text-start font-medium px-3 py-2">Provider</th>
                      <th className="text-start font-medium px-3 py-2 hidden sm:table-cell">Model</th>
                      <th className="text-end font-medium px-3 py-2">Tokens</th>
                      <th className="text-end font-medium px-3 py-2">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_events.map(ev => (
                      <tr key={ev.id} className="border-t border-[#E8E8E6]">
                        <td className="px-3 py-2 text-[#787774]">
                          {new Date(ev.created_at).toLocaleString(undefined, {
                            month: 'short', day: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                        <td className="px-3 py-2 text-[#37352F]">
                          {PROVIDER_LABEL[ev.provider] ?? ev.provider}
                        </td>
                        <td className="px-3 py-2 text-[10px] text-[#787774] hidden sm:table-cell font-mono">
                          {ev.model_name ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-end text-[#787774]">
                          {(ev.input_tokens + ev.output_tokens).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-end text-[#37352F]">
                          {formatUsd(ev.cost_usd_micros / 1_000_000)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-xs text-[#787774] flex items-center gap-1.5">
              <MessageSquare className="w-3 h-3" />
              No usage yet — start a chat to see your first event here.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
