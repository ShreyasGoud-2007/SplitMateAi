import { Colors } from '@/constants/Colors';
import { useBillStore } from '@/store/billStore';
import {
  BILL_CURRENCIES,
  type BillCurrency,
  type SplitParticipant,
  type SplitSession,
} from '@/types/splitSession';
import { createId } from '@/utils/ids';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ArrowLeft, Check, Plus, UsersRound, X } from 'lucide-react-native';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const INITIAL_PARTICIPANT: SplitParticipant = {
  id: 'current-user',
  name: 'You',
  isCurrentUser: true,
};

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words.slice(0, 2).map((word) => word[0].toUpperCase()).join('');
}

export default function NewSplitScreen() {
  const router = useRouter();
  const { getSplitSession, setSplitSession } = useBillStore();
  const existingSession = useLocalSearchParams<{ mode?: string }>().mode === 'edit'
    ? getSplitSession()
    : null;

  const [groupName, setGroupName] = useState(existingSession?.groupName ?? '');
  const [restaurantName, setRestaurantName] = useState(existingSession?.restaurantName ?? '');
  const [currency, setCurrency] = useState<BillCurrency>(existingSession?.currency ?? 'INR');
  const [participants, setParticipants] = useState<SplitParticipant[]>(
    existingSession?.participants ?? [INITIAL_PARTICIPANT],
  );
  const [newParticipantName, setNewParticipantName] = useState('');
  const [participantError, setParticipantError] = useState('');

  function updateParticipantName(id: string, name: string) {
    setParticipants((current) =>
      current.map((participant) =>
        participant.id === id ? { ...participant, name } : participant,
      ),
    );
    setParticipantError('');
  }

  function addParticipant() {
    const name = newParticipantName.trim();
    if (!name) {
      setParticipantError('Enter a participant name first.');
      return;
    }

    const duplicate = participants.some(
      (participant) => participant.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (duplicate) {
      setParticipantError('That participant is already in this group.');
      return;
    }

    setParticipants((current) => [
      ...current,
      {
        id: `participant-${Date.now()}-${current.length}`,
        name,
        isCurrentUser: false,
      },
    ]);
    setNewParticipantName('');
    setParticipantError('');
  }

  function removeParticipant(id: string) {
    setParticipants((current) => current.filter((participant) => participant.id !== id));
    setParticipantError('');
  }

  function continueToAssignment() {
    const trimmedGroupName = groupName.trim();
    if (!trimmedGroupName) {
      Alert.alert('Add a group name', 'Enter a name for this bill-splitting session.');
      return;
    }

    const cleanedParticipants = participants.map((participant) => ({
      ...participant,
      name: participant.name.trim(),
    }));

    if (cleanedParticipants.length === 0 || cleanedParticipants.some(({ name }) => !name)) {
      setParticipantError('Every participant needs a name.');
      Alert.alert('Check participants', 'Enter a name for each participant before continuing.');
      return;
    }

    const participantNames = cleanedParticipants.map(({ name }) => name.toLocaleLowerCase());
    if (new Set(participantNames).size !== participantNames.length) {
      setParticipantError('Participant names must be unique within this group.');
      Alert.alert('Duplicate participant', 'Each participant must have a unique name.');
      return;
    }

    const session: SplitSession = {
      id: existingSession?.id ?? createId(),
      groupName: trimmedGroupName,
      restaurantName: restaurantName.trim() || null,
      currency,
      participants: cleanedParticipants,
      createdAt: existingSession?.createdAt ?? new Date().toISOString(),
    };

    setSplitSession(session);
    router.push('/split/assignment');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.75}
          >
            <ArrowLeft size={21} color={Colors.textPrimary} strokeWidth={2} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.headerTitle}>Start a group split</Text>
            <Text style={styles.headerSubtitle}>Set up your bill and everyone sharing it</Text>
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.introCard}>
            <View style={styles.introIcon}>
              <UsersRound size={23} color={Colors.primary} strokeWidth={2} />
            </View>
            <View style={styles.introCopy}>
              <Text style={styles.introTitle}>One bill, shared together</Text>
              <Text style={styles.introSubtitle}>
                Add your group now. You can continue to item assignment next.
              </Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Group or bill name <Text style={styles.required}>*</Text></Text>
            <TextInput
              value={groupName}
              onChangeText={setGroupName}
              placeholder="e.g. Friday dinner"
              placeholderTextColor={Colors.textMuted}
              style={styles.input}
              returnKeyType="next"
              maxLength={60}
              accessibilityLabel="Group or bill name"
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Restaurant <Text style={styles.optional}>(optional)</Text></Text>
            <TextInput
              value={restaurantName}
              onChangeText={setRestaurantName}
              placeholder="Where did you eat?"
              placeholderTextColor={Colors.textMuted}
              style={styles.input}
              returnKeyType="next"
              maxLength={80}
              accessibilityLabel="Restaurant name"
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Bill currency</Text>
            <View style={styles.currencyList}>
              {BILL_CURRENCIES.map((option) => {
                const selected = currency === option.code;
                return (
                  <TouchableOpacity
                    key={option.code}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => setCurrency(option.code)}
                    activeOpacity={0.75}
                    style={[styles.currencyOption, selected && styles.currencyOptionSelected]}
                  >
                    <Text style={[styles.currencySymbol, selected && styles.currencySelectedText]}>
                      {option.symbol}
                    </Text>
                    <Text style={[styles.currencyCode, selected && styles.currencySelectedText]}>
                      {option.code}
                    </Text>
                    {selected && <Check size={14} color={Colors.primary} strokeWidth={2.5} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.participantHeading}>
              <View>
                <Text style={styles.label}>Participants</Text>
                <Text style={styles.helperText}>Rename yourself or add everyone sharing this bill.</Text>
              </View>
              <View style={styles.countBadge}>
                <Text style={styles.countText}>{participants.length}</Text>
              </View>
            </View>

            <View style={styles.participantCard}>
              {participants.length === 0 ? (
                <View style={styles.emptyParticipants}>
                  <UsersRound size={22} color={Colors.textMuted} strokeWidth={1.8} />
                  <Text style={styles.emptyTitle}>No participants yet</Text>
                  <Text style={styles.emptyText}>Add yourself and anyone splitting this bill.</Text>
                </View>
              ) : (
                participants.map((participant, index) => (
                  <View
                    key={participant.id}
                    style={[
                      styles.participantRow,
                      index < participants.length - 1 && styles.participantDivider,
                    ]}
                  >
                    <View style={styles.participantAvatar}>
                      <Text style={styles.participantInitials}>{getInitials(participant.name)}</Text>
                    </View>
                    <View style={styles.participantDetails}>
                      {participant.isCurrentUser ? (
                        <TextInput
                          value={participant.name}
                          onChangeText={(name) => updateParticipantName(participant.id, name)}
                          placeholder="Your name"
                          placeholderTextColor={Colors.textMuted}
                          style={styles.participantInput}
                          maxLength={40}
                          accessibilityLabel="Your participant name"
                        />
                      ) : (
                        <Text style={styles.participantName} numberOfLines={1}>
                          {participant.name}
                        </Text>
                      )}
                      <Text style={styles.participantRole}>
                        {participant.isCurrentUser ? 'You · included by default' : 'Participant'}
                      </Text>
                    </View>
                    {participant.isCurrentUser ? (
                      <View style={styles.youBadge}>
                        <Text style={styles.youBadgeText}>YOU</Text>
                      </View>
                    ) : (
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${participant.name}`}
                        style={styles.removeButton}
                        onPress={() => removeParticipant(participant.id)}
                        activeOpacity={0.7}
                      >
                        <X size={17} color={Colors.textSecondary} strokeWidth={2} />
                      </TouchableOpacity>
                    )}
                  </View>
                ))
              )}
            </View>

            <View style={styles.addParticipantRow}>
              <TextInput
                value={newParticipantName}
                onChangeText={(name) => {
                  setNewParticipantName(name);
                  setParticipantError('');
                }}
                onSubmitEditing={addParticipant}
                placeholder="Add a participant by name"
                placeholderTextColor={Colors.textMuted}
                style={styles.addParticipantInput}
                returnKeyType="done"
                maxLength={40}
                accessibilityLabel="New participant name"
              />
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Add participant"
                style={styles.addButton}
                onPress={addParticipant}
                activeOpacity={0.8}
              >
                <Plus size={19} color={Colors.white} strokeWidth={2.5} />
                <Text style={styles.addButtonText}>Add</Text>
              </TouchableOpacity>
            </View>
            {participantError ? <Text style={styles.errorText}>{participantError}</Text> : null}
          </View>

          <TouchableOpacity
            accessibilityRole="button"
            style={styles.continueButton}
            onPress={continueToAssignment}
            activeOpacity={0.85}
          >
            <Text style={styles.continueText}>Continue</Text>
            <ArrowLeft
              size={19}
              color={Colors.white}
              strokeWidth={2.2}
              style={styles.continueArrow}
            />
          </TouchableOpacity>
          <Text style={styles.footerNote}>You can review this group before assigning items.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  keyboard: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  headerCopy: { flex: 1, gap: 3 },
  headerTitle: { fontSize: 21, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -0.4 },
  headerSubtitle: { fontSize: 13, lineHeight: 18, color: Colors.textSecondary },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 32 },
  introCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    padding: 16,
    marginBottom: 22,
    borderRadius: 18,
    backgroundColor: Colors.primaryLight,
  },
  introIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  introCopy: { flex: 1, gap: 4 },
  introTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  introSubtitle: { fontSize: 12, lineHeight: 17, color: Colors.textSecondary },
  section: { marginBottom: 22 },
  label: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, marginBottom: 9 },
  required: { color: Colors.primary },
  optional: { color: Colors.textMuted, fontWeight: '400' },
  input: {
    height: 52,
    borderRadius: 13,
    paddingHorizontal: 15,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.textPrimary,
    fontSize: 15,
  },
  currencyList: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  currencyOption: {
    minWidth: 76,
    height: 43,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 11,
    borderRadius: 13,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  currencyOptionSelected: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  currencySymbol: { fontSize: 15, fontWeight: '700', color: Colors.textSecondary },
  currencyCode: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary },
  currencySelectedText: { color: Colors.primary },
  participantHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  helperText: { fontSize: 12, lineHeight: 17, color: Colors.textSecondary, marginTop: -4 },
  countBadge: {
    minWidth: 30,
    height: 30,
    paddingHorizontal: 8,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primaryLight,
  },
  countText: { color: Colors.primary, fontSize: 13, fontWeight: '800' },
  participantCard: {
    overflow: 'hidden',
    borderRadius: 16,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  participantRow: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  participantDivider: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  participantAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primaryLight,
  },
  participantInitials: { fontSize: 14, fontWeight: '800', color: Colors.primary },
  participantDetails: { flex: 1, gap: 2 },
  participantName: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  participantInput: {
    height: 27,
    padding: 0,
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  participantRole: { fontSize: 11, color: Colors.textSecondary },
  youBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: Colors.primaryLight,
  },
  youBadgeText: { fontSize: 9, fontWeight: '800', color: Colors.primary, letterSpacing: 0.4 },
  removeButton: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  emptyParticipants: { alignItems: 'center', paddingHorizontal: 20, paddingVertical: 22, gap: 6 },
  emptyTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  emptyText: { color: Colors.textSecondary, fontSize: 12, textAlign: 'center', lineHeight: 17 },
  addParticipantRow: { flexDirection: 'row', gap: 9, marginTop: 10 },
  addParticipantInput: {
    flex: 1,
    height: 48,
    borderRadius: 13,
    paddingHorizontal: 13,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.textPrimary,
    fontSize: 14,
  },
  addButton: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 15,
    borderRadius: 13,
    backgroundColor: Colors.primary,
  },
  addButtonText: { color: Colors.white, fontSize: 14, fontWeight: '700' },
  errorText: { color: '#b91c1c', fontSize: 12, marginTop: 7 },
  continueButton: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 2,
    borderRadius: 16,
    backgroundColor: Colors.primary,
  },
  continueText: { color: Colors.white, fontSize: 16, fontWeight: '800' },
  continueArrow: { transform: [{ rotate: '180deg' }] },
  footerNote: { color: Colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 11 },
});
