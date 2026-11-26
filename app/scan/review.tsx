import LoadingOverlay from '@/components/LoadingOverlay';
import { Colors } from '@/constants/Colors';
import { storeOCRResult, useBillStore } from '@/store/billStore';
import { extractBill, OCRError } from '@/utils/api';
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

  // Expo Router URL-encodes params; useLocalSearchParams decodes them, but can
  // return string[] when a key appears multiple times.  Coerce to string.
  const params = useLocalSearchParams<{
    uri: string | string[];
    mimeType: string | string[];
    fileName: string | string[];
  }>();

  const uri      = coerceString(params.uri);
  const mimeType = coerceString(params.mimeType) || 'image/jpeg';
  const fileName = coerceString(params.fileName) || 'bill.jpg';

  const { setBill } = useBillStore();
  const [loading, setLoading]           = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [imageError, setImageError]     = useState(false);

  // ── Diagnostic logs — fires only on initial render (state flag trick) ──
  const [_loggedMount, _setLoggedMount] = useState(false);
  if (!_loggedMount) {
    _setLoggedMount(true);
    console.log('[Review] ──── ReviewScreen mounted ────');
    console.log('[Review] params.uri type:', typeof params.uri, '| isArray:', Array.isArray(params.uri));
    console.log('[Review] params.uri raw (first 80):', String(params.uri).slice(0, 80));
    console.log('[Review] Coerced uri (first 80):', uri.slice(0, 80));
    console.log('[Review] uri empty?', !uri);
    console.log('[Review] mimeType:', mimeType, '| fileName:', fileName);
  }

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

      setLoading(false);

      if (!result.canceled && result.assets.length > 0) {
        const asset = result.assets[0];
        router.replace({
          pathname: '/scan/review',
          params: {
            uri:      asset.uri,
            mimeType: asset.mimeType ?? 'image/jpeg',
            fileName: asset.fileName ?? 'bill.jpg',
          },
        });
      }
    } catch {
      setLoading(false);
      Alert.alert('Error', 'Failed to open the camera. Please try again.');
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

      setLoading(false);

      if (!result.canceled && result.assets.length > 0) {
        const asset = result.assets[0];
        router.replace({
          pathname: '/scan/review',
          params: {
            uri:      asset.uri,
            mimeType: asset.mimeType ?? 'image/jpeg',
            fileName: asset.fileName ?? 'bill.jpg',
          },
        });
      }
    } catch {
      setLoading(false);
      Alert.alert('Error', 'Failed to open the gallery. Please try again.');
    }
  }

  // ── Extract ────────────────────────────────────────────────────────────────
  async function handleExtract() {
    if (loading) return; // prevent double-tap

    setLoading(true);
    setLoadingMessage('Uploading your bill…');

    try {
      const uploadStart = Date.now();
      console.log('[Review] ──── Extract Bill Items pressed ────');
      console.log('[Review] URI (first 80):', uri.slice(0, 80));
      console.log('[Review] mimeType:', mimeType, '| fileName:', fileName);
      console.log('[Review] API base URL:', process.env.EXPO_PUBLIC_API_BASE_URL ?? '(env var missing — will fall back to localhost)');

      const result = await extractBill(uri, mimeType, fileName);

      const elapsed = Date.now() - uploadStart;
      console.log('[Review] OCR succeeded — elapsed:', elapsed, 'ms');
      console.log('[Review] Items received:', result.items.length);
      console.log('[Review] overall_confidence:', result.overall_confidence);
      console.log('[Review] restaurant_name:', result.restaurant_name ?? '(not detected)');
      console.log('[Review] has_mismatch:', result.has_mismatch);
      console.log('[Review] gemini_warnings:', result.gemini_warnings);
      setLoadingMessage('Analysing your bill with AI…');

      storeOCRResult(setBill, uri, result);

      setLoading(false);
      router.push({ pathname: '/scan/results', params: { uri } });
    } catch (err) {
      setLoading(false);

      const error = err as OCRError;
      console.error('[Review] OCR FAILED — code:', error.code);
      console.error('[Review] OCR FAILED — message:', error.message);
      console.error('[Review] OCR FAILED — statusCode:', (error as any).statusCode ?? 'n/a');
      if (err instanceof Error && err.stack) {
        console.error('[Review] OCR FAILED — stack:', err.stack);
      }

      switch (error.code) {
        case 'NETWORK_ERROR':
          Alert.alert(
            'Connection Error',
            'Cannot reach the SplitMate AI server.\n\nMake sure:\n• The backend is running\n• Your phone is on the same Wi-Fi as your computer\n• The IP in .env matches your computer\'s LAN address',
          );
          break;

        case 'TIMEOUT':
          Alert.alert(
            'Request Timed Out',
            'The server took too long to respond. Gemini AI may be busy — please try again in a moment.',
          );
          break;

        case 'GEMINI_UNAVAILABLE':
          Alert.alert(
            'AI Service Busy',
            'Gemini Vision is temporarily overloaded. Please wait a few seconds and try again.',
          );
          break;

        case 'INVALID_IMAGE':
          Alert.alert(
            'Invalid Image',
            error.message || 'The image format is not supported. Please use a JPEG, PNG, or WebP photo.',
          );
          break;

        case 'UNREADABLE':
          Alert.alert(
            'Could Not Read Bill',
            error.message || 'The image is too blurry or dark. Try retaking the photo with better lighting.',
          );
          break;

        case 'NOT_FOUND':
          Alert.alert(
            'Server Error',
            'The OCR endpoint was not found. Check that the backend is running and up to date.',
          );
          break;

        case 'BAD_RESPONSE':
          Alert.alert(
            'Unexpected Response',
            error.message || 'The server returned an unexpected response. Please try again.',
          );
          break;

        default:
          Alert.alert(
            'Extraction Failed',
            error.message || 'An unexpected error occurred. Please try again.',
          );
      }
    }
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
            <Text style={styles.imageFallbackText}>Unable to load image</Text>
            <Text style={styles.imageFallbackHint}>
              URI: {uri.slice(0, 50)}{uri.length > 50 ? '…' : ''}
            </Text>
          </View>
        ) : (
          <Image
            source={{ uri }}
            style={styles.billImage}
            resizeMode="contain"
            onLoadStart={() => {
              console.log('[Review] Image.onLoadStart uri (first 80):', uri.slice(0, 80));
            }}
            onLoad={(e) => {
              const { width, height } = e.nativeEvent.source;
              console.log('[Review] Image.onLoad OK — rendered size:', width, 'x', height);
            }}
            onError={(e) => {
              const nativeError = e.nativeEvent.error ?? '(no native error message)';
              console.error('[Review] Image.onError — nativeError:', nativeError);
              console.error('[Review] Image.onError — uri type:', typeof uri, '| isArray:', Array.isArray(uri));
              console.error('[Review] Image.onError — uri (first 80):', String(uri).slice(0, 80));
              setImageError(true);
            }}
          />
        )}

        {/* Quality indicator pill */}
        <View style={styles.qualityPill}>
          <CheckCircle2 size={13} color="#4ade80" strokeWidth={2.5} />
          <Text style={styles.qualityText}>Image captured</Text>
        </View>
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
          style={styles.extractBtn}
          onPress={handleExtract}
          activeOpacity={0.88}
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
