const TOKEN_ENDPOINT = 'https://api.ebay.com/identity/v1/oauth2/token'
const FINANCES_ENDPOINT = 'https://apiz.ebay.com/sell/finances/v1/transaction'

let cachedToken = null
let tokenExpiry = 0

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken

  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
  ).toString('base64')

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(process.env.EBAY_REFRESH_TOKEN)}`,
  })

  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`)

  const data = await res.json()
  cachedToken = data.access_token
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
  return cachedToken
}

async function fetchTransactions(accessToken, date) {
  const start = `${date}T00:00:00.000Z`
  const end = `${date}T23:59:59.999Z`

  const params = new URLSearchParams({
    filter: `transactionDate:[${start}..${end}]`,
    limit: '200',
  })

  let transactions = []
  let href = `${FINANCES_ENDPOINT}?${params}`

  while (href) {
    const res = await fetch(href, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Language': 'en-GB' },
    })
    if (!res.ok) throw new Error(`eBay API error: ${res.status}`)
    const data = await res.json()
    transactions = transactions.concat(data.transactions || [])
    href = data.next || null
  }

  return transactions
}

function aggregate(transactions) {
  let sales = 0, refunds = 0, postage = 0, hold = 0, claim = 0
  let adjustment = 0, other = 0, charge = 0
  let fvfFix = 0, fvfVar = 0, vhiFee = 0, bspFee = 0, intFee = 0
  let collectTax = 0, pp = 0

  for (const tx of transactions) {
    const net = parseFloat(tx.amount?.value || 0)
    const gross = parseFloat(tx.totalFeeBasisAmount?.value || tx.amount?.value || 0)
    const type = tx.transactionType

    if (type === 'SALE') {
      sales += gross
      pp += parseFloat(tx.shippingCharge?.value || 0)
      collectTax += parseFloat(tx.marketplaceFee?.find(f => f.feeType === 'COLLECTOR_TAX')?.amount?.value || 0)
      for (const fee of tx.marketplaceFee || []) {
        const amt = parseFloat(fee.amount?.value || 0)
        if (fee.feeType === 'FINAL_VALUE_FEE_FIXED_PER_ORDER') fvfFix += amt
        else if (fee.feeType === 'FINAL_VALUE_FEE_VARIABLE_PER_ORDER') fvfVar += amt
        else if (fee.feeType === 'VERY_HIGH_ITEM_NOT_AS_DESCRIBED') vhiFee += amt
        else if (fee.feeType === 'BELOW_STANDARD_PERFORMANCE_FEE') bspFee += amt
        else if (fee.feeType === 'INTERNATIONAL_FEE') intFee += amt
      }
    } else if (type === 'REFUND') {
      refunds += gross
    } else if (type === 'SHIPPING_LABEL') {
      postage += net
    } else if (type === 'HOLD') {
      hold += net
    } else if (type === 'DISPUTE') {
      claim += net
    } else if (type === 'ADJUSTMENT') {
      adjustment += net
    } else if (type === 'OTHER') {
      other += net
    } else if (type === 'NON_SALE_CHARGE') {
      charge += net
    }
  }

  const charges = fvfFix + fvfVar + vhiFee + bspFee + intFee
  const subtotal = sales + refunds + charges + postage + hold + claim + adjustment + other + charge
  const totalPayout = parseFloat(subtotal.toFixed(2))

  return {
    sales: parseFloat(sales.toFixed(2)),
    refunds: parseFloat(refunds.toFixed(2)),
    charges: parseFloat(charges.toFixed(2)),
    postage: parseFloat(postage.toFixed(2)),
    hold: parseFloat(hold.toFixed(2)),
    claim: parseFloat(claim.toFixed(2)),
    adjustment: parseFloat(adjustment.toFixed(2)),
    other: parseFloat(other.toFixed(2)),
    charge: parseFloat(charge.toFixed(2)),
    total_payout: totalPayout,
    difference: 0,
    collectors_tax: parseFloat(collectTax.toFixed(2)),
    postage_and_packaging: parseFloat(pp.toFixed(2)),
  }
}

export default async function handler(req, res) {
  const date = req.query.date || new Date(Date.now() - 86400000).toISOString().split('T')[0]

  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_REFRESH_TOKEN) {
    return res.status(500).json({ error: 'Missing env vars — EBAY_CLIENT_ID or EBAY_REFRESH_TOKEN not set' })
  }

  try {
    const token = await getAccessToken()
    const transactions = await fetchTransactions(token, date)
    const summary = aggregate(transactions)
    res.json({ date, transactionCount: transactions.length, ...summary })
  } catch (err) {
    console.error('Payout API error:', err)
    res.status(500).json({ error: err.message, stack: err.stack })
  }
}
