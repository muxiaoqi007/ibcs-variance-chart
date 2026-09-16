# Certification readiness ? 2026-09-07

This is an engineering readiness record, not a Microsoft or IBCS certification claim.

## Reference

[Microsoft certification requirements](https://learn.microsoft.com/en-us/power-bi/developer/visuals/power-bi-custom-visuals-certified).
Certification covers code, packaging, external access and required host tests; it does not establish feature parity with Zebra BI.

## Implemented and locally checked

- Eight formatting cards with contextual semantic-color and Top N controls; persisted property identifiers retained.
- Keyed waterfall columns preserve interaction nodes on resize. Category and value labels are width-bounded rather than rotated beyond the viewport.
- Existing tooltip, selection, highlight, keyboard and context-menu interactions retained.
- Semantic text colors no longer overridden by global CSS; theme text and high-contrast focus styles wired to the SVG.
- Localized error heading and recovery when the host palette throws.
- Smoke regression suite and 20 logic unit tests; production build and ESLint.
- `npm run package -- --certification-audit` produced the package and reported zero external requests. The tool prints this zero-count line at error severity, but exits successfully.

## Remaining submission work

- Dependency audit BLOCKS certification: the initial official-registry request eventually returned 18 vulnerabilities (3 high, 10 moderate, 5 low). The configured npmmirror endpoint is unsupported and a second npmjs retry failed TLS, but the successful first response establishes the findings. Some remediation requires a major tools upgrade (audit proposes powerbi-visuals-tools 7.2.1). Resolve the dependency tree and rerun build, host regression tests and package audit after upgrading; do not treat zero external requests as a dependency-security pass.
- Verify API/tools against current published releases before submission; this project currently uses API 5.9 and tools 6.2.
- Run the Microsoft sample report and actual Desktop/Service checks, including export, subscriptions, screen reader, keyboard focus, high contrast and persistent formatting. Local DOM tests do not establish host acceptance or pixel-perfect layout.
- Review 320?180, 480?240, 800?400 and 1280?720 with long Chinese categories, missing baselines, negative/zero values and multiple comparisons.
- Replace placeholder author email and complete support/listing metadata with owner-provided details.
- Prepare a lowercase `certification` branch matching the submitted package, required report evidence and Partner Center submission.
- Packaging reports a missing local development certificate and unavailable `pwsh`; package generation still succeeds. Configure the development certificate if using the live development server.

## Further product work

Real-host visual review and comparison against representative Zebra BI reports remains necessary before claiming equivalent layout, interaction or feature coverage.
