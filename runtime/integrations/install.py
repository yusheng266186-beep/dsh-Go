#!/usr/bin/env python3
"""Install the two pinned additions into an isolated, already patched DSH prefix."""
import json
from pathlib import Path
import shutil
import sys

HERE = Path(__file__).resolve().parent
MARKER = "/* dsh-go-codebuddy-sdk-v1 */"


def replace_pinned(entry, original, adapted):
    source = entry.read_bytes()
    if source.count(adapted) == 1:
        return
    if source.count(original) != 1:
        raise ValueError(f"Pinned Purge redteam anchor changed in {entry.name}")
    entry.write_bytes(source.replace(original, adapted))


def adapt_redteam_preset(package):
    # Presets resolve their bundled tools independently of the Web profile.
    replace_pinned(
        package / "lib/redteam/index.js",
        b"if (['dsh-redteam-mode/tools', 'dsh-purge/redteam/tools'].includes(row.name)) {\n"
        b"        row.name = 'dsh-purge-community/redteam/tools'",
        b"if (['dsh-redteam-mode/tools', 'dsh-purge/redteam/tools', 'dsh-purge-community/redteam/tools'].includes(row.name)) {\n"
        b"        row.name = fileURLToPath(new URL('./tools.js', import.meta.url))",
    )
    # Text conversation is supported by the built-in runtime before any
    # optional scanner is configured. Leave tool detection and user settings intact.
    replace_pinned(
        package / "lib/redteam/platform-config.js",
        b"  } else if (found >= 2) {",
        """  } else if (!cfg.exists && process.env.DSH_GO_RUNTIME_ROOT && (
    existsSync('/etc/dsh-app/runtime.json') ||
    existsSync(join(process.env.DSH_GO_RUNTIME_ROOT, 'etc', 'dsh-app', 'runtime.json'))
  )) {
    ready = true
    reason = 'bundled-runtime'
    message = '内置运行时支持对话。扫描类技能仍会检查所需工具。'
  } else if (found >= 2) {""".encode("utf-8"),
    )


def keep_cli_file(parts):
    section = parts[0]
    if section == "dist":
        return parts == ("dist", "codebuddy-headless.js")
    if section == "bin":
        return len(parts) == 2 and not parts[-1].endswith((".test.cjs", ".d.cts"))
    if section == "vendor":
        return len(parts) > 1 and parts[1] == "assets"
    if section == "builtin":
        return True
    return len(parts) == 1 and (
        section == "package.json" or section.startswith(("product.", "LICENSE", "NOTICE"))
    )


def install(prefix):
    prefix = Path(prefix).resolve()
    modules = prefix / "node_modules"
    for package, version in (("@deepseek-ai/dsh", "0.2.2-rc.1"),
                             ("dsh-purge-community", "1.6.84"),
                             ("@tencent-ai/agent-sdk", "0.3.291")):
        actual = json.loads((modules / package / "package.json").read_text())["version"]
        if actual != version:
            raise ValueError(f"Unexpected {package} version: {actual}")
    cli = modules / "@tencent-ai/agent-sdk/cli"
    if json.loads((cli / "package.json").read_text())["version"] != "2.176.0":
        raise ValueError("Unexpected CodeBuddy CLI version")
    # Keep the unmodified headless transport; desktop bundles and bundled
    # external tools are unused because DSH executes all tools itself.
    for item in cli.rglob("*"):
        if item.is_file() and not item.is_symlink() and not keep_cli_file(item.relative_to(cli).parts):
            item.unlink()
    target = modules / "@deepseek-ai/dsh-llm-pi-ai/lib/index.js"
    source = target.read_text()
    if MARKER not in source or "/* dsh-go-codebuddy-catalog-v1 */" not in source:
        raise ValueError("Pinned CodeBuddy engine patch was not applied")
    destination = prefix / "dsh-go-integrations"
    destination.mkdir(exist_ok=True)
    for name in ("codebuddy.cjs", "catalog.cjs", "CODEBUDDY-LICENSE", "NOTICE.md"):
        shutil.copyfile(HERE / name, destination / name)
    upstream_layer = modules / "dsh-purge-community/cordis.patch.yml"
    if upstream_layer.read_bytes() != (HERE / "purge.patch.yml").read_bytes():
        raise ValueError("Bundled Purge layer differs from the pinned package")
    adapt_redteam_preset(upstream_layer.parent)


if __name__ == "__main__":
    install(sys.argv[1])
