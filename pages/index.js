import { useState, useEffect } from 'react'

function fmt(n) {
  if (n === null || n === undefined) return '—'
  const abs = Math.abs(n)
  const s = abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < 0 ? `-£${s}` : `£${s}`
}

function getToday() {
  return new Date().toISOString().split('T')[0]
}

function formatDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

const ROWS = [
  { key: 'sales',      label: 'Sales' },
  { key: 'refunds',    label: 'Refunds' },
  { key: 'charges',    label: 'Charges' },
  { key: 'postage',    label: 'Postage' },
  { key: 'hold',       label: 'Hold' },
  { key: 'claim',      label: 'Claim' },
  { key: 'adjustment', label: 'Adjustment' },
  { key: 'other',      label: 'Other' },
  { key: 'charge',     label: 'Charge' },
]

export default function PayoutDashboard() {
  const [date, setDate]     = useState(getToday())
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/payout?date=${date}`)
      .then(r => r.json())
      .then(d => { setData(d.noPayout ? null : d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [date])

  function copyBreakdown() {
    if (!data) return
    const lines = [
      `eBay Payout — ${formatDateLabel(date)}`,
      '',
      ...ROWS.map(r => `${r.label}\t${fmt(data[r.key])}`),
      '',
      `Total Payout\t${fmt(data.total_payout)}`,
      `Difference\t${fmt(data.difference)}`,
      '',
      `Collectors Tax\t${fmt(data.collectors_tax)}`,
      `Postage & Packaging\t${fmt(data.postage_and_packaging)}`,
    ]
    navigator.clipboard.writeText(lines.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const today = getToday()

  function valueClass(n) {
    if (!n || n === 0) return 'val-zero'
    return n < 0 ? 'val-neg' : 'val-pos'
  }

  return (
    <div className="container">

      {/* Date bar */}
      <div className="date-bar">
        <button className="date-nav" onClick={() => setDate(shiftDate(date, -1))} aria-label="Previous day">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div className="date-label">
          <span className="date-label-main">{formatDateLabel(date)}</span>
          <span className="date-label-sub">Payout date</span>
        </div>
        <button
          className="date-nav"
          onClick={() => setDate(shiftDate(date, 1))}
          disabled={date >= today}
          aria-label="Next day"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
        <input
          type="date"
          value={date}
          max={today}
          onChange={e => e.target.value && setDate(e.target.value)}
          className="date-picker"
        />
        <button className="btn btn-secondary" onClick={() => setDate(getToday())}>Today</button>
      </div>

      {/* Summary cards */}
      <div className="summary-cards">
        <div className="summary-card">
          <div className="summary-card-label">Sales</div>
          <div className="summary-card-value val-pos">{data ? fmt(data.sales) : '—'}</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-label">Refunds</div>
          <div className="summary-card-value val-neg">{data ? fmt(Math.abs(data.refunds)) : '—'}</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-label">Charges</div>
          <div className="summary-card-value val-neg">{data ? fmt(Math.abs(data.charges)) : '—'}</div>
        </div>
        <div className="summary-card summary-card-featured">
          <div className="summary-card-label">Total Payout</div>
          <div className="summary-card-value-lg">{data ? fmt(data.total_payout) : '—'}</div>
          {data && <div className="summary-card-diff">Difference: {fmt(data.difference)}</div>}
        </div>
      </div>

      {/* Breakdown */}
      <div className="breakdown">
        <div className="breakdown-head">
          <span className="breakdown-title">Full Breakdown</span>
          <button className="btn btn-secondary" onClick={copyBreakdown} disabled={!data || loading}>
            {copied
              ? <><CheckIcon /> Copied!</>
              : <><CopyIcon /> Copy Breakdown</>}
          </button>
        </div>

        {loading && (
          <div className="state-box" style={{ padding: '40px', textAlign: 'center' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />
            Loading...
          </div>
        )}

        {data && !loading && (
          <div className="breakdown-body">
            <div className="breakdown-section">
              {ROWS.map(row => (
                <div key={row.key} className={`brow ${data[row.key] === 0 ? 'brow-zero' : ''}`}>
                  <span className="brow-label">{row.label}</span>
                  <span className={`brow-value ${valueClass(data[row.key])}`}>{fmt(data[row.key])}</span>
                </div>
              ))}
            </div>

            <div className="breakdown-divider" />

            <div className="breakdown-section">
              <div className="brow brow-total">
                <span className="brow-label">Total Payout</span>
                <span className="brow-value val-total">{fmt(data.total_payout)}</span>
              </div>
              <div className="brow">
                <span className="brow-label">Difference</span>
                <span className={`brow-value ${valueClass(data.difference)}`}>{fmt(data.difference)}</span>
              </div>
            </div>

            <div className="breakdown-divider" />

            <div className="breakdown-section">
              <div className="brow">
                <span className="brow-label">Collectors Tax</span>
                <span className="brow-value val-neutral">{fmt(data.collectors_tax)}</span>
              </div>
              <div className="brow">
                <span className="brow-label">Postage &amp; Packaging</span>
                <span className="brow-value val-neutral">{fmt(data.postage_and_packaging)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}>
      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}>
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  )
}
