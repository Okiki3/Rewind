import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright-core'

const base = 'http://127.0.0.1:4173/rewind/'
const server = spawn('node', ['server.mjs'], {
  env: { ...process.env, PORT: '4173' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let failed = false
server.stderr.on('data', (buf) => process.stderr.write(buf))
server.stdout.on('data', (buf) => process.stdout.write(buf))

try {
  let available = false
  for (let i = 0; i < 50; i++) {
    try {
      const response = await fetch(base)
      if (response.ok) { available = true; break }
    } catch {}
    await sleep(300)
  }
  if (!available) throw new Error('Local REWIND server did not become available')

  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
    const errors = []
    page.on('pageerror', (err) => { errors.push(err.message); console.error('BROWSER_PAGEERROR:', err.stack || err.message) })
    page.on('console', (message) => { if (message.type() === 'error') console.error('BROWSER_CONSOLE_ERROR:', message.text()) })
    page.on('requestfailed', (request) => console.error('BROWSER_REQUEST_FAILED:', request.url(), request.failure()?.errorText))

    const resp = await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 20000 })
    console.log('HTTP', resp?.status())
    await page.waitForTimeout(2000)
    const rootText = await page.locator('#root').innerText()
    console.log('RENDERED_BODY:', rootText.slice(0, 900))
    await page.screenshot({ path: 'rewind-browser-smoke.png', fullPage: false })
    if (rootText.trim().length < 100 || !rootText.includes('Send NEAR')) {
      throw new Error('Frontend renders an empty or incomplete page')
    }
    if (errors.length) throw new Error('JavaScript error(s): ' + errors.join(' | '))
    // The previous crash surfaced only when signing. Validate browser Buffer
    // explicitly instead of assuming a successfully rendered page is enough.
    const bufferResult = await page.evaluate(() => {
      const BufferCtor = globalThis.Buffer
      if (typeof BufferCtor?.from !== 'function') return 'MISSING'
      return BufferCtor.from('{"recipient":"winner.testnet"}', 'utf8').toString('base64')
    })
    if (bufferResult !== 'eyJyZWNpcGllbnQiOiJ3aW5uZXIudGVzdG5ldCJ9') {
      throw new Error('Browser Buffer API missing or misconfigured: ' + bufferResult)
    }
    console.log('BROWSER_BUFFER_PASS')

    // Check a known real account through the browser, including CORS.
    // A deprecated RPC used to report "Possible mistake" for valid accounts.
    const verifiedAccount = await page.evaluate(async () => {
      const sdk = await import('/rewind/sdk/index.js')
      return await sdk.preflight({
        recipient: 'afrolite.testnet', amountNear: '0.5', network: 'testnet',
      })
    })
    if (!verifiedAccount.verifiedAccount || !verifiedAccount.valid) {
      throw new Error('A real account is incorrectly rejected: ' + JSON.stringify(verifiedAccount))
    }
    if (verifiedAccount.warnings.some((warning) => warning.code === 'unverified' || warning.code === 'missing_account')) {
      throw new Error('Incorrect address warning for real account: ' + JSON.stringify(verifiedAccount))
    }
    console.log('BROWSER_REAL_RECIPIENT_VERIFIED')

    const heroText = await page.locator('.hero').innerText()
    if (!heroText.includes('Send NEAR with confidence.') ||
        !heroText.includes('Check recipient details before you send.') ||
        heroText.includes('00:42') || heroText.includes('60S PROTECTION')) {
      throw new Error('Homepage copy regressed or contains misleading static countdown')
    }
    const sendButton = page.locator('.hero-actions .button').first()
    const sendBounds = await sendButton.boundingBox()
    if (!sendBounds || sendBounds.y + sendBounds.height > 768) {
      throw new Error('Protected-send hero CTA falls below the desktop viewport')
    }
    const creditLink = page.locator('footer .footer-about a')
    if ((await creditLink.innerText()).trim() !== 'Afrolite' ||
        (await creditLink.getAttribute('href')) !== 'https://x.com/kisc_0') {
      throw new Error('Built by Afrolite footer attribution/link is missing or incorrect')
    }
    console.log('HOMEPAGE_COPY_CTA_AND_FOOTER_PASS')

    // The responsive layout should remain usable, with readable footer links.
    await page.setViewportSize({ width: 390, height: 844 })
    const mobileWidth = await page.evaluate(() => ({
      screen: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }))
    if (mobileWidth.content > mobileWidth.screen + 3) {
      throw new Error('Homepage overflows the mobile viewport: ' + JSON.stringify(mobileWidth))
    }
    await creditLink.scrollIntoViewIfNeeded()
    if (!(await creditLink.isVisible())) throw new Error('Afrolite link is not visible on mobile')
    console.log('MOBILE_LAYOUT_AND_FOOTER_PASS')
    await page.setViewportSize({ width: 1366, height: 768 })

    const sdk = await page.request.get(base + 'sdk/index.js')
    console.log('SDK_HTTP', sdk.status(), 'TYPE', sdk.headers()['content-type'])
    const sdkTypes = await page.request.get(base + 'sdk/index.d.ts')
    if (!sdkTypes.ok() || !(sdkTypes.headers()['content-type'] || '').startsWith('text/plain')) {
      throw new Error('TypeScript declarations were not served as text')
    }
    if (sdk.headers()['access-control-allow-origin'] !== '*') {
      throw new Error('Public wallet SDK cannot be imported cross-origin')
    }
    const badSdk = await page.request.get(base + 'sdk/nonexistent-sdk.js')
    if (badSdk.status() !== 404) throw new Error('Missing SDK file must return HTTP 404')
    if (!sdk.ok() || !(await sdk.text()).includes('buildProtectedSendTransaction')) {
      throw new Error('Public SDK is missing or unreadable')
    }

    await page.getByRole('button', { name: /connect near wallet/i }).click()
    await page.waitForTimeout(1000)
    if (errors.length) throw new Error('Wallet chooser JavaScript error(s): ' + errors.join(' | '))
    const chooser = await page.locator('body').innerText()
    console.log('AFTER_CLICK:', chooser.slice(-700))
    if (!/Meteor|Sender|MyNearWallet|NEAR Mobile|Connect/i.test(chooser)) {
      throw new Error('Wallet chooser not visible')
    }
    // Simulate the real Send click with a connected MyNearWallet account.
    // The wallet asks an RPC for a block before it opens its approval popup;
    // intercept the RPC and delay it so a missing pre-open is reproducible.
    const sendPage = await browser.newPage({ viewport: { width: 1366, height: 768 } })
    await sendPage.goto(base, { waitUntil: 'domcontentloaded' })
    await sendPage.evaluate(() => {
      localStorage.setItem('near-wallet-selector:selectedWalletId', JSON.stringify('my-near-wallet'))
      localStorage.setItem('near-wallet-selector:contract', JSON.stringify({
        contractId: 'rewind.rewindproof-mwfi8ufi-fa888154e57d.testnet',
        methodNames: [],
      }))
      localStorage.setItem('signedAccountId', 'sender.testnet')
    })
    await sendPage.route('https://rpc.testnet.fastnear.com/**', async (route) => {
      const request = route.request().postDataJSON()
      if (request.method === 'query' && request.params?.request_type === 'view_account') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            jsonrpc: '2.0', id: request.id,
            result: { code_hash: '11111111111111111111111111111111' },
          }),
        })
        return
      }
      if (request.method === 'query' && request.params?.request_type === 'call_function') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { result: [91, 93] } }),
        })
        return
      }
      if (request.method === 'block') {
        await sleep(1800)
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            jsonrpc: '2.0', id: request.id,
            result: { header: { hash: '11111111111111111111111111111111' } },
          }),
        })
        return
      }
      await route.continue()
    })
    await sendPage.reload({ waitUntil: 'domcontentloaded' })
    await sendPage.getByRole('button', { name: /sender\.te.*disconnect/i }).waitFor({ timeout: 12000 })
    await sendPage.getByPlaceholder('friend.testnet').fill('winner.testnet')
    await sendPage.getByRole('button', { name: /^Review payment/ }).click()
    await sendPage.getByRole('button', { name: /^Confirm and send NEAR/ }).waitFor({ timeout: 12000 })
    // The popup must exist immediately from the user click, BEFORE block RPC finishes.
    const popupEvent = sendPage.waitForEvent('popup', { timeout: 4500 })
    await sendPage.getByRole('button', { name: /^Confirm and send NEAR/ }).click()
    const approvalPopup = await popupEvent
    const popupName = await approvalPopup.evaluate(() => window.name)
    if (popupName !== 'MyNearWallet') throw new Error('Unexpected wallet approval window: ' + popupName)
    console.log('MY_NEAR_WALLET_POPUP_PASS')
    await approvalPopup.close()
    await sendPage.close()

    // Verify active payment status appears by itself on reload, not only
    // after a user clicks Recent transfers. Use a mocked READ-ONLY RPC.
    const receiptPage = await browser.newPage({ viewport: { width: 1320, height: 850 } })
    await receiptPage.goto(base, { waitUntil: 'domcontentloaded' })
    const contract = 'rewind.rewindproof-mwfi8ufi-fa888154e57d.testnet'
    const account = 'sender.testnet'
    const hash = '5RN3qgGTjnqJHNwd4PF6mtooYNdTSMDPsq4hDPBhQDXJ'
    const start = Date.now() - 4_000
    const testTransfer = {
      id:'8',sender:account,recipient:'winner.testnet',
      amount:'100000000000000000000000',
      created_at_ms:String(start),expires_at_ms:String(start+60000),
      settled_at_ms:null,status:'Pending',
    }
    await receiptPage.evaluate(({ contract, account, hash }) => {
      localStorage.setItem('near-wallet-selector:selectedWalletId', JSON.stringify('my-near-wallet'))
      localStorage.setItem('near-wallet-selector:contract', JSON.stringify({ contractId:contract, methodNames:[] }))
      localStorage.setItem('signedAccountId',account)
      const key = ['rewind','payments','testnet',contract,account].join(':')
      localStorage.setItem(key,JSON.stringify({'8':hash}))
      localStorage.setItem(key+':last','8')
    }, { contract, account, hash })
    await receiptPage.route('https://rpc.testnet.fastnear.com/**', async (route) => {
      const request=route.request().postDataJSON()
      if (request.method === 'query' && request.params?.request_type === 'call_function') {
        const method = request.params.method_name
        const value = method === 'get_transfer' ? testTransfer :
          method === 'get_transfers_for_account' ? [testTransfer] : []
        const encoded = [...Buffer.from(JSON.stringify(value),'utf8')]
        await route.fulfill({
          status:200,contentType:'application/json',
          body:JSON.stringify({jsonrpc:'2.0',id:request.id,result:{result:encoded}}),
        })
        return
      }
      await route.continue()
    })
    await receiptPage.reload({ waitUntil:'domcontentloaded' })
    const receiptCard=receiptPage.locator('.payment-receipt')
    await receiptCard.waitFor({timeout:15000})
    if (!(await receiptCard.innerText()).includes('TRANSFER #8')) {
      throw new Error('Last successful payment was not automatically selected')
    }
    const clockText=await receiptCard.locator('.receipt-clock').innerText()
    if (!clockText.includes('Time left to cancel') || !clockText.includes(':')) {
      throw new Error('The active transfer countdown was not visible')
    }
    const hashText=await receiptCard.locator('.receipt-hash code').innerText()
    if (hashText !== hash) throw new Error('Transaction hash missing from live receipt')
    const link=receiptCard.getByRole('link',{name:/View transaction/i})
    if (!(await link.getAttribute('href')).endsWith('/txns/'+hash)) {
      throw new Error('Explorer link does not point at the confirmed NEAR hash')
    }
    const recent=receiptPage.locator('.history-entry')
    await recent.first().waitFor({timeout:10000})
    const historyLink=recent.first().locator('.history-hash a')
    if (!(await historyLink.getAttribute('href')).endsWith('/txns/'+hash)) {
      throw new Error('Transaction hash missing from Recent transfers')
    }
    await receiptPage.screenshot({path:'rewind-browser-receipt.png',fullPage:false})
    console.log('AUTO_ACTIVE_TRANSFER_AND_HASH_PASS')
    await receiptPage.close()

    // Simulate a wallet app's injected Bitget NEAR provider on an Android
    // in-app browser. The official selector Bitget module returns null on
    // mobile; an injected provider must connect in-place without redirect.
    const bitgetPage = await browser.newPage({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
    })
    await bitgetPage.addInitScript(() => {
      const state = { connected: false, signIns: 0, signed: [], contractId: '', transfer: null }
      window.__rewindBitgetTest = state
      window.bitkeep = { near: {
        isSignedIn: () => state.connected,
        getAccountId: () => state.connected ? 'afrolite.testnet' : '',
        requestSignIn: async ({ contractId }) => {
          state.signIns += 1
          state.contractId = contractId
          state.connected = true
          return { accessKey: { publicKey: 'ed25519:mock-public-key' } }
        },
        signOut: async () => { state.connected = false; return true },
        signAndSendTransaction: async ({ receiverId, actions }) => {
          state.signed.push({ receiverId, actions })
          const created = Date.now()
          state.transfer = {
            id: '43', sender: 'afrolite.testnet', recipient: 'winner.testnet',
            amount: '100000000000000000000000', created_at_ms: String(created),
            expires_at_ms: String(created + 60_000), settled_at_ms: null, status: 'Pending',
          }
          return { response: [{
            transaction: { hash: '5RN3qgGTjnqJHNwd4PF6mtooYNdTSMDPsq4hDPBhQDXJ' },
            status: { SuccessValue: btoa(JSON.stringify(state.transfer)) },
            receipts_outcome: [],
          }] }
        },
      } }
    })
    await bitgetPage.route('https://rpc.testnet.fastnear.com/**', async (route) => {
      const request = route.request().postDataJSON()
      if (request.method === 'query' && request.params?.request_type === 'view_account') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ jsonrpc: '2.0', id: request.id,
            result: { code_hash: '11111111111111111111111111111111' } }),
        })
      } else if (request.method === 'query' && request.params?.request_type === 'call_function') {
        const state = await bitgetPage.evaluate(() => window.__rewindBitgetTest)
        const value = request.params.method_name === 'get_transfer'
          ? state.transfer : request.params.method_name === 'get_transfers_for_account'
            ? (state.transfer ? [state.transfer] : []) : []
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ jsonrpc: '2.0', id: request.id,
            result: { result: [...Buffer.from(JSON.stringify(value), 'utf8')] } }),
        })
      } else {
        await route.continue()
      }
    })
    await bitgetPage.goto(base, { waitUntil: 'domcontentloaded' })
    const bitgetInitialUrl = bitgetPage.url()
    await bitgetPage.getByRole('button', { name: /connect near wallet/i }).click()
    await bitgetPage.getByRole('button', { name: /afrolite\.testnet.*disconnect/i }).waitFor({ timeout: 12000 })
    const connectedState = await bitgetPage.evaluate(() => window.__rewindBitgetTest)
    if (connectedState.signIns !== 1 ||
      connectedState.contractId !== 'rewind.rewindproof-mwfi8ufi-fa888154e57d.testnet' ||
      bitgetPage.url() !== bitgetInitialUrl) {
      throw new Error('Injected Bitget mobile connection failed or redirected externally: ' + JSON.stringify(connectedState))
    }
    console.log('BITGET_IN_APP_CONNECT_NO_REDIRECT_PASS')
    await bitgetPage.getByPlaceholder('friend.testnet').fill('winner.testnet')
    await bitgetPage.getByRole('button', { name: /^Review payment/ }).click()
    await bitgetPage.getByRole('button', { name: /^Confirm and send NEAR/ }).waitFor({ timeout: 12000 })
    await bitgetPage.getByRole('button', { name: /^Confirm and send NEAR/ }).click()
    const bitgetReceipt = bitgetPage.locator('.payment-receipt')
    await bitgetReceipt.waitFor({ timeout: 12000 })
    if (!(await bitgetReceipt.innerText()).includes('TRANSFER #43')) {
      throw new Error('Bitget signed transfer did not appear in status panel')
    }
    const signedState = await bitgetPage.evaluate(() => window.__rewindBitgetTest)
    if (signedState.signed.length !== 1 ||
      signedState.signed[0].receiverId !== signedState.contractId ||
      signedState.signed[0].actions.length !== 1 ||
      bitgetPage.url() !== bitgetInitialUrl) {
      throw new Error('Bitget provider did not receive the protected contract call')
    }
    await bitgetPage.screenshot({ path: 'rewind-browser-mobile-wallet.png', fullPage: false })
    console.log('BITGET_IN_APP_PROTECTED_SEND_PASS')
    await bitgetPage.close()

    // If Bitget's browser doesn't inject NEAR (for example a different
    // network is selected), do not offer an unrelated redirect login.
    const unavailablePage = await browser.newPage({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Mobile Safari/537.36',
    })
    await unavailablePage.addInitScript(() => { window.bitkeep = {} })
    await unavailablePage.goto(base, { waitUntil: 'domcontentloaded' })
    const beforeUnavail = unavailablePage.url()
    await unavailablePage.getByRole('button', { name: /connect near wallet/i }).click()
    await unavailablePage.getByText('Bitget Wallet did not provide a NEAR account', { exact: false }).waitFor({ timeout: 10000 })
    if (unavailablePage.url() !== beforeUnavail) {
      throw new Error('Unavailable Bitget NEAR provider caused external redirect')
    }
    console.log('BITGET_UNAVAILABLE_NEAR_PROVIDER_GUIDANCE_PASS')
    await unavailablePage.close()

    const wrongNetworkPage = await browser.newPage({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Mobile Safari/537.36',
    })
    await wrongNetworkPage.addInitScript(() => {
      window.bitkeep = { near: {
        isSignedIn: () => true,
        getAccountId: () => 'alice.near',
        requestSignIn: async () => ({ accessKey: {} }),
        signOut: async () => true,
        signAndSendTransaction: async () => { throw new Error('Wrong network must never sign') },
      } }
    })
    await wrongNetworkPage.goto(base, { waitUntil: 'domcontentloaded' })
    const wrongNetworkStart = wrongNetworkPage.url()
    await wrongNetworkPage.getByRole('button', { name: /connect near wallet/i }).click()
    await wrongNetworkPage.getByText('NEAR Mainnet account', { exact: false }).waitFor({ timeout: 10000 })
    if (wrongNetworkPage.url() !== wrongNetworkStart) {
      throw new Error('Wrong-network Bitget connection redirected away from Testnet app')
    }
    console.log('BITGET_MAINNET_REJECTION_NO_REDIRECT_PASS')
    await wrongNetworkPage.close()

    // A single website must let people switch networks without ever sending
    // Testnet escrow funds to Mainnet. Test Mainnet preview on a phone viewport.
    const mainnetPage = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await mainnetPage.addInitScript(() => {
      window.__mainnetSignedTransactions = 0
      window.bitkeep = { near: {
        isSignedIn: () => true,
        getAccountId: () => 'alice.near',
        requestSignIn: async () => ({ accessKey: {} }),
        signOut: async () => true,
        signAndSendTransaction: async () => { window.__mainnetSignedTransactions++; throw Error('Mainnet signing forbidden') },
      } }
    })
    const queriedNetworks = []
    await mainnetPage.route('https://rpc.mainnet.fastnear.com/**', async (route) => {
      const request = route.request().postDataJSON()
      queriedNetworks.push(request?.method ?? 'unknown')
      if (request?.method === 'query' && request.params?.request_type === 'view_account') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ jsonrpc: '2.0', id: request.id,
            result: { code_hash: '11111111111111111111111111111111' } }),
        })
      } else {
        await route.abort('failed')
      }
    })
    await mainnetPage.goto(base + '?network=mainnet', { waitUntil: 'domcontentloaded' })
    await mainnetPage.getByRole('heading', { name: 'Mainnet preview' }).waitFor({ timeout: 12000 })
    const activeNetwork = await mainnetPage.getByRole('switch', { name: /mainnet selected/i }).getAttribute('aria-checked')
    if (activeNetwork !== 'true' || await mainnetPage.getByRole('button', { name: /Connect NEAR wallet/i }).count()) {
      throw new Error('Mainnet preview selected incorrectly or attempted live wallet connection')
    }
    const mainnetWidth = await mainnetPage.evaluate(() => ({
      available: document.documentElement.clientWidth,
      actual: document.documentElement.scrollWidth,
    }))
    if (mainnetWidth.actual > mainnetWidth.available + 3) {
      throw new Error('Mainnet preview overflows mobile viewport: ' + JSON.stringify(mainnetWidth))
    }
    await mainnetPage.getByPlaceholder('friend.near').fill('afrolite.near')
    await mainnetPage.getByRole('button', { name: /Check Mainnet recipient/i }).click()
    await mainnetPage.getByText('Read-only review:', { exact: false }).waitFor({ timeout: 12000 })
    const inspected = await mainnetPage.locator('.preflight-review').innerText()
    if (!inspected.includes('afrolite.near') || !inspected.includes('No payment will be submitted') ||
        !queriedNetworks.includes('query')) {
      throw new Error('Mainnet account verification did not use Mainnet RPC correctly: ' + inspected)
    }
    if (await mainnetPage.locator('.payment-receipt, .history-entry').count()) {
      throw new Error('Mainnet preview displayed data from Testnet transfer history')
    }
    if ((await mainnetPage.evaluate(() => window.__mainnetSignedTransactions)) !== 0) {
      throw new Error('Mainnet preview invoked wallet signing')
    }
    await mainnetPage.screenshot({ path: 'rewind-browser-mainnet-preview.png', fullPage: false })
    console.log('MAINNET_COMPACT_PREVIEW_READONLY_AND_RPC_PASS')

    // Going back must restore the existing functional Testnet payment UI.
    await mainnetPage.getByRole('switch', { name: /mainnet selected/i }).click()
    await mainnetPage.waitForURL('**/rewind/?network=testnet')
    await mainnetPage.getByRole('button', { name: /Connect NEAR wallet/i }).waitFor({ timeout: 12000 })
    if (await mainnetPage.getByRole('button', { name: /Confirm and send NEAR/i }).count()) {
      throw new Error('Testnet payment review unexpectedly skipped after switching networks')
    }
    if (await mainnetPage.getByRole('switch', { name: /testnet selected/i }).getAttribute('aria-checked') !== 'false') {
      throw new Error('Switching back did not restore the Testnet toggle')
    }
    await mainnetPage.getByRole('switch', { name: /testnet selected/i }).click()
    await mainnetPage.waitForURL('**/rewind/?network=mainnet')
    if (await mainnetPage.getByRole('switch', { name: /mainnet selected/i }).getAttribute('aria-checked') !== 'true') {
      throw new Error('Switching to Mainnet again did not update the toggle')
    }
    console.log('TESTNET_MAINNET_SWITCH_ROUNDTRIP_PASS')
    await mainnetPage.close()

    console.log('BROWSER_SMOKE_PASS')
  } finally { await browser.close() }
} catch (error) {
  failed = true
  console.error('BROWSER_SMOKE_FAILURE:', error)
} finally {
  server.kill('SIGTERM')
}
if (failed) process.exitCode = 1
