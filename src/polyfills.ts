// NEAR wallet selector and signing utilities use the Node Buffer API.
// Browsers do not provide Buffer; install the browser implementation before
// importing React or wallet integrations.
import { Buffer } from 'buffer'

const browser = globalThis as typeof globalThis & { Buffer?: typeof Buffer }
browser.Buffer ??= Buffer
