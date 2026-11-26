/**
 * normalizeImageUri.ts
 *
 * On Android, expo-image-picker can return a `content://` URI (Android Content
 * Provider URI) instead of a `file://` URI.  React Native's <Image> component
 * in Expo Go cannot display `content://` URIs directly — it needs a `file://`
 * path.
 *
 * This helper copies any non-file URI into the app's local cache using
 * expo-file-system, returning a guaranteed `file://` path that both
 * <Image> and the multipart/form-data upload can use reliably.
 *
 * If the URI already starts with `file://` (or is a web `http` URL) it is
 * returned unchanged.
 */

import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

/**
 * Normalise an image URI from expo-image-picker so it is always a `file://`
 * local path on Android.
 *
 * @param uri       The URI returned by ImagePickerAsset.uri
 * @param mimeType  MIME type (used to pick the right extension)
 * @returns         A `file://` URI pointing to a copy in the app cache
 */
export async function normalizeImageUri(
  uri: string,
  mimeType: string,
): Promise<string> {
  // On iOS and web content:// URIs are not an issue — return as-is
  if (Platform.OS !== 'android') {
    console.log('[normalizeUri] Non-Android platform — returning URI unchanged');
    return uri;
  }

  // Already a file:// URI — no copy needed
  if (uri.startsWith('file://')) {
    console.log('[normalizeUri] Already file:// — returning unchanged');
    return uri;
  }

  // HTTP/HTTPS — not a local file, leave it alone
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    console.log('[normalizeUri] Remote URI — returning unchanged');
    return uri;
  }

  // content:// or any other scheme — copy to cache
  console.log('[normalizeUri] Non-file URI detected, scheme:', uri.split(':')[0]);
  console.log('[normalizeUri] Copying to local cache…');

  const ext = mimeType === 'image/png' ? '.png'
            : mimeType === 'image/webp' ? '.webp'
            : '.jpg';

  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) {
    console.error('[normalizeUri] cacheDirectory is null — returning original URI');
    return uri;
  }

  const destUri = `${cacheDir}splitmate_${Date.now()}${ext}`;

  try {
    await FileSystem.copyAsync({ from: uri, to: destUri });
    console.log('[normalizeUri] Copied to:', destUri);
    return destUri;
  } catch (err) {
    console.error('[normalizeUri] Copy failed:', err instanceof Error ? err.message : String(err));
    // Return the original — the Image component may still work if
    // the content:// URI is accessible to the React Native bridge
    return uri;
  }
}
