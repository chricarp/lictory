# Getting help

Start with the [README](README.md), [documentation index](docs/README.md) and
[development runbook](docs/operations/development.md). For a self-hosted
installation, also read [deployment](docs/operations/deployment.md) and
[recovery](docs/operations/recovery.md).

Search [existing issues](https://github.com/chricarp/lictory/issues) first.
Use the bug form for a reproducible defect, the proposal form for intentional
behavior changes, or the help form for setup and usage questions. Include the
commit or release, installation method, relevant redacted output and what you
already tried. Never include customer content, credentials or database dumps.

On a self-hosted server, run `lictory doctor` first: it names most problems
and how to fix them. `sudo lictory support-bundle` writes one archive with
versions, status, doctor, masked settings and recent logs, with secrets,
email addresses and tokens removed. Logs can still contain your
organization's content, so read it and paste only the relevant lines.

Community support is best effort, with no response-time guarantee. Security
reports belong in [the security channel](.github/SECURITY.md). Conduct concerns
follow [the code of conduct](CODE_OF_CONDUCT.md).
