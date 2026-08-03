import { formatCallDuration } from '@/lib/callDuration'

// Release item #2: timer synchronization. All four surfaces (patient call
// screen, doctor call screen, sticky ActiveCallBanner, Android ongoing
// notification chronometer) must format the same elapsed-seconds value
// identically — this is the single shared formatter they all import.
describe('formatCallDuration', () => {
  test.each([
    [0, '00:00'],
    [5, '00:05'],
    [59, '00:59'],
    [60, '01:00'],
    [61, '01:01'],
    [599, '09:59'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3661, '1:01:01'],
    [7325, '2:02:05'],
  ])('formatCallDuration(%i) === %s', (seconds, expected) => {
    expect(formatCallDuration(seconds)).toBe(expected)
  })

  test('clamps negative values to 00:00 instead of showing a negative timer', () => {
    expect(formatCallDuration(-42)).toBe('00:00')
  })

  test('floors fractional seconds', () => {
    expect(formatCallDuration(65.9)).toBe('01:05')
  })
})
