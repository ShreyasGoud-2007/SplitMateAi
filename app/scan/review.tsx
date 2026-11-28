import LoadingOverlay from '@/components/LoadingOverlay';
import { Colors } from '@/constants/Colors';
import { storeOCRResult, useBillStore } from '@/store/billStore';
import { extractBill, OCRError } from '@/utils/api';
import { normalizeImageUri } from '@/utils/normalizeImageUri';
import { createManualBill } from '@/utils/billAdapters';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
    ArrowLeft,
    CheckCircle2,
    Images,
    RotateCcw,
    Sparkles,
    ZoomIn,
} from 'lucide-react-native';
import { useState } from 'react';
import {
    Alert,
    Dimensions,
    Image,
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const IMAGE_HEIGHT = SCREEN_HEIGHT * 0.46;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * useLocalSearchParams can return string | string[] even with the generic
 * annotation.  Always coerce to a plain string so Image.source={{ uri }}
 * never receives an array.
 */
function coerceString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function ReviewScreen() {
  const router = useRouter();

  // Metadata still travels in route params, which may be returned as arrays.
  const params = useLocalSearchParams<{
    mimeType: string | string[];
    fileName: string | string[];
  }>();

  const mimeType = coerceString(params.mimeType) || 'image/jpeg';
  const fileName = coerceString(params.fileName) || 'bill.jpg';

  const {
    setBill,
    getSplitSession,
    setPendingImageUri,
    getPendingImageUri,
  } = useBillStore();
  const [uri, setUri] = useState(() => getPendingImageUri());
  const [loading, setLoading]           = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [imageErrorUri, setImageErrorUri] = useState<string | null>(null);
  const imageError = imageErrorUri === uri;

  // ── Guard: no URI ──────────────────────────────────────────────────────────
  if (!uri) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>No image selected.</Text>
          <TouchableOpacity
            style={styles.errorBtn}
            onPress={() => router.replace('/scan')}
          >
            <Text style={styles.errorBtnText}>Go Back to Scan</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Retake ─────────────────────────────────────────────────────────────────
  async function handleRetake() {
    try {
      setLoading(true);
      setLoadingMessage('Opening camera…');

      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== ImagePicker.PermissionStatus.GRANTED) {
        setLoading(false);
        Alert.alert(
          'Camera Permission Required',
          'Please allow camera access in Settings to retake a photo.',
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.92,
        allowsEditing: false,
      });

      if (!result.canceled && result.assets.length > 0) {
        const asset = result.assets[0];
        const selectedMimeType = asset.mimeType ?? 'image/jpeg';
        const imageUri = await normalizeImageUri(asset.uri, selectedMimeType);
        setPendingImageUri(imageUri);
        setUri(imageUri);
        setLoading(false);
        router.replace({
          pathname: '/scan/review',
          params: {
            mimeType: selectedMimeType,
            fileName: asset.fileName ?? 'bill.jpg',
          },
        });
      } else {
        setLoading(false);
      }
    } catch (err) {
      setLoading(false);
      Alert.alert(
        'Camera Error',
        err instanceof Error ? err.message : 'Failed to open the camera. Please try again.',
      );
    }
  }

  // ── Choose another ─────────────────────────────────────────────────────────
  async function handleChooseAnother() {
    try {
      setLoading(true);
      setLoadingMessage('Opening gallery…');

      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== ImagePicker.PermissionStatus.GRANTED) {
        setLoading(false);
        Alert.alert(
          'Gallery Permission Required',
          'Please allow photo library access in Settings.',
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.92,
        allowsEditing: false,
        selectionLimit: 1,
      });

      if (!result.canceled && result.assets.length > 0) {
        const asset = result.assets[0];
        const selectedMimeType = asset.mimeType ?? 'image/jpeg';
        const imageUri = await normalizeImageUri(asset.uri, selectedMimeType);
        setPendingImageUri(imageUri);
        setUri(imageUri);
        setLoading(false);
        router.replace({
          pathname: '/scan/review',
          params: {
            mimeType: selectedMimeType,
            fileName: asset.fileName ?? 'bill.jpg',
          },
        });
      } else {
        setLoading(false);
      }
    } catch (err) {
      setLoading(false);
      Alert.alert(
        'Gallery Error',
        err instanceof Error ? err.message : 'Failed to open the gallery. Please try again.',
      );
    }
  }

  // ── Extract ────────────────────────────────────────────────────────────────
  async function handleExtract() {
    if (loading) return; // prevent double-tap

    const imageUri = uri;
    if (!imageUri) {
      Alert.alert('Image unavailable', 'Choose or capture the bill image again.');
      return;
    }

    setLoading(true);
    setLoadingMessage('Uploading your bill…');

    try {
      const hintCurrency = getSplitSession()?.currency ?? 'INR';
      const result = await extractBill(imageUri, mimeType, fileName, hintCurrency);

      if (result.items.length === 0) {
        showOCRErrorActions(
          'No bill items found',
          'No purchasable items could be extracted from this image.',
        );
        return;
      }

      setLoadingMessage('Preparing your bill for review…');

      storeOCRResult(setBill, imageUri, result);

      setLoading(false);
      router.push('/scan/results');
    } catch (err) {
      setLoading(false);

      const error = err instanceof OCRError
        ? err
        : new OCRError(
            err instanceof Error ? err.message : 'Bill extraction is temporarily unavailable.',
            'UNKNOWN',
          );
      console.error('[Review] OCR FAILED — code:', error.code);
      console.error('[Review] OCR FAILED — message:', error.message);
      console.error('[Review] OCR FAILED — statusCode:', error.statusCode ?? 'n/a');
      if (err instanceof Error && err.stack) {
        console.error('[Review] OCR FAILED — stack:', err.stack);
      }

      showOCRErrorActions('Bill extraction failed', error.message);
    }
  }

  function showOCRErrorActions(title: string, message: string) {
    setLoading(false);
    Alert.alert(
      title,
      `${message}\n\nYou can retry OCR or enter the bill items yourself.`,
      [
        {
          text: 'Retry',
          onPress: () => { void handleExtract(); },
        },
        { text: 'Enter items manually', onPress: handleEnterItemsManually },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  function handleEnterItemsManually() {
    const imageUri = uri;
    if (!imageUri) {
      Alert.alert('Image unavailable', 'Choose or capture the bill image again.');
      return;
    }

    const bill = createManualBill({
      items: [],
      currency: getSplitSession()?.currency ?? 'INR',
      imageMetadata: { uri: imageUri },
    });
    setBill(bill);
    router.push('/scan/results');
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <LoadingOverlay visible={loading} message={loadingMessage} />

      {/* Dark image area */}
      <View style={styles.imageArea}>
        {/* Back button */}
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.8}
        >
          <ArrowLeft size={22} color={Colors.white} strokeWidth={2.2} />
        </TouchableOpacity>

        {/* Header label */}
        <View style={styles.headerLabel}>
          <Text style={styles.headerTitle}>Bill Preview</Text>
          <Text style={styles.headerSub}>Review your image before extracting</Text>
        </View>

        {/* Bill image */}
        {imageError ? (
          <View style={styles.imageFallback}>
            <ZoomIn size={40} color="rgba(255,255,255,0.4)" strokeWidth={1.5} />
            <Text style={styles.imageFallbackText}>Image unavailable</Text>
            <Text style={styles.imageFallbackHint}>
              Retake the photo or choose another image to continue.
            </Text>
          </View>
        ) : (
          <Image
            source={{ uri }}
            style={styles.billImage}
            resizeMode="contain"
            onError={() => {
              setImageErrorUri(uri);
            }}
          />
        )}

        {/* Quality indicator pill */}
        {!imageError && (
          <View style={styles.qualityPill}>
            <CheckCircle2 size={13} color="#4ade80" strokeWidth={2.5} />
            <Text style={styles.qualityText}>Image captured</Text>
          </View>
        )}
      </View>

      {/* Action panel */}
      <View style={styles.panel}>
        <View style={styles.panelHandle} />

        <Text style={styles.panelTitle}>Looks good?</Text>
        <Text style={styles.panelSub}>
          If the bill is clear and fully visible, tap Extract to continue.
        </Text>

        {/* Secondary actions */}
        <View style={styles.secondaryRow}>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={handleRetake}
            activeOpacity={0.75}
          >
            <View style={styles.secondaryIconWrap}>
              <RotateCcw size={20} color={Colors.primary} strokeWidth={2} />
            </View>
            <Text style={styles.secondaryBtnText}>Retake</Text>
          </TouchableOpacity>

          <View style={styles.secondaryDivider} />

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={handleChooseAnother}
            activeOpacity={0.75}
          >
            <View style={styles.secondaryIconWrap}>
              <Images size={20} color={Colors.primary} strokeWidth={2} />
            </View>
            <Text style={styles.secondaryBtnText}>Choose Another</Text>
          </TouchableOpacity>
        </View>

        {/* Primary extract button */}
        <TouchableOpacity
          style={[styles.extractBtn, imageError && styles.extractBtnDisabled]}
          onPress={handleExtract}
          activeOpacity={imageError ? 1 : 0.88}
          disabled={imageError}
        >
          <Sparkles size={20} color={Colors.white} strokeWidth={2} />
          <Text style={styles.extractBtnText}>Extract Bill Items</Text>
        </TouchableOpacity>

        <Text style={styles.extractNote}>
          AI will identify items, quantities and prices from your bill
        </Text>
      </View>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles — unchanged from original
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },

  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    backgroundColor: Colors.background,
  },
  errorText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  errorBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  errorBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.white,
  },

  imageArea: {
    height: IMAGE_HEIGHT,
    backgroundColor: '#111',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backBtn: {
    position: 'absolute',
    top: 16,
    left: 16,
    zIndex: 10,
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLabel: {
    position: 'absolute',
    top: 18,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 2,
    zIndex: 5,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.white,
    letterSpacing: 0.1,
  },
  headerSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
  },
  billImage: {
    width: SCREEN_WIDTH,
    height: IMAGE_HEIGHT,
  },
  imageFallback: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
  },
  imageFallbackText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    fontWeight: '600',
  },
  imageFallbackHint: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 10,
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  qualityPill: {
    position: 'absolute',
    bottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  qualityText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.white,
  },

  panel: {
    flex: 1,
    backgroundColor: Colors.white,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: Platform.OS === 'android' ? 24 : 32,
    gap: 14,
    ...Platform.select({
      android: { elevation: 20 },
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
      },
    }),
  },
  panelHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 6,
  },
  panelTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.3,
  },
  panelSub: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginTop: -4,
  },

  secondaryRow: {
    flexDirection: 'row',
    backgroundColor: Colors.background,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  secondaryIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  secondaryDivider: {
    width: 1,
    backgroundColor: Colors.border,
    marginVertical: 10,
  },

  extractBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    gap: 10,
    ...Platform.select({
      android: { elevation: 4 },
      ios: {
        shadowColor: Colors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
    }),
  },
  extractBtnDisabled: {
    opacity: 0.5,
  },
  extractBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.white,
    letterSpacing: 0.1,
  },
  extractNote: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 17,
    marginTop: -4,
  },
});
