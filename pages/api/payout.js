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
  let sales = 0, refunds = 0, charges = 0, postage = 0, hold = 0, claim = 0
  let adjustment = 0, other = 0, charge = 0, collectors_tax = 0

  for (const tx of transactions) {
    const net = parseFloat(tx.amount?.value || 0)
    const gross = parseFloat(tx.totalFeeBasisAmount?.value || tx.amount?.value || 0)
    const fees = parseFloat(tx.totalFeeAmount?.value || 0)
    const isDebit = tx.bookingEntry === 'DEBIT'

    switch (tx.transactionType) {
      case 'SALE':
        sales += gross
        charges -= fees
        collectors_tax += parseFloat(tx.ebayCollectedTaxAmount?.value || 0)
        break
      case 'REFUND':
        refunds -= gross
        charges += fees  // fee credits returned on refund
        break
      case 'SHIPPING_LABEL':
        postage -= net
        break
      case 'DISPUTE':
        claim -= net
        break
      case 'CREDIT':
        claim += net   // dispute reversal / credit
        break
      case 'NON_SALE_CHARGE':
        charge -= net
        break
      case 'HOLD':
        hold += isDebit ? -net : net
        break
      case 'ADJUSTMENT':
        adjustment += isDebit ? -net : net
        break
      case 'OTHER':
        other += isDebit ? -net : net
        break
    }
  }

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
    collectors_tax: parseFloat(collectors_tax.toFixed(2)),
    postage_and_packaging: 0,
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
