// lib/deviceId.ts
//
// A stable per-install identifier used to key this device's row in
// user_devices (migration 109, Phase-5 audit H4 — multi-device push token
// support). Generated once and persisted in AsyncStorage so it survives
// app restarts but is naturally reset by a fresh install/reinstall — that's
// intentional, a reinstall is a new "device" row from the server's point of
// view, and the stale one gets pruned like any other inactive registration.

import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Crypto from 'expo-crypto'

const DEVICE_ID_KEY = '@device_id_v1'

let cachedDeviceId: string | null = null

export async function getOrCreateDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId

  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY)
  if (existing) {
    cachedDeviceId = existing
    return existing
  }

  const fresh = Crypto.randomUUID()
  await AsyncStorage.setItem(DEVICE_ID_KEY, fresh)
  cachedDeviceId = fresh
  return fresh
}
