export default function Layout({ children }) {
  return (
    <>
      <div className="header">
        <div className="header-left">
          <div className="header-logo">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
          </div>
          <span className="header-title">GC4C · eBay Payout</span>
        </div>
        <span className="header-live">
          <span className="header-live-dot" />
          Live
        </span>
      </div>
      {children}
    </>
  )
}
