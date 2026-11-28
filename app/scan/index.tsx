import LoadingOverlay from '@/components/LoadingOverlay';
import { normalizeImageUri } from '@/utils/normalizeImageUri';
import { useBillStore } from '@/store/billStore';
import PermissionDenied from '@/components/PermissionDenied';
import { Colors } from '@/constants/Colors';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
    ArrowLeft,
    Camera,
    Images,
    Info,
    Scan,
} from 'lucide-react-native';
import { useState } from 'react';
import {
    Alert,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type PermissionError = 'camera' | 'gallery' | null;

export default function ScanScreen() {
  const router = useRouter();
  const { setPendingImageUri } = useBillStore();
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [permissionError, setPermissionError] = useState<PermissionError>(null);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function navigateToReview(
    uri: string,
    mimeType: string,
    fileName: string,
  ) {
    setPendingImageUri(uri);
    router.push({
      pathname: '/scan/review',
      params: { mimeType, fileName },
    });
  }

  // ── Camera ─────────────────────────────────────────────────────────────────

  async function handleTakePhoto() {
    try {
      setLoading(true);
      setLoadingMessage('Requesting camera access…');

      const { status } = await ImagePicker.requestCameraPermissionsAsync();

      if (status !== ImagePicker.PermissionStatus.GRANTED) {
        setLoading(false);
        setPermissionError('camera');
        return;
      }

      setLoadingMessage('Opening camera…');

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.92,
        allowsEditing: false,
      });

      if (!result.canceled && result.assets.length > 0) {
        const asset = result.assets[0];
        const mime = asset.mimeType ?? 'image/jpeg';
        const name = asset.fileName ?? 'bill.jpg';
        // Copy picker cache images into app-owned storage before navigation.
        const fileUri = await normalizeImageUri(asset.uri, mime);
        setLoading(false);
        navigateToReview(fileUri, mime, name);
      } else {
        setLoading(false);
      }
    } catch (err) {
      setLoading(false);
      console.error('[Scan] Camera handler error:', err instanceof Error ? err.message : String(err));
      Alert.alert(
        'Camera Error',
        err instanceof Error ? err.message : 'Something went wrong while opening the camera. Please try again.',
      );
    }
  }

  // ── Gallery ────────────────────────────────────────────────────────────────

  async function handleChooseFromGallery() {
    try {
      setLoading(true);
      setLoadingMessage('Requesting gallery access…');

      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (status !== ImagePicker.PermissionStatus.GRANTED) {
        setLoading(false);
        setPermissionError('gallery');
        return;
      }

      setLoadingMessage('Opening gallery…');

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.92,
        allowsEditing: false,
        selectionLimit: 1,
      });

      if (!result.canceled && result.assets.length > 0) {
        const asset = result.assets[0];
        const mime = asset.mimeType ?? 'image/jpeg';
        const name = asset.fileName ?? 'bill.jpg';
        // Copy picker cache images into app-owned storage before navigation.
        const fileUri = await normalizeImageUri(asset.uri, mime);
        setLoading(false);
        navigateToReview(fileUri, mime, name);
      } else {
        setLoading(false);
      }
    } catch (err) {
      setLoading(false);
      console.error('[Scan] Gallery handler error:', err instanceof Error ? err.message : String(err));
      Alert.alert(
        'Gallery Error',
        err instanceof Error ? err.message : 'Something went wrong while opening the gallery. Please try again.',
      );
    }
  }

  // ── Permission error state ─────────────────────────────────────────────────

  if (permissionError) {
    const isCamera = permissionError === 'camera';
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        <TouchableOpacity
          style={styles.backBtnAbsolute}
          onPress={() => setPermissionError(null)}
          activeOpacity={0.7}
        >
          <ArrowLeft size={22} color={Colors.textPrimary} strokeWidth={2} />
        </TouchableOpacity>
        <PermissionDenied
          title={isCamera ? 'Camera Access Needed' : 'Gallery Access Needed'}
          message={
            isCamera
              ? 'SplitMate AI needs camera permission to scan your bill. Enable it in device Settings.'
              : 'SplitMate AI needs photo library permission to pick your bill image. Enable it in device Settings.'
          }
          onDismiss={() => setPermissionError(null)}
        />
      </SafeAreaView>
    );
  }

  // ── Main UI ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />
      <LoadingOverlay visible={loading} message={loadingMessage} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <ArrowLeft size={22} color={Colors.textPrimary} strokeWidth={2} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.heading}>Scan your bill</Text>
          <Text style={styles.subheading}>
            Upload a handwritten or printed restaurant bill
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Tip banner */}
        <View style={styles.tipBanner}>
          <Info size={15} color={Colors.primary} strokeWidth={2} />
          <Text style={styles.tipText}>
            For best results, ensure the bill is flat, well-lit, and fully visible.
          </Text>
        </View>

        {/* Camera card */}
        <View style={styles.optionCard}>
          {/* Decorative circles */}
          <View style={styles.decorCircle1} />
          <View style={styles.decorCircle2} />

          <View style={styles.optionIconWrap}>
            <Camera size={42} color={Colors.primary} strokeWidth={1.5} />
            <View style={styles.scanBadge}>
              <Scan size={16} color={Colors.white} strokeWidth={2.2} />
            </View>
          </View>

          <View style={styles.optionTextWrap}>
            <Text style={styles.optionTitle}>Take a Photo</Text>
            <Text style={styles.optionDesc}>
              Use your camera to capture the bill in real time
            </Text>
          </View>

          <View style={styles.featureRow}>
            {['Auto-focus', 'High resolution', 'Instant capture'].map((f) => (
              <View key={f} style={styles.featureChip}>
                <Text style={styles.featureChipText}>{f}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleTakePhoto}
            activeOpacity={0.85}
          >
            <Camera size={19} color={Colors.white} strokeWidth={2} />
            <Text style={styles.primaryBtnText}>Take a Photo</Text>
          </TouchableOpacity>
        </View>

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerLabel}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Gallery card */}
        <View style={[styles.optionCard, styles.galleryCard]}>
          <View style={[styles.optionIconWrap, styles.galleryIconWrap]}>
            <Images size={42} color={Colors.white} strokeWidth={1.5} />
          </View>

          <View style={styles.optionTextWrap}>
            <Text style={[styles.optionTitle, styles.galleryTitle]}>
              Choose from Gallery
            </Text>
            <Text style={[styles.optionDesc, styles.galleryDesc]}>
              Pick an existing photo of a bill from your device
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.primaryBtn, styles.galleryBtn]}
            onPress={handleChooseFromGallery}
            activeOpacity={0.85}
          >
            <Images size={19} color={Colors.primary} strokeWidth={2} />
            <Text style={[styles.primaryBtnText, styles.galleryBtnText]}>
              Choose from Gallery
            </Text>
          </TouchableOpacity>
        </View>

        {/* Bottom note */}
        <Text style={styles.footNote}>
          Your images are processed securely and never stored without your consent.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    backgroundColor: Colors.background,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  backBtnAbsolute: {
    position: 'absolute',
    top: 56,
    left: 20,
    zIndex: 10,
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  heading: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.4,
  },
  subheading: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
  },

  /* Scroll */
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 40,
    gap: 16,
  },

  /* Tip banner */
  tipBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.primaryLight,
    borderRadius: 12,
    padding: 14,
  },
  tipText: {
    flex: 1,
    fontSize: 13,
    color: Colors.primary,
    lineHeight: 19,
    fontWeight: '500',
  },

  /* Option cards */
  optionCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 20,
    padding: 24,
    gap: 16,
    borderWidth: 1.5,
    borderColor: Colors.border,
    overflow: 'hidden',
    ...Platform.select({
      android: { elevation: 3 },
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.07,
        shadowRadius: 8,
      },
    }),
  },
  decorCircle1: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: Colors.primaryLight,
    top: -50,
    right: -40,
  },
  decorCircle2: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primaryLight,
    bottom: -20,
    left: 10,
    opacity: 0.6,
  },
  optionIconWrap: {
    width: 76,
    height: 76,
    borderRadius: 20,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionTextWrap: {
    gap: 5,
  },
  optionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.3,
  },
  optionDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  featureRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  featureChip: {
    backgroundColor: Colors.primaryLight,
    borderRadius: 20,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  featureChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.primary,
  },

  /* Gallery card overrides */
  galleryCard: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  galleryIconWrap: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  galleryTitle: {
    color: Colors.white,
  },
  galleryDesc: {
    color: 'rgba(255,255,255,0.75)',
  },

  /* Buttons */
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 13,
    paddingVertical: 14,
    gap: 9,
    marginTop: 4,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.white,
    letterSpacing: 0.1,
  },
  galleryBtn: {
    backgroundColor: Colors.white,
  },
  galleryBtnText: {
    color: Colors.primary,
  },

  /* Divider */
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.border,
  },
  dividerLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
  },

  /* Footnote */
  footNote: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 8,
    paddingHorizontal: 8,
  },
});
