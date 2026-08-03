// Regression guard for lib/realtimeChannelManager.ts — the shared,
// ref-counted replacement for the old per-mount `${Date.now()}`-suffixed
// channel-name workaround (see memory: "Prefer Singleton Over
// Unique-Channel-Name for Realtime Hooks"). These tests exercise the manager
// against a fake Supabase Realtime client that mirrors the real one's
// topic-dedup + async unsubscribe/teardown behavior closely enough to catch
// the exact race the old pattern was working around.

type OnHandler = (payload: unknown) => void

class FakeChannel {
  handlers: OnHandler[] = []
  subscribed = false
  torndown = false
  constructor(public topic: string) {}
  on(_type: string, _filter: unknown, cb: OnHandler) {
    this.handlers.push(cb)
    return this
  }
  subscribe() {
    this.subscribed = true
    return this
  }
  emit(payload: unknown) {
    for (const h of this.handlers) h(payload)
  }
}

class FakeRealtimeClient {
  channels: FakeChannel[] = []
  channelCalls = 0
  removeChannelCalls = 0
  pendingUnsubscribes: Array<() => void> = []

  channel(topic: string) {
    const existing = this.channels.find((c) => c.topic === topic && !c.torndown)
    if (existing) return existing
    this.channelCalls += 1
    const chan = new FakeChannel(topic)
    this.channels.push(chan)
    return chan
  }

  // Mirrors the real RealtimeClient.removeChannel: async unsubscribe, then
  // teardown only removes it from the live list once that resolves — so a
  // same-tick `channel(topic)` call for the same topic would otherwise hand
  // back this same not-yet-torn-down instance.
  removeChannel(chan: FakeChannel) {
    this.removeChannelCalls += 1
    return new Promise<void>((resolve) => {
      this.pendingUnsubscribes.push(() => {
        chan.torndown = true
        resolve()
      })
    })
  }

  flushUnsubscribes() {
    const pending = this.pendingUnsubscribes
    this.pendingUnsubscribes = []
    pending.forEach((fn) => fn())
  }
}

let fakeClient: FakeRealtimeClient

jest.mock('@/lib/supabase', () => ({
  get supabase() {
    return fakeClient
  },
}))

let subscribeRealtime: typeof import('@/lib/realtimeChannelManager').subscribeRealtime
let getSharedRealtimeStats: typeof import('@/lib/realtimeChannelManager').getSharedRealtimeStats

beforeEach(() => {
  fakeClient = new FakeRealtimeClient()
  jest.useFakeTimers()
  // The manager keeps its ref-counted registry in module-level state, so
  // each test needs a fresh module instance rather than one shared across
  // the whole file.
  jest.resetModules()
  ;({ subscribeRealtime, getSharedRealtimeStats } = require('@/lib/realtimeChannelManager'))
})

afterEach(() => {
  jest.useRealTimers()
})

describe('subscribeRealtime', () => {
  test('two consumers of the same topic share one channel and one .on() registration', () => {
    const events: unknown[] = []
    const unsubA = subscribeRealtime(
      'users:id=eq.1',
      [{ event: 'UPDATE', schema: 'public', table: 'users', filter: 'id=eq.1' }],
      (event, payload) => events.push(['A', event, payload]),
    )
    const unsubB = subscribeRealtime(
      'users:id=eq.1',
      [{ event: 'UPDATE', schema: 'public', table: 'users', filter: 'id=eq.1' }],
      (event, payload) => events.push(['B', event, payload]),
    )

    expect(fakeClient.channelCalls).toBe(1)
    expect(fakeClient.channels[0].handlers).toHaveLength(1)
    expect(getSharedRealtimeStats()).toEqual([{ topic: 'users:id=eq.1', consumers: 2 }])

    fakeClient.channels[0].emit({ eventType: 'UPDATE', new: { id: '1' } })
    expect(events).toEqual([
      ['A', 'UPDATE', { eventType: 'UPDATE', new: { id: '1' } }],
      ['B', 'UPDATE', { eventType: 'UPDATE', new: { id: '1' } }],
    ])

    unsubA()
    unsubB()
  })

  test('unmounting one consumer does not tear down the channel while another remains', () => {
    const unsubA = subscribeRealtime('doctor_profiles:id=eq.1', [
      { event: 'UPDATE', schema: 'public', table: 'doctor_profiles', filter: 'id=eq.1' },
    ], () => {})
    subscribeRealtime('doctor_profiles:id=eq.1', [
      { event: 'UPDATE', schema: 'public', table: 'doctor_profiles', filter: 'id=eq.1' },
    ], () => {})

    unsubA()
    jest.runAllTimers()

    expect(fakeClient.removeChannelCalls).toBe(0)
    expect(getSharedRealtimeStats()).toEqual([{ topic: 'doctor_profiles:id=eq.1', consumers: 1 }])
  })

  test('the channel is removed only after the last consumer disconnects', () => {
    const unsubA = subscribeRealtime('notifications:user_id=eq.1', [
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.1' },
    ], () => {})
    const unsubB = subscribeRealtime('notifications:user_id=eq.1', [
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.1' },
    ], () => {})

    unsubA()
    unsubB()
    jest.runAllTimers()
    fakeClient.flushUnsubscribes()

    expect(fakeClient.removeChannelCalls).toBe(1)
    expect(getSharedRealtimeStats()).toEqual([])
  })

  test('a same-tick unmount+remount (StrictMode double-invoke) reuses the channel with no new subscription and no removeChannel call', () => {
    const unsub1 = subscribeRealtime('users:id=eq.2', [
      { event: 'UPDATE', schema: 'public', table: 'users', filter: 'id=eq.2' },
    ], () => {})
    unsub1()
    // Remount happens synchronously, before the 0ms removal timer fires.
    subscribeRealtime('users:id=eq.2', [
      { event: 'UPDATE', schema: 'public', table: 'users', filter: 'id=eq.2' },
    ], () => {})
    jest.runAllTimers()

    expect(fakeClient.channelCalls).toBe(1)
    expect(fakeClient.removeChannelCalls).toBe(0)
    expect(getSharedRealtimeStats()).toEqual([{ topic: 'users:id=eq.2', consumers: 1 }])
  })

  test('different topics get independent channels', () => {
    subscribeRealtime('users:id=eq.1', [
      { event: 'UPDATE', schema: 'public', table: 'users', filter: 'id=eq.1' },
    ], () => {})
    subscribeRealtime('users:id=eq.2', [
      { event: 'UPDATE', schema: 'public', table: 'users', filter: 'id=eq.2' },
    ], () => {})

    expect(fakeClient.channelCalls).toBe(2)
    expect(getSharedRealtimeStats().map((s) => s.topic).sort()).toEqual(['users:id=eq.1', 'users:id=eq.2'])
  })
})
