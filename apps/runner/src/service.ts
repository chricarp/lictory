import { mkdir, writeFile } from "node:fs/promises";
import { homedir, platform, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { run } from "@lictory/runner/process";
import { homeDirectory } from "@lictory/runner/config";

// `lictory-runner install-service`: runs `lictory-runner start` at boot
// (systemd on Linux, launchd on macOS) and restarts it if it stops. On
// Windows it prints the commands instead.

export type ServiceOptions = {
  // A system service (root) instead of the current user's.
  system: boolean;
  // Enable and start it now.
  enable: boolean;
  log: (line: string) => void;
};

// The command the service runs: this binary, or bun with this script.
function command() {
  const executable = process.execPath;
  const script = process.argv[1];
  const compiled =
    !script || /^\/\$bunfs|^B:\\~BUN/.test(script) || script === executable;
  return compiled ? [executable, "start"] : [executable, script, "start"];
}

const quote = (value: string) =>
  /^[\w@%+=:,./-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", `'\\''`)}'`;

export function systemdUnit(options: {
  system: boolean;
  home: string;
  user: string;
}) {
  return [
    "[Unit]",
    "Description=Lictory runner (executes agent sessions)",
    "Wants=network-online.target",
    "After=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${command().map(quote).join(" ")}`,
    `Environment=LICTORY_RUNNER_HOME=${options.home}`,
    ...(options.system ? [`User=${options.user}`] : []),
    "Restart=always",
    "RestartSec=5",
    // Exit 2: the server revoked the credential. Restarting cannot help.
    "RestartPreventExitStatus=2",
    // Sessions get time to hand back their work.
    "TimeoutStopSec=30",
    "KillSignal=SIGTERM",
    "",
    "[Install]",
    `WantedBy=${options.system ? "multi-user.target" : "default.target"}`,
    "",
  ].join("\n");
}

export function launchdPlist(options: { home: string; logs: string }) {
  const args = command()
    .map(
      (a) =>
        `    <string>${a.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</string>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.lictory.runner</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LICTORY_RUNNER_HOME</key>
    <string>${options.home}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${options.logs}/runner.log</string>
  <key>StandardErrorPath</key>
  <string>${options.logs}/runner.log</string>
</dict>
</plist>
`;
}

export async function installService(options: ServiceOptions) {
  const home = homeDirectory();
  const { log } = options;
  switch (platform()) {
    case "linux": {
      const path = options.system
        ? "/etc/systemd/system/lictory-runner.service"
        : join(
            homedir(),
            ".config",
            "systemd",
            "user",
            "lictory-runner.service",
          );
      await mkdir(dirname(path), { recursive: true });
      await writeFile(
        path,
        systemdUnit({
          system: options.system,
          home,
          user: userInfo().username,
        }),
      );
      log(`Wrote ${path}.`);
      const ctl = options.system ? ["systemctl"] : ["systemctl", "--user"];
      const steps = [
        [...ctl, "daemon-reload"],
        [...ctl, "enable", "--now", "lictory-runner.service"],
      ];
      if (options.enable) {
        for (const step of steps) {
          const result = await run(step[0]!, step.slice(1));
          if (result.code !== 0)
            throw new Error(
              `${step.join(" ")} failed: ${result.stderr.trim()}`,
            );
        }
        log("The runner service is enabled and running.");
      } else
        log(`Start it with:\n  ${steps.map((s) => s.join(" ")).join("\n  ")}`);
      if (!options.system)
        log(
          "A user service stops when you log out unless lingering is on: loginctl enable-linger $USER",
        );
      return;
    }
    case "darwin": {
      const path = options.system
        ? "/Library/LaunchDaemons/com.lictory.runner.plist"
        : join(
            homedir(),
            "Library",
            "LaunchAgents",
            "com.lictory.runner.plist",
          );
      const logs = join(home, "logs");
      await mkdir(logs, { recursive: true });
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, launchdPlist({ home, logs }));
      log(`Wrote ${path}. Logs go to ${logs}/runner.log.`);
      const load = ["launchctl", "load", "-w", path];
      if (options.enable) {
        const result = await run(load[0]!, load.slice(1));
        if (result.code !== 0)
          throw new Error(`${load.join(" ")} failed: ${result.stderr.trim()}`);
        log("The runner service is loaded and running.");
      } else log(`Start it with:\n  ${load.join(" ")}`);
      return;
    }
    case "win32": {
      const [exe] = command();
      log(
        [
          "Windows has no service installer built in. Run the runner at sign-in with Task Scheduler (from an elevated PowerShell):",
          "",
          `  $action = New-ScheduledTaskAction -Execute "${exe}" -Argument "start"`,
          "  $trigger = New-ScheduledTaskTrigger -AtLogOn",
          "  $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)",
          '  Register-ScheduledTask -TaskName "Lictory runner" -Action $action -Trigger $trigger -Settings $settings',
          "",
          "Or install it as a service with NSSM: nssm install LictoryRunner " +
            `"${exe}" start`,
          `Set LICTORY_RUNNER_HOME=${home} for the service account if it differs from yours.`,
        ].join("\n"),
      );
      return;
    }
    default:
      throw new Error(
        `install-service does not support ${platform()}; run "lictory-runner start" with your init system.`,
      );
  }
}
