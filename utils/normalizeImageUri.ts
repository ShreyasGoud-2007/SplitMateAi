/**
 * normalizeImageUri.ts
 *
 * On Android, expo-image-picker can return a `content://` URI (Android Content
 * Provider URI) instead of a `file://` URI.  React Native's <Image> component
 * in Expo Go cannot display `content://` URIs directly — it needs a `file://`
 * path.
 *
 * This helper copies picker URIs into the app's local cache using
 * expo-file-system, returning an app-owned `file://` path that both
 * <Image> and the multipart/form-data upload can use reliably.
 *
 * If the URI already starts with `file://` (or is a web `http` URL) it is
 * returned unchanged.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

/**
 * Copy an image URI from expo-image-picker into the app cache on Android.
 *
 * @param uri       The URI returned by ImagePickerAsset.uri
 * @param mimeType  MIME type (used to pick the right extension)
 * @returns         An app-owned `file://` URI pointing to a copy in the app cache
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

  // Avoid copying an image that this helper has already placed in the cache.
  if (uri.startsWith('file://') && uri.includes('/splitmate_')) {
    console.log('[normalizeUri] Already in the app image cache — returning unchanged');
    return uri;
  }

  // HTTP/HTTPS — not a local picker image, leave it alone.
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    console.log('[normalizeUri] Remote URI — returning unchanged');
    return uri;
  }

  // Copy picker URIs, including file:// paths owned by Expo's picker cache.
  console.log('[normalizeUri] Copying picker URI into app cache, scheme:', uri.split(':')[0]);
  console.log('[normalizeUri] Copying to local cache…');

  const ext = mimeType === 'image/png' ? '.png'
            : mimeType === 'image/webp' ? '.webp'
            : '.jpg';

  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) {
    throw new Error('Could not access the app image cache. Please select the bill image again.');
  }

  const destUri = `${cacheDir}splitmate_${Date.now()}${ext}`;

  try {
    await FileSystem.copyAsync({ from: uri, to: destUri });
    const copiedFile = await FileSystem.getInfoAsync(destUri);
    if (!copiedFile.exists || copiedFile.size === 0) {
      throw new Error('The copied image is missing or empty.');
    }

    console.log('[normalizeUri] Copied to:', destUri);
    return destUri;
  } catch (err) {
    console.error('[normalizeUri] Copy failed:', err instanceof Error ? err.message : String(err));
    throw new Error('Could not load the selected bill image. Please choose it again or take a new photo.');
  }
}
