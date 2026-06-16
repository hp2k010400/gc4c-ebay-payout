import crypto from 'crypto'

const TOKEN_ENDPOINT = 'https://api.ebay.com/identity/v1/oauth2/token'
const FINANCES_HOST = 'apiz.ebay.com'
const FINANCES_PATH = '/sell/finances/v1/transaction'

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

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Token refresh failed: ${res.status} — ${body}`)
  }

  const data = await res.json()
  cachedToken = data.access_token
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
  return cachedToken
}

function buildSignatureHeaders(jwe, privateKeyB64) {
  const created = Math.floor(Date.now() / 1000)
  const sigParamsValue = `("x-ebay-signature-key" "@method" "@path" "@authority");created=${created}`

  const sigBase = [
    `"x-ebay-signature-key": ${jwe}`,
    `"@method": GET`,
    `"@path": ${FINANCES_PATH}`,
    `"@authority": ${FINANCES_HOST}`,
    `"@signature-params": ${sigParamsValue}`,
  ].join('\n')

  const pemKey = `-----BEGIN PRIVATE KEY-----\n${privateKeyB64.trim()}\n-----END PRIVATE KEY-----`
  const sigBytes = crypto.sign(undefined, Buffer.from(sigBase, 'utf8'), pemKey)

  return {
    'x-ebay-signature-key': jwe,
    'Signature-Input': `sig1=${sigParamsValue}`,
    'Signature': `sig1=:${sigBytes.toString('base64')}:`,
  }
}

async function fetchTransactions(accessToken, date) {
  const jwe = process.env.EBAY_JWE.trim()
  const privateKey = process.env.EBAY_SIGNING_PRIVATE_KEY.trim()
  const filter = `transactionDate:[${date}T00:00:00.000Z..${date}T23:59:59.999Z]`

  let transactions = []
  let nextPath = `${FINANCES_PATH}?filter=${encodeURIComponent(filter)}&limit=200`

  while (nextPath) {
    const sigHeaders = buildSignatureHeaders(jwe, privateKey)

    const res = await fetch(`https://${FINANCES_HOST}${nextPath}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...sigHeaders,
      },
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`eBay API error: ${res.status} — ${body}`)
    }

    const data = await res.json()
    transactions = transactions.concat(data.transactions || [])

    if (data.next) {
      const url = new URL(data.next)
      nextPath = url.pathname + url.search
    } else {
      nextPath = null
    }
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
      for (const fee of tx.marketplaceFee || []) {
        const amt = parseFloat(fee.amount?.value || 0)
        if (fee.feeType === 'COLLECTOR_TAX') collectTax += amt
        else if (fee.feeType === 'FINAL_VALUE_FEE_FIXED_PER_ORDER') fvfFix += amt
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
  const total_payout = parseFloat((sales + refunds + charges + postage + hold + claim + adjustment + other + charge).toFixed(2))

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
    total_payout,
    difference: 0,
    collectors_tax: parseFloat(collectTax.toFixed(2)),
    postage_and_packaging: parseFloat(pp.toFixed(2)),
  }
}

export default async function handler(req, res) {
  const date = req.query.date || new Date(Date.now() - 86400000).toISOString().split('T')[0]

  const missing = ['EBAY_CLIENT_ID', 'EBAY_REFRESH_TOKEN', 'EBAY_JWE', 'EBAY_SIGNING_PRIVATE_KEY']
    .filter(k => !process.env[k])
  if (missing.length) {
    return res.status(500).json({ error: `Missing env vars: ${missing.join(', ')}` })
  }

  try {
    const token = await getAccessToken()
    const transactions = await fetchTransactions(token, date)
    const summary = aggregate(transactions)
    res.json({ date, transactionCount: transactions.length, ...summary })
  } catch (err) {
    console.error('Payout API error:', err)
    res.status(500).json({ error: err.message })
  }
}
