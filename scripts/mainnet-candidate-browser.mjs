import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright-core'

const base = 'http://127.0.0.1:4174/rewind/'
const fakeCodeHash = '8WFiJRVvrvySGFrsMnf3wxdpMzz4wWL8RkYSxFdW44Q'
const server = spawn('node', ['server.mjs'], {
  env: { ...process.env, PORT: '4174' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let failed = false
server.stderr.on('data', (x) => process.stderr.write(x))
server.stdout.on('data', (x) => process.stdout.write(x))

try {
  let ready = false
  for (let n = 0; n < 50; n++) {
    try { if ((await fetch(base)).ok) { ready = true; break } } catch {}
    await sleep(300)
  }
  if (!ready) throw Error('Candidate frontend did not start')
  const browser = await chromium.launch({
    channel: 'chrome', headless: true, args: ['--no-sandbox'],
  })
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
    })
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(e.message))
    await page.addInitScript(() => {
      const x = {
        account: 'alice.near', connected: false, signIns: 0, signed: [],
        transfer: null, forceWrongHash: false,
      }
      window.__candidateWallet = x
      window.bitkeep = { near: {
        isSignedIn: () => x.connected,
        getAccountId: () => x.connected ? x.account : '',
        requestSignIn: async () => {
          x.signIns += 1
          x.connected = true
          return { accessKey: { publicKey: 'ed25519:mock' } }
        },
        signOut: async () => { x.connected = false; return true },
        signAndSendTransaction: async ({receiverId, actions}) => {
          x.signed.push({receiverId, actions})
          const isCancel = JSON.stringify(actions).includes('cancel')
          const now = Date.now()
          if (!x.transfer) x.transfer = {
            id: '4', sender: 'alice.near', recipient: 'bob.near',
            amount: '100000000000000000000000',
            created_at_ms: String(now), expires_at_ms: String(now+60_000),
            settled_at_ms: null, status: 'Pending',
          }
          if (isCancel) {
            x.transfer.status = 'Cancelled'
            x.transfer.settled_at_ms = String(now)
          }
          return { response: [{
            transaction: { hash: '5RN3qgGTjnqJHNwd4PF6mtooYNdTSMDPsq4hDPBhQDXJ' },
            status: { SuccessValue: btoa(JSON.stringify(x.transfer)) },
            receipts_outcome: [],
          }] }
        },
      } }
    })
    await page.route('https://rpc.mainnet.fastnear.com/**', async (route) => {
      const body = route.request().postDataJSON()
      if (body.method !== 'query') return route.abort('failed')
      const params = body.params ?? {}
      let result
      if (params.request_type === 'view_account') {
        result = {
          code_hash: params.account_id === 'rewind.near'
            ? fakeCodeHash : '11111111111111111111111111111111',
        }
      } else if (params.request_type === 'call_function') {
        const st = await page.evaluate(() => window.__candidateWallet)
        const value = params.method_name === 'get_transfer'
          ? st.transfer
          : params.method_name === 'get_transfers_for_account'
            ? (st.transfer ? [st.transfer] : []) : null
        result = { result: [...Buffer.from(JSON.stringify(value), 'utf8')] }
      } else {
        return route.abort('failed')
      }
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({jsonrpc:'2.0',id:body.id,result}),
      })
    })
    await page.goto(base+'?network=mainnet', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', {name:/connect near wallet/i}).click()
    await page.getByRole('button', {name:/alice\.near.*disconnect/i}).waitFor({timeout: 12000})
    const connected = await page.evaluate(() => window.__candidateWallet)
    if (connected.signIns!==1 || connected.signed.length!==0) {
      throw Error('Mainnet candidate wallet did not connect properly')
    }
    console.log('MAINNET_CANDIDATE_MOBILE_WALLET_CONNECT_PASS')
    await page.getByPlaceholder('friend.near').fill('bob.near')
    await page.locator('input[type=number]').first().fill('0.1')
    await page.getByRole('button',{name:/review payment/i}).click()
    const fee = page.getByText('Storage fee: 0.02 NEAR', {exact:false})
    await fee.waitFor({timeout:12000})
    await page.getByRole('button',{name:/confirm and send near/i}).click()
    await page.locator('.payment-receipt').waitFor({timeout:12000})
    const st = await page.evaluate(() => window.__candidateWallet)
    if(st.signed.length!==1 || st.signed[0].receiverId!=='rewind.near' ||
      !JSON.stringify(st.signed[0].actions).includes('transfer_amount')) {
      throw Error('Mainnet signed transaction missing V2 ABI')
    }
    if (!(await page.locator('.payment-receipt').innerText()).includes('TRANSFER #4')) {
      throw Error('Mainnet status receipt did not appear')
    }
    console.log('MAINNET_CANDIDATE_SIGNED_V2_TRANSFER_MOCK_PASS')
    await page.screenshot({path:'rewind-mainnet-candidate-mobile.png',fullPage:false})
    await page.getByRole('button',{name:/cancel transfer/i}).click()
    await page.getByText('Cancellation complete', {exact:false}).waitFor({timeout:12000})
    const after = await page.evaluate(() => window.__candidateWallet)
    if(after.signed.length!==2) throw Error('Cancel did not request separate wallet signature')
    console.log('MAINNET_CANDIDATE_CANCEL_MOCK_PASS')
    if(pageErrors.length) throw Error('Mobile browser errors: '+pageErrors.join('; '))
    await page.close()
    console.log('MAINNET_CANDIDATE_BROWSER_SMOKE_PASS')
  } finally { await browser.close() }
} catch(err) {
  failed = true
  console.error('MAINNET_CANDIDATE_BROWSER_SMOKE_FAILURE:',err)
} finally { server.kill('SIGTERM') }
if(failed) process.exitCode=1
