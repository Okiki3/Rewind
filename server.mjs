import { createHash } from 'node:crypto'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const app = express()
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist')
const staticOptions = { immutable: true, maxAge: '1y', index: false }

app.get('/health', (_request, response) => response.json({ ok: true, service: 'rewind' }))

// Public, read-only *bytecode* proxy, not a transaction endpoint. The exact
// sha256 is checked before serving it. No private keys or blockchain signing.
app.get('/rewind/release/rewind-v2-candidate.wasm', async (_request, response) => {
  try {
    const digest = '9a15f0f7cd347566982a5dbbf7eb994037c1932bed2f22f8c1c14981975ac333'
    const url = 'https://github.com/Okiki3/Rewind/releases/download/rewind-v2-audit-candidate-20261114/rewind-v2-candidate-' + digest + '.wasm'
    const upstream = await fetch(url, {
      signal: AbortSignal.timeout(18000),
      headers: { 'User-Agent': 'RewindPinnedWasm/1.0', Accept: 'application/octet-stream' },
    })
    if (!upstream.ok) throw Error('Release asset unavailable (' + upstream.status + ')')
    const bytes = Buffer.from(await upstream.arrayBuffer())
    if (bytes.length !== 219854 || createHash('sha256').update(bytes).digest('hex') !== digest) {
      throw Error('Public WASM does not match audited-candidate pinned release SHA256')
    }
    response.setHeader('Content-Type', 'application/wasm')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.send(bytes)
  } catch (err) {
    console.error('Refused unverifiable WASM:', String(err))
    response.status(503).type('text/plain').send('Verifiable candidate WASM unavailable; no contract signing is possible')
  }
})

// SDK code and types are intentionally public so third-party wallet
// websites can import the ESM module. No signing keys or credentials live here.
app.use('/rewind/sdk', (_request, response, next) => {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  next()
})
// The .ts extension is otherwise misidentified as an MPEG transport stream.
// This file contains public TypeScript declarations, not video content.
app.get('/rewind/sdk/index.d.ts', (_request, response) => {
  response.type('text/plain').sendFile(path.join(root, 'sdk', 'index.d.ts'))
})
app.use('/rewind/sdk', express.static(path.join(root, 'sdk'), { maxAge: '5m', index: false, dotfiles: 'deny' }))
// Do not serve the website HTML as if a missing SDK JavaScript file existed.
app.use('/rewind/sdk', (_request, response) => response.status(404).type('text/plain').send('SDK file not found'))
app.use('/rewind', express.static(root, staticOptions))
app.use(express.static(root, staticOptions))
app.use((_request, response) => response.sendFile(path.join(root, 'index.html')))

const port = Number(process.env.PORT || 4173)
app.listen(port, '0.0.0.0', () => console.log(`REWIND listening on ${port}`))
