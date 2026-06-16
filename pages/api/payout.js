// Mock data — replace with real eBay Finances API once tokens are in place
export default function handler(req, res) {
  res.json({
    date: req.query.date || new Date().toISOString().split('T')[0],
    sales: 38259.73,
    refunds: -14401.86,
    charges: -2266.41,
    postage: -81.78,
    hold: 0.00,
    claim: -85.97,
    adjustment: 0.00,
    other: 0.00,
    charge: 0.00,
    total_payout: 21423.71,
    difference: 0.00,
    collectors_tax: 172.77,
    postage_and_packaging: 451.56,
  })
}
