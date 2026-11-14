export function parseNear(value: string) {
  if (!/^\d+(\.\d{0,24})?$/.test(value)) throw new Error('Enter a valid NEAR amount')
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * 10n ** 24n + BigInt((fraction + '0'.repeat(24)).slice(0, 24))
}

export function formatNear(yocto: string) {
  const value = BigInt(yocto)
  const whole = value / 10n ** 24n
  const fraction = (value % 10n ** 24n).toString().padStart(24, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}
