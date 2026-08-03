import { File as ExpoFile } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { Platform } from 'react-native'

// RN's <Modal> keeps its native window alive for its dismiss animation after
// `visible` flips to false — on Android that's the Dialog window's
// slide/fade-out, on iOS it's UIKit's own modal-dismiss transition
// (~300-400ms). Launching expo-image-picker while that dismiss is still in
// flight races the OS: Android silently drops/loses the picker's result,
// and iOS's `presentViewController` call is silently no-op'd (only a native
// console warning, never a JS error) because UIKit refuses to present while
// another presentation transaction is in progress. Waiting a beat after
// closing the modal avoids the race on both platforms.
export async function waitForModalDismiss(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 400))
}

// fetch() on a local file:// / content:// URI is unreliable in React Native
// — it can resolve with truncated or non-image bytes, which Supabase
// Storage's content-sniffing then silently rejects as a MIME mismatch
// (surfaces as a bare RLS violation, not a helpful error). Read via
// expo-file-system instead; fetch is only needed for web (blob:/http: URIs)
// and data: URIs, neither of which expo-file-system's File API supports.
async function getImageBytes(uri: string): Promise<Uint8Array> {
  if (Platform.OS === 'web' || uri.startsWith('data:')) {
    const resp = await fetch(uri)
    return new Uint8Array(await resp.arrayBuffer())
  }
  return new ExpoFile(uri).bytes()
}

export async function getImageBuffer(uri: string): Promise<ArrayBuffer> {
  const bytes = await getImageBytes(uri)
  return bytes.buffer as ArrayBuffer
}

// Declared MIME types (from ImagePicker's asset.mimeType, or a browser
// File.type) are not trustworthy on their own — some launchers report a
// generic/stale type, or none at all. The magic bytes on disk are the only
// thing that actually determines how Storage's content-sniffing will
// classify the upload, so they're the source of truth; `declaredMimeType` is
// only consulted when the bytes are inconclusive.
type SniffedMime = 'image/jpeg' | 'image/png' | 'image/heic'

function sniffImageMime(bytes: Uint8Array): SniffedMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  // ISO-BMFF container: bytes 4-7 are the literal ASCII "ftyp", followed by
  // a 4-char brand that identifies HEIC/HEIF specifically.
  if (bytes.length >= 12 && String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === 'ftyp') {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
    if (['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1'].includes(brand)) {
      return 'image/heic'
    }
  }
  return null
}

function normalizeDeclaredMime(mime?: string | null): SniffedMime | null {
  switch ((mime ?? '').toLowerCase()) {
    case 'image/jpg':
    case 'image/jpeg':
      return 'image/jpeg'
    case 'image/png':
      return 'image/png'
    case 'image/heic':
    case 'image/heif':
      return 'image/heic'
    default:
      return null
  }
}

export class UnsupportedImageFormatError extends Error {}

async function convertHeicToJpeg(uri: string): Promise<string> {
  try {
    const rendered = await ImageManipulator.manipulate(uri).renderAsync()
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 })
    return saved.uri
  } catch {
    throw new UnsupportedImageFormatError(
      "We couldn't convert this HEIC photo. Please choose a JPEG or PNG image instead."
    )
  }
}

export type PreparedImageUpload = {
  buffer: ArrayBuffer
  mimeType: 'image/jpeg' | 'image/png'
  ext: 'jpg' | 'png'
}

// Reads the picked asset's real bytes, determines its true image format
// (never trusting a hardcoded 'image/jpeg'), converts HEIC to JPEG, and
// rejects anything else with a user-friendly message — so the bytes handed
// to Storage and the contentType declared for them can never mismatch.
export async function prepareImageForUpload(
  uri: string,
  declaredMimeType?: string | null
): Promise<PreparedImageUpload> {
  let bytes = await getImageBytes(uri)
  let format = sniffImageMime(bytes) ?? normalizeDeclaredMime(declaredMimeType)

  console.log(
    `[IMAGE UPLOAD] uri=${uri} sniffedMime=${sniffImageMime(bytes) ?? 'unknown'} ` +
    `declaredMime=${declaredMimeType ?? 'n/a'} fileSize=${bytes.byteLength} ` +
    `first16Bytes=${Array.from(bytes.slice(0, 16)).map((b) => b.toString(16).padStart(2, '0')).join(' ')}`
  )

  if (format === 'image/heic') {
    const jpegUri = await convertHeicToJpeg(uri)
    bytes = await getImageBytes(jpegUri)
    format = sniffImageMime(bytes)
    if (format !== 'image/jpeg') {
      throw new UnsupportedImageFormatError(
        "We couldn't process this HEIC photo. Please choose a JPEG or PNG image instead."
      )
    }
  }

  if (format !== 'image/jpeg' && format !== 'image/png') {
    throw new UnsupportedImageFormatError(
      'Unsupported image format. Please choose a JPEG or PNG image.'
    )
  }

  return {
    buffer: bytes.buffer as ArrayBuffer,
    mimeType: format,
    ext: format === 'image/png' ? 'png' : 'jpg',
  }
}
