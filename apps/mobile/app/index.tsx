import type { MediaAsset, Trigger } from "@lictory/contracts";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { api } from "../src/api";
import { authClient } from "../src/auth-client";
import { AuthScreen } from "../src/auth-screen";
import { startGeofencingFor } from "../src/geofencing";
import { registerForPushNotifications } from "../src/notifications";

type PickedFile = {
  uri: string;
  name: string;
  contentType: string;
  bytes: number;
};

export default function HomeScreen() {
  const { data: session, isPending, refetch } = authClient.useSession();

  if (isPending) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <ActivityIndicator color="#21443b" />
      </SafeAreaView>
    );
  }

  if (!session) {
    return <AuthScreen refreshSession={refetch} />;
  }

  return (
    <AuthenticatedHome email={session.user.email} name={session.user.name} />
  );
}

function AuthenticatedHome({ name, email }: { name: string; email: string }) {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Ready for your first moment.");

  async function refresh() {
    const [mediaResponse, triggerResponse] = await Promise.all([
      api.listMedia(),
      api.listTriggers(),
    ]);
    setAssets(mediaResponse.assets);
    setTriggers(triggerResponse.triggers);
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listMedia(), api.listTriggers()])
      .then(([mediaResponse, triggerResponse]) => {
        if (cancelled) return;
        setAssets(mediaResponse.assets);
        setTriggers(triggerResponse.triggers);
      })
      .catch(() => {
        if (!cancelled) {
          setMessage("Start the API at the configured EXPO_PUBLIC_API_URL.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function upload(file: PickedFile) {
    setBusy(true);
    setMessage(`Uploading ${file.name}…`);
    try {
      const response = await fetch(file.uri);
      const body = await response.blob();
      const { asset } = await api.uploadBinary({
        fileName: file.name,
        contentType: file.contentType,
        bytes: file.bytes || body.size,
        body,
      });
      setMessage(`${asset.fileName} is queued for AI processing.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
    });
    const selected = result.assets?.[0];
    if (!result.canceled && selected) {
      await upload({
        uri: selected.uri,
        name: selected.fileName ?? `photo-${Date.now()}.jpg`,
        contentType: selected.mimeType ?? "image/jpeg",
        bytes: selected.fileSize ?? 1,
      });
    }
  }

  async function pickAudio() {
    const result = await DocumentPicker.getDocumentAsync({
      type: "audio/*",
      copyToCacheDirectory: true,
    });
    const selected = result.assets?.[0];
    if (!result.canceled && selected) {
      await upload({
        uri: selected.uri,
        name: selected.name,
        contentType: selected.mimeType ?? "audio/mpeg",
        bytes: selected.size ?? 1,
      });
    }
  }

  async function addPlaceTrigger() {
    setBusy(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        throw new Error("Location permission was not granted.");
      }
      const current = await Location.getCurrentPositionAsync({});
      const { trigger } = await api.createTrigger({
        type: "location",
        title: "A memory is nearby",
        body: "You asked Lictory to bring this moment back here.",
        label: "Current place",
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
        radiusMeters: 150,
        event: "enter",
      });
      const nextTriggers = [trigger, ...triggers];
      setTriggers(nextTriggers);
      const monitored = await startGeofencingFor(nextTriggers);
      setMessage(
        `Monitoring ${monitored} place trigger${monitored === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not add trigger.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function enablePush() {
    setBusy(true);
    try {
      await registerForPushNotifications();
      setMessage("This device is ready for Lictory notifications.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Registration failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function addPasskey() {
    setBusy(true);
    try {
      const result = await authClient.passkey.addPasskey({
        name: "This device",
        authenticatorAttachment: "platform",
      });
      if (result.error) throw new Error(result.error.message);
      setMessage("Passkey added to your account.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not add a passkey.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}>
            <Text style={styles.brandLetter}>L</Text>
          </View>
          <Text style={styles.brand}>Lictory</Text>
        </View>

        <View style={styles.accountRow}>
          <View style={styles.accountIdentity}>
            <Text style={styles.accountName}>{name}</Text>
            <Text style={styles.accountEmail} numberOfLines={1}>
              {email}
            </Text>
          </View>
          <Pressable disabled={busy} onPress={() => void addPasskey()}>
            <Text style={styles.accountAction}>Add passkey</Text>
          </Pressable>
          <Pressable disabled={busy} onPress={() => void authClient.signOut()}>
            <Text style={styles.accountAction}>Sign out</Text>
          </Pressable>
        </View>

        <Text style={styles.eyebrow}>YOUR MOMENTS, IN CONTEXT</Text>
        <Text style={styles.title}>Give a memory a way back.</Text>
        <Text style={styles.intro}>
          Add a photo or a voice note. Lictory will understand it in the
          background and return it at the right time or place.
        </Text>

        <View style={styles.actionGrid}>
          <ActionButton
            label="Add photo"
            symbol="◫"
            onPress={pickImage}
            disabled={busy}
          />
          <ActionButton
            label="Add audio"
            symbol="≈"
            onPress={pickAudio}
            disabled={busy}
          />
          <ActionButton
            label="Enable push"
            symbol="↗"
            onPress={enablePush}
            disabled={busy}
          />
          <ActionButton
            label="Mark this place"
            symbol="⌖"
            onPress={addPlaceTrigger}
            disabled={busy}
          />
        </View>

        <View style={styles.messageBox}>
          {busy ? <ActivityIndicator color="#21443b" /> : null}
          <Text style={styles.message}>{message}</Text>
        </View>

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>Recent moments</Text>
          <Pressable onPress={() => void refresh()}>
            <Text style={styles.refresh}>Refresh</Text>
          </Pressable>
        </View>

        {assets.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No moments yet.</Text>
          </View>
        ) : (
          assets.map((asset) => (
            <View style={styles.asset} key={asset.id}>
              <View style={styles.assetIcon}>
                <Text>{asset.kind === "image" ? "◫" : "≈"}</Text>
              </View>
              <View style={styles.assetCopy}>
                <Text style={styles.assetName} numberOfLines={1}>
                  {asset.fileName}
                </Text>
                <Text style={styles.assetResult} numberOfLines={2}>
                  {asset.aiResult ?? asset.status.replaceAll("_", " ")}
                </Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ActionButton({
  label,
  symbol,
  onPress,
  disabled,
}: {
  label: string;
  symbol: string;
  onPress: () => void | Promise<void>;
  disabled: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={() => void onPress()}
      style={({ pressed }) => [
        styles.action,
        pressed && styles.actionPressed,
        disabled && styles.actionDisabled,
      ]}
    >
      <Text style={styles.actionSymbol}>{symbol}</Text>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    alignItems: "center",
    backgroundColor: "#f6f3eb",
    flex: 1,
    justifyContent: "center",
  },
  safeArea: { flex: 1, backgroundColor: "#f6f3eb" },
  container: { paddingHorizontal: 22, paddingTop: 22, paddingBottom: 70 },
  brandRow: { alignItems: "center", flexDirection: "row", marginBottom: 24 },
  brandMark: {
    alignItems: "center",
    backgroundColor: "#21443b",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    marginRight: 10,
    transform: [{ rotate: "-7deg" }],
    width: 36,
  },
  brandLetter: { color: "#fffdf8", fontFamily: "Georgia", fontSize: 20 },
  brand: {
    color: "#1c2926",
    fontFamily: "Georgia",
    fontSize: 24,
    fontWeight: "700",
  },
  accountRow: {
    alignItems: "center",
    backgroundColor: "#fffdf8",
    borderColor: "rgba(28, 41, 38, 0.13)",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    marginBottom: 54,
    padding: 13,
  },
  accountIdentity: { flex: 1, minWidth: 0 },
  accountName: { color: "#1c2926", fontSize: 13, fontWeight: "800" },
  accountEmail: { color: "#63706c", fontSize: 10, marginTop: 3 },
  accountAction: { color: "#dc765d", fontSize: 11, fontWeight: "800" },
  eyebrow: {
    color: "#dc765d",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  title: {
    color: "#1c2926",
    fontFamily: "Georgia",
    fontSize: 50,
    letterSpacing: -2,
    lineHeight: 53,
    marginBottom: 18,
    marginTop: 16,
  },
  intro: {
    color: "#63706c",
    fontFamily: "Georgia",
    fontSize: 17,
    lineHeight: 27,
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 34,
  },
  action: {
    alignItems: "center",
    backgroundColor: "#fffdf8",
    borderColor: "rgba(28,41,38,0.1)",
    borderRadius: 18,
    borderWidth: 1,
    flexBasis: "47%",
    flexGrow: 1,
    minHeight: 112,
    padding: 18,
  },
  actionPressed: { transform: [{ scale: 0.98 }] },
  actionDisabled: { opacity: 0.55 },
  actionSymbol: { color: "#21443b", fontSize: 28, marginBottom: 10 },
  actionLabel: { color: "#1c2926", fontSize: 14, fontWeight: "700" },
  messageBox: {
    alignItems: "center",
    backgroundColor: "#e3ebdf",
    borderRadius: 16,
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
    minHeight: 56,
    paddingHorizontal: 17,
  },
  message: { color: "#34574e", flex: 1, fontSize: 13, lineHeight: 19 },
  sectionHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
    marginTop: 44,
  },
  sectionTitle: { color: "#1c2926", fontFamily: "Georgia", fontSize: 27 },
  refresh: { color: "#dc765d", fontSize: 13, fontWeight: "700" },
  empty: {
    alignItems: "center",
    borderColor: "rgba(28,41,38,0.16)",
    borderRadius: 18,
    borderStyle: "dashed",
    borderWidth: 1,
    marginTop: 12,
    padding: 38,
  },
  emptyText: { color: "#63706c" },
  asset: {
    alignItems: "center",
    borderBottomColor: "rgba(28,41,38,0.12)",
    borderBottomWidth: 1,
    flexDirection: "row",
    paddingVertical: 16,
  },
  assetIcon: {
    alignItems: "center",
    backgroundColor: "#e3ebdf",
    borderRadius: 13,
    height: 46,
    justifyContent: "center",
    marginRight: 14,
    width: 46,
  },
  assetCopy: { flex: 1 },
  assetName: { color: "#1c2926", fontSize: 14, fontWeight: "700" },
  assetResult: { color: "#63706c", fontSize: 12, lineHeight: 17, marginTop: 4 },
});
