"""Install this user's single persistent agile supervisor; no credentials in plist."""
from pathlib import Path
import os
import plistlib
import subprocess

root = Path(__file__).resolve().parents[1]
label = "com.secretary.agile"
target = Path.home() / "Library/LaunchAgents" / (label + ".plist")
assert not target.exists(), "Service already installed; inspect before replacing it"
node = Path("/opt/homebrew/opt/node@22/bin/node")
assert node.is_file()
config = {
    "Label": label,
    "ProgramArguments": ["/usr/bin/caffeinate", "-is", str(node), str(root / "scripts/agile-supervisor.mjs")],
    "WorkingDirectory": str(root),
    "EnvironmentVariables": {"PATH": "/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"},
    "RunAtLoad": True,
    "KeepAlive": True,
    "ThrottleInterval": 30,
    "StandardOutPath": str(root / ".local/supervisor.log"),
    "StandardErrorPath": str(root / ".local/supervisor-error.log"),
    "Umask": 63,
}
target.parent.mkdir(parents=True, exist_ok=True)
target.write_bytes(plistlib.dumps(config))
target.chmod(0o600)
subprocess.run(["plutil", "-lint", str(target)], check=True)
subprocess.run(["launchctl", "bootstrap", "gui/" + str(os.getuid()), str(target)], check=True)
print("Installed " + label)
