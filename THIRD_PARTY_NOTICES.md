# Third-party materials

Lictory's original code is offered under the root MIT license. Third-party
materials retain their own licenses; that license does not relicense them.
On 28 October 2026, Christian Carpinelli confirmed that the original Lictory
code and artwork were created by him, without employer/client/contractor or
purchased-material exceptions. This is the owner's declaration, not an audit
of third-party dependencies or a guarantee of copyright in generated artwork.

## Materials distributed as source

| Material                                          | Location                              | Upstream and retained terms                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Better UI agent skill                             | `.agents/skills/better-ui`            | [Jakub Krehel's skills](https://github.com/jakubkrehel/skills), MIT; notice alongside the skill                                                                             |
| Emil design engineering skill                     | `.agents/skills/emil-design-eng`      | [Emil Kowalski's skills](https://github.com/emilkowalski/skills), MIT; notice alongside the skill                                                                           |
| Stageshow agent skill, kit, examples and tools    | `.agents/skills/stageshow`            | [Benji Taylor's skills](https://github.com/benjitaylor/skills/tree/main/stageshow), MIT; license and `NOTICE.md` (third-party names, marks and artwork) alongside the skill |
| Stageshow kit used by the website's illustrations | `apps/marketing/src/vendor/stageshow` | The same Stageshow kit, MIT; license alongside the copy                                                                                                                     |
| shadcn skill and its assets                       | `.agents/skills/shadcn`               | [shadcn/ui](https://github.com/shadcn-ui/ui), MIT; notice alongside the skill                                                                                               |
| UI primitives adapted through shadcn              | `packages/ui/src`                     | [shadcn/ui](https://github.com/shadcn-ui/ui), [MIT notice](LICENSES/shadcn-ui.txt)                                                                                          |

`skills-lock.json` records the installed skill source and content fingerprint.
The license notices were retrieved from the listed upstream projects. The
original upstream commit IDs were not recorded by the installer; preserve the
fingerprints and notices when updating or redistributing these copies.
The app verification skill is project-specific original material.

## Fonts and icons shipped through dependencies

The UI uses Geist and Geist Mono through `@fontsource-variable/geist` and
`@fontsource-variable/geist-mono`, under the SIL Open Font License 1.1. Preserve
the [Geist](LICENSES/geist.txt) and [Geist Mono](LICENSES/geist-mono.txt) notices
when distributing the font files; keep the reserved font-name terms intact.

Lucide React supplies icons and contains ISC and Feather-derived MIT notices.
The complete installed notice is retained in [LICENSES/lucide.txt](LICENSES/lucide.txt).
Other bundled dependencies also have notice obligations: generate a report for
the exact installed build rather than assuming this short inventory is exhaustive.

## Dependency and artifact review

After `bun install --frozen-lockfile`, run:

```sh
bun run licenses:report /tmp/lictory-licenses
```

This writes `inventory.json` with portable package/version/license metadata,
notice hashes and the lockfile hash, plus `THIRD_PARTY_NOTICES.txt` with the
installed packages' notice text. It performs no registry lookups. Reports stay
outside Git; retain the appropriate report with release evidence and review
which notices must accompany each distributed artifact.

The report covers installed development and runtime packages on that platform.
It does not establish license compatibility or cover uninstalled OS/CPU variants,
container OS packages, vendored source, or separately obtained service images.
A package with metadata but no included license file is explicitly flagged;
obtain its matching upstream notice before distributing it. Do not assume
metadata alone satisfies its terms. Keep notices in traced/bundled artifacts
where the build removes the original `node_modules` files.

The initial installed macOS ARM64 tree includes these cases for artifact review:

- Geist fonts: OFL-1.1; caniuse-lite data: CC-BY-4.0.
- lightningcss, axe-core and @postgresql-typed/oids: MPL-2.0 declarations.
- sharp's libvips binary package: LGPL-3.0-or-later declaration, including its
  own dependencies. [sharp documents these dependencies](https://sharp.pixelplumbing.com/).
  Its installed binary package does not include a license text file. Trace the
  actual shipped binary, preserve the relevant notices and source/relinking
  obligations as applicable before distributing images containing it.

These declarations do not make all Lictory code copyleft, nor do they prove
that any particular artifact is compliant. The release's Linux variants and
OS layers need their own inventory. Avoid presenting this as a complete SBOM.
