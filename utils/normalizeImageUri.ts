/**
 * Copy Android picker images into app-owned document storage so the preview
 * remains available after the system clears temporary cache files.
 */

import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

const BILL_IMAGE_DIRECTORY = 'splitmate-bill-images';

/**
 * Copy an image URI from expo-image-picker into app-owned storage on Android.
 *
 * @param uri       The URI returned by ImagePickerAsset.uri
 * @param mimeType  MIME type (used to pick the right extension)
 * @returns         A `file://` URI pointing to the durable app-owned copy
 */
export async function normalizeImageUri(
  uri: string,
  mimeType: string,
): Promise<string> {
  if (!uri.trim()) {
    throw new Error('No bill image was selected. Please choose an image or take a photo.');
  }

  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    return uri;
  }

  if (Platform.OS !== 'android') {
    return uri;
  }

  const imageDirectory = new Directory(Paths.document, BILL_IMAGE_DIRECTORY);
  const imageDirectoryUri = `${imageDirectory.uri.replace(/\/+$/, '')}/`;

  if (uri.startsWith(imageDirectoryUri)) {
    const existingImage = new File(uri);
    if (!existingImage.exists || existingImage.size <= 0) {
      throw new Error('The selected bill image is no longer available. Please choose it again or take a new photo.');
    }
    return uri;
  }

  const extension = mimeType === 'image/png' ? '.png'
                  : mimeType === 'image/webp' ? '.webp'
                  : '.jpg';
  const sourceImage = new File(uri);
  const fileName = `splitmate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${extension}`;
  const destinationImage = new File(imageDirectory, fileName);

  if (!sourceImage.exists || sourceImage.size <= 0) {
    throw new Error('The selected image is missing or empty.');
  }

  imageDirectory.create({ idempotent: true, intermediates: true });
  try {
    await sourceImage.copy(destinationImage);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Could not copy the selected bill image: ${error.message}`
        : 'Could not copy the selected bill image.',
    );
  }

  if (!destinationImage.exists || destinationImage.size <= 0) {
    throw new Error('The copied image is missing or empty.');
  }

  return destinationImage.uri;
}
