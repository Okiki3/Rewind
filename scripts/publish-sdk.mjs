import { mkdir, copyFile } from 'node:fs/promises'

// Publish this library as a standalone module, independent of the React app.
// The GitHub repository remains private while the SDK is still downloadable.
await mkdir('dist/sdk', { recursive: true })
for (const name of ['index.js', 'index.d.ts']) {
  await copyFile('sdk/dist/' + name, 'dist/sdk/' + name)
}
await copyFile('sdk/README.md', 'dist/sdk/README.md')
console.log('REWIND browser SDK published at /rewind/sdk/')
