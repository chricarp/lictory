import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { authClient } from "./auth-client";

type Mode = "sign-in" | "sign-up";

export function AuthScreen({
  refreshSession,
}: {
  refreshSession: () => Promise<unknown>;
}) {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit() {
    setBusy(true);
    setMessage("");
    try {
      const result =
        mode === "sign-up"
          ? await authClient.signUp.email({ name, email, password })
          : await authClient.signIn.email({ email, password });
      if (result.error) throw new Error(result.error.message);
      setPassword("");
      await refreshSession();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function social(provider: "google" | "apple") {
    setBusy(true);
    setMessage("");
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: "/",
      });
      if (result.error) throw new Error(result.error.message);
      await refreshSession();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : `Could not use ${provider}.`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function passkey() {
    setBusy(true);
    setMessage("");
    try {
      const result = await authClient.signIn.passkey();
      if (result.error) throw new Error(result.error.message);
      await refreshSession();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Passkey sign-in failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <Text style={styles.brandLetter}>L</Text>
            </View>
            <Text style={styles.brand}>Lictory</Text>
          </View>

          <Text style={styles.eyebrow}>WELCOME BACK</Text>
          <Text style={styles.title}>Your moments are waiting.</Text>

          <View style={styles.tabs}>
            <Tab
              active={mode === "sign-in"}
              label="Sign in"
              onPress={() => setMode("sign-in")}
            />
            <Tab
              active={mode === "sign-up"}
              label="Create account"
              onPress={() => setMode("sign-up")}
            />
          </View>

          <View style={styles.socialRow}>
            <AuthButton
              disabled={busy}
              label="Google"
              onPress={() => social("google")}
              secondary
            />
            <AuthButton
              disabled={busy}
              label="Apple"
              onPress={() => social("apple")}
              secondary
            />
          </View>

          <Text style={styles.divider}>OR USE EMAIL</Text>

          {mode === "sign-up" ? (
            <TextInput
              autoComplete="name"
              onChangeText={setName}
              placeholder="Name"
              placeholderTextColor="#87908d"
              style={styles.input}
              value={name}
            />
          ) : null}
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            inputMode="email"
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor="#87908d"
            style={styles.input}
            value={email}
          />
          <TextInput
            autoComplete={mode === "sign-up" ? "new-password" : "password"}
            onChangeText={setPassword}
            placeholder="Password (8+ characters)"
            placeholderTextColor="#87908d"
            secureTextEntry
            style={styles.input}
            value={password}
          />

          <AuthButton
            disabled={busy}
            label={mode === "sign-up" ? "Create account" : "Sign in"}
            onPress={submit}
          />
          <AuthButton
            disabled={busy}
            label="Sign in with a passkey"
            onPress={passkey}
            secondary
          />

          {busy ? <ActivityIndicator color="#21443b" /> : null}
          {message ? <Text style={styles.message}>{message}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Tab({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function AuthButton({
  disabled,
  label,
  onPress,
  secondary = false,
}: {
  disabled: boolean;
  label: string;
  onPress: () => Promise<void>;
  secondary?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={() => void onPress()}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.buttonSecondary,
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text
        style={[styles.buttonText, secondary && styles.buttonTextSecondary]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { backgroundColor: "#f6f3eb", flex: 1 },
  container: { flexGrow: 1, padding: 24, paddingBottom: 60 },
  brandRow: { alignItems: "center", flexDirection: "row", marginBottom: 54 },
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
  eyebrow: {
    color: "#dc765d",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  title: {
    color: "#1c2926",
    fontFamily: "Georgia",
    fontSize: 43,
    letterSpacing: -1.5,
    lineHeight: 47,
    marginBottom: 32,
    marginTop: 14,
  },
  tabs: {
    borderBottomColor: "#d8d6ce",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 22,
  },
  tab: {
    borderBottomColor: "transparent",
    borderBottomWidth: 2,
    paddingBottom: 11,
  },
  tabActive: { borderBottomColor: "#dc765d" },
  tabText: { color: "#7a8380", fontSize: 14, fontWeight: "700" },
  tabTextActive: { color: "#1c2926" },
  socialRow: { flexDirection: "row", gap: 10, marginTop: 26 },
  divider: {
    color: "#87908d",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginVertical: 22,
    textAlign: "center",
  },
  input: {
    backgroundColor: "#fffdf8",
    borderColor: "#d8d6ce",
    borderRadius: 12,
    borderWidth: 1,
    color: "#1c2926",
    fontSize: 16,
    marginBottom: 12,
    paddingHorizontal: 15,
    paddingVertical: 14,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#dc765d",
    borderColor: "#dc765d",
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    marginBottom: 10,
    paddingHorizontal: 15,
    paddingVertical: 14,
  },
  buttonSecondary: { backgroundColor: "#fffdf8", borderColor: "#d8d6ce" },
  buttonPressed: { opacity: 0.8 },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: "white", fontSize: 14, fontWeight: "800" },
  buttonTextSecondary: { color: "#21443b" },
  message: {
    color: "#b8533e",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
    textAlign: "center",
  },
});
